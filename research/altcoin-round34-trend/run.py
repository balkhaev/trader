from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import io
import itertools
import json
import math
import re
import time
import zipfile
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd
import requests

SYMBOLS = [
    "SOLUSDT", "XRPUSDT", "DOGEUSDT", "BNBUSDT", "SUIUSDT",
    "ADAUSDT", "LINKUSDT", "AVAXUSDT", "LTCUSDT", "BCHUSDT",
    "AAVEUSDT", "OPUSDT", "ETCUSDT", "INJUSDT", "TIAUSDT",
    "NEARUSDT", "ONDOUSDT", "PENDLEUSDT", "TAOUSDT", "APTUSDT",
    "ENAUSDT", "FETUSDT", "RENDERUSDT", "TONUSDT", "HBARUSDT",
    "XLMUSDT", "JUPUSDT", "WIFUSDT", "ZECUSDT", "ALGOUSDT",
]
INTERVAL = "15m"
WARMUP_START = pd.Timestamp("2023-11-01", tz="UTC")
START = pd.Timestamp("2024-01-01", tz="UTC")
CUT1 = pd.Timestamp("2025-01-01", tz="UTC")
CUT2 = pd.Timestamp("2025-07-01", tz="UTC")
CUT3 = pd.Timestamp("2026-01-01", tz="UTC")
PRE_JULY_END = pd.Timestamp("2026-07-01", tz="UTC")
END = pd.Timestamp("2026-07-27", tz="UTC")
BASE_COST = 12.0
STRESS_COST = 20.0

BASE = "https://data.binance.vision/data/futures/um"
KLINE_MONTHLY = f"{BASE}/monthly/klines"
KLINE_DAILY = f"{BASE}/daily/klines"
FUNDING_MONTHLY = f"{BASE}/monthly/fundingRate"

KLINE_COLS = [
    "open_time", "open", "high", "low", "close", "volume", "close_time",
    "quote_volume", "trades", "taker_buy_base", "taker_buy_quote", "ignore",
]


@dataclass(frozen=True)
class Config:
    name: str
    lookback: int
    volume_z: float
    hold: int
    stop_atr: float
    target_r: float | None


CONFIGS = [
    Config(
        f"BRK_L{lookback}_V{volume_z:g}_H{hold}_S{stop:g}_T{target if target else 0:g}",
        lookback,
        volume_z,
        hold,
        stop,
        target,
    )
    for lookback, volume_z, hold, stop, target in itertools.product(
        [16, 32, 64, 96],
        [0.0, 0.75],
        [4, 8, 16],
        [1.5, 2.0],
        [None, 3.0],
    )
]


def get(url: str, timeout: int = 180) -> requests.Response:
    last: Exception | None = None
    for attempt in range(5):
        try:
            response = requests.get(
                url,
                timeout=timeout,
                headers={"User-Agent": "altcoin-trend-round34/1"},
            )
            if response.status_code == 404:
                return response
            response.raise_for_status()
            return response
        except Exception as exc:
            last = exc
            time.sleep(1 + attempt)
    raise RuntimeError(f"{url}: {last}")


def sha_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch_verified(task: tuple[str, str, str, str, Path]) -> dict[str, object]:
    symbol, period, kind, url, path = task
    path.parent.mkdir(parents=True, exist_ok=True)
    meta: dict[str, object] = {
        "symbol": symbol,
        "period": period,
        "kind": kind,
        "url": url,
        "path": str(path),
    }
    try:
        checksum = get(url + ".CHECKSUM", 90)
        if checksum.status_code == 404:
            return meta | {"status": "missing"}
        match = re.search(r"\b([0-9a-fA-F]{64})\b", checksum.text)
        if not match:
            raise ValueError(f"invalid checksum for {url}")
        expected = match.group(1).lower()
        if path.exists() and sha_file(path) == expected:
            return meta | {
                "status": "cached_verified",
                "sha256": expected,
                "bytes": path.stat().st_size,
            }
        response = get(url, 240)
        if response.status_code == 404:
            return meta | {"status": "missing"}
        actual = hashlib.sha256(response.content).hexdigest()
        if actual != expected:
            raise ValueError(f"checksum {actual} != {expected}")
        temp = path.with_suffix(path.suffix + ".tmp")
        temp.write_bytes(response.content)
        temp.replace(path)
        return meta | {
            "status": "downloaded_verified",
            "sha256": actual,
            "bytes": len(response.content),
        }
    except Exception as exc:
        return meta | {"status": "error", "error": str(exc)}


def tasks(cache: Path) -> list[tuple[str, str, str, str, Path]]:
    output: list[tuple[str, str, str, str, Path]] = []
    months = pd.period_range(
        WARMUP_START.tz_localize(None),
        (PRE_JULY_END - pd.Timedelta(days=1)).tz_localize(None),
        freq="M",
    )
    july_days = pd.date_range(PRE_JULY_END, END - pd.Timedelta(days=1), freq="1D")
    for symbol in SYMBOLS:
        for period in months:
            month = period.strftime("%Y-%m")
            name = f"{symbol}-{INTERVAL}-{month}.zip"
            output.append(
                (
                    symbol,
                    month,
                    "kline_monthly",
                    f"{KLINE_MONTHLY}/{symbol}/{INTERVAL}/{name}",
                    cache / "kline_monthly" / symbol / name,
                )
            )
            funding_name = f"{symbol}-fundingRate-{month}.zip"
            output.append(
                (
                    symbol,
                    month,
                    "funding_monthly",
                    f"{FUNDING_MONTHLY}/{symbol}/{funding_name}",
                    cache / "funding_monthly" / symbol / funding_name,
                )
            )
        for day in july_days:
            date = day.strftime("%Y-%m-%d")
            name = f"{symbol}-{INTERVAL}-{date}.zip"
            output.append(
                (
                    symbol,
                    date,
                    "kline_daily",
                    f"{KLINE_DAILY}/{symbol}/{INTERVAL}/{name}",
                    cache / "kline_daily" / symbol / name,
                )
            )
    return output


def download_all(cache: Path, workers: int) -> list[dict[str, object]]:
    work = tasks(cache)
    result: list[dict[str, object]] = []
    with cf.ThreadPoolExecutor(max_workers=workers) as executor:
        for index, item in enumerate(executor.map(fetch_verified, work), 1):
            result.append(item)
            if index % 250 == 0:
                print(f"archives {index}/{len(work)}", flush=True)
    errors = [item for item in result if item["status"] == "error"]
    if errors:
        raise RuntimeError(f"archive errors: {errors[:3]}")
    return result


def verified_paths(
    symbol: str,
    manifest: list[dict[str, object]],
    kinds: set[str],
) -> list[Path]:
    return sorted(
        Path(str(item["path"]))
        for item in manifest
        if item["symbol"] == symbol
        and item["kind"] in kinds
        and item["status"] in {"cached_verified", "downloaded_verified"}
    )


def first_member(path: Path) -> bytes:
    with zipfile.ZipFile(path) as bundle:
        members = [name for name in bundle.namelist() if not name.endswith("/")]
        return bundle.read(members[0]) if members else b""


def parse_time(values: pd.Series) -> pd.Series:
    numeric = pd.to_numeric(values, errors="coerce")
    median = numeric.dropna().median()
    if pd.isna(median):
        return pd.to_datetime(values, utc=True, errors="coerce")
    unit = "us" if median > 1e14 else ("ms" if median > 1e11 else "s")
    return pd.to_datetime(numeric, unit=unit, utc=True, errors="coerce")


def read_kline(path: Path) -> pd.DataFrame:
    raw = first_member(path)
    if not raw:
        return pd.DataFrame(columns=KLINE_COLS)
    frame = pd.read_csv(io.BytesIO(raw), header=None, low_memory=False).iloc[:, :12]
    frame.columns = KLINE_COLS
    frame["open_time"] = parse_time(frame.open_time)
    for column in KLINE_COLS[1:-1]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame.dropna(subset=["open_time", "open", "high", "low", "close", "volume"])


def load_klines(symbol: str, manifest: list[dict[str, object]]) -> pd.DataFrame:
    parts = [
        read_kline(path)
        for path in verified_paths(
            symbol, manifest, {"kline_monthly", "kline_daily"}
        )
    ]
    if not parts:
        return pd.DataFrame(columns=KLINE_COLS)
    frame = pd.concat(parts, ignore_index=True)
    return (
        frame[(frame.open_time >= WARMUP_START) & (frame.open_time < END)]
        .sort_values("open_time")
        .drop_duplicates("open_time")
        .reset_index(drop=True)
    )


def load_funding(symbol: str, manifest: list[dict[str, object]]) -> pd.DatetimeIndex:
    values: list[int] = []
    for path in verified_paths(symbol, manifest, {"funding_monthly"}):
        raw = first_member(path)
        if not raw:
            continue
        table = pd.read_csv(io.BytesIO(raw), low_memory=False)
        if "calc_time" in table.columns:
            data = pd.to_numeric(table.calc_time, errors="coerce")
        else:
            table = pd.read_csv(io.BytesIO(raw), header=None, low_memory=False)
            data = pd.to_numeric(table.iloc[:, 0], errors="coerce")
        data = data.dropna()
        if len(data):
            if data.median() > 1e14:
                data = data / 1000
            values.extend(data.astype("int64").tolist())
    historical = (
        pd.to_datetime(pd.Series(values, dtype="int64"), unit="ms", utc=True)
        if values
        else pd.Series([], dtype="datetime64[ns, UTC]")
    )
    july = pd.date_range(PRE_JULY_END, END, freq="8h", tz="UTC")
    combined = pd.DatetimeIndex(list(historical) + list(july))
    return combined[(combined >= WARMUP_START) & (combined < END)].drop_duplicates().sort_values()


def atr(frame: pd.DataFrame, periods: int = 14) -> pd.Series:
    previous = frame.close.shift()
    true_range = pd.concat(
        [
            frame.high - frame.low,
            (frame.high - previous).abs(),
            (frame.low - previous).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return true_range.ewm(
        alpha=1 / periods, adjust=False, min_periods=periods
    ).mean()


def build_features(frame: pd.DataFrame) -> pd.DataFrame:
    data = frame.copy()
    data["atr"] = atr(data)
    log_volume = np.log1p(data.quote_volume.clip(lower=0))
    mean = log_volume.rolling(2880, min_periods=672).mean()
    std = log_volume.rolling(2880, min_periods=672).std().replace(0, np.nan)
    data["volz"] = (log_volume - mean) / std

    close_index = data.open_time + pd.Timedelta(minutes=15)
    higher = (
        data.set_index(close_index)
        .resample("4h", label="right", closed="right")
        .agg(close=("close", "last"))
        .dropna()
    )
    ema20 = higher.close.ewm(span=20, adjust=False, min_periods=20).mean()
    ema50 = higher.close.ewm(span=50, adjust=False, min_periods=50).mean()
    trend = np.sign(ema20 - ema50).reindex(close_index, method="ffill")
    data["h4trend"] = trend.to_numpy()

    for lookback in [16, 32, 64, 96]:
        data[f"hi{lookback}"] = data.high.rolling(lookback).max().shift()
        data[f"lo{lookback}"] = data.low.rolling(lookback).min().shift()
    return data


def crosses(events_ns: np.ndarray, entry_ns: int, exit_ns: int) -> bool:
    if not len(events_ns):
        return False
    index = np.searchsorted(events_ns, entry_ns, side="left")
    return index < len(events_ns) and events_ns[index] <= exit_ns


def simulate(
    symbol: str,
    frame: pd.DataFrame,
    funding: pd.DatetimeIndex,
    cfg: Config,
    start: pd.Timestamp,
    end: pd.Timestamp,
) -> list[dict[str, object]]:
    high_level = frame[f"hi{cfg.lookback}"]
    low_level = frame[f"lo{cfg.lookback}"]
    long_signal = (
        (frame.close > high_level)
        & (frame.volz >= cfg.volume_z)
        & (frame.h4trend > 0)
    ).fillna(False).to_numpy()
    short_signal = (
        (frame.close < low_level)
        & (frame.volz >= cfg.volume_z)
        & (frame.h4trend < 0)
    ).fillna(False).to_numpy()

    times = list(frame.open_time)
    time_ns = frame.open_time.astype("int64").to_numpy()
    open_price = frame.open.to_numpy(float)
    high = frame.high.to_numpy(float)
    low = frame.low.to_numpy(float)
    atr_value = frame.atr.to_numpy(float)
    volume_strength = frame.volz.clip(lower=0).fillna(0).to_numpy(float)
    event_ns = funding.astype("int64").to_numpy()
    first = np.searchsorted(time_ns, start.value)
    final = np.searchsorted(time_ns, end.value)
    candidates = np.flatnonzero(
        (long_signal | short_signal)
        & (np.arange(len(frame)) >= first)
        & (np.arange(len(frame)) < final)
    )
    last_exit = -1
    trades: list[dict[str, object]] = []
    for signal_index in candidates:
        if signal_index <= last_exit or signal_index + 1 >= final:
            continue
        if not np.isfinite(atr_value[signal_index]):
            continue
        side = 1 if long_signal[signal_index] else -1
        entry_index = signal_index + 1
        scheduled_exit = entry_index + cfg.hold
        if scheduled_exit >= final:
            continue
        if times[entry_index].date() != times[scheduled_exit].date():
            continue
        if crosses(
            event_ns,
            int(time_ns[entry_index]),
            int(time_ns[scheduled_exit]),
        ):
            continue

        entry = open_price[entry_index]
        stop = entry - side * cfg.stop_atr * atr_value[signal_index]
        risk = abs(entry - stop)
        target = (
            None
            if cfg.target_r is None
            else entry + side * cfg.target_r * risk
        )
        exit_price = open_price[scheduled_exit]
        exit_index = scheduled_exit
        reason = "time"
        mae_bps = 0.0
        mfe_bps = 0.0
        for bar_index in range(entry_index, scheduled_exit):
            excursions = [
                side * (high[bar_index] / entry - 1) * 1e4,
                side * (low[bar_index] / entry - 1) * 1e4,
            ]
            mae_bps = min(mae_bps, *excursions)
            mfe_bps = max(mfe_bps, *excursions)
            if side == 1 and open_price[bar_index] <= stop:
                exit_price, exit_index, reason = open_price[bar_index], bar_index, "stop_gap"
                break
            if side == -1 and open_price[bar_index] >= stop:
                exit_price, exit_index, reason = open_price[bar_index], bar_index, "stop_gap"
                break
            if side == 1 and low[bar_index] <= stop:
                exit_price, exit_index, reason = stop, bar_index, "stop"
                break
            if side == -1 and high[bar_index] >= stop:
                exit_price, exit_index, reason = stop, bar_index, "stop"
                break
            if target is not None:
                if side == 1 and high[bar_index] >= target:
                    exit_price, exit_index, reason = target, bar_index, "target"
                    break
                if side == -1 and low[bar_index] <= target:
                    exit_price, exit_index, reason = target, bar_index, "target"
                    break

        gross_bps = side * (exit_price / entry - 1) * 1e4
        trades.append(
            {
                "config": cfg.name,
                "symbol": symbol,
                "side": side,
                "signal_time": times[signal_index],
                "entry_time": times[entry_index],
                "exit_time": times[exit_index],
                "gross_bps": gross_bps,
                "net_bps": gross_bps - BASE_COST,
                "stop_distance_bps": abs(entry - stop) / entry * 1e4,
                "strength": volume_strength[signal_index],
                "reason": reason,
                "mae_bps": mae_bps,
                "mfe_bps": mfe_bps,
            }
        )
        last_exit = exit_index
    return trades


def metrics(data: list[dict[str, object]] | pd.DataFrame, cost: float) -> dict[str, float | int]:
    if isinstance(data, list):
        gross = np.asarray([item["gross_bps"] for item in data], dtype=float)
        symbols = [str(item["symbol"]) for item in data]
    else:
        gross = data.gross_bps.to_numpy(float) if len(data) else np.array([])
        symbols = data.symbol.astype(str).tolist() if len(data) else []
    if not len(gross):
        return {
            "trades": 0,
            "avg_bps": np.nan,
            "pf": np.nan,
            "win_rate": np.nan,
            "total_bps": 0.0,
            "symbols": 0,
            "breadth": 0.0,
        }
    values = gross - cost
    gains = values[values > 0]
    losses = -values[values < 0]
    by_symbol: dict[str, list[float]] = {}
    for symbol, value in zip(symbols, values):
        by_symbol.setdefault(symbol, []).append(float(value))
    eligible = [values for values in by_symbol.values() if len(values) >= 5]
    breadth = (
        float(np.mean([np.mean(values) > 0 for values in eligible]))
        if eligible
        else 0.0
    )
    return {
        "trades": int(len(values)),
        "avg_bps": float(values.mean()),
        "pf": float(gains.sum() / losses.sum()) if losses.sum() else float("inf"),
        "win_rate": float(np.mean(values > 0)),
        "total_bps": float(values.sum()),
        "symbols": int(len(set(symbols))),
        "breadth": breadth,
    }


def account(
    trades: pd.DataFrame,
    risk_pct: float,
    cost: float,
    start: pd.Timestamp,
    end: pd.Timestamp,
    initial: float = 10_000.0,
    max_positions: int = 4,
    per_position_leverage_cap: float = 5.0,
    gross_leverage_cap: float = 10.0,
) -> dict[str, float | int]:
    frame = trades[
        (pd.to_datetime(trades.entry_time, utc=True) >= start)
        & (pd.to_datetime(trades.entry_time, utc=True) < end)
    ].sort_values(["entry_time", "strength"], ascending=[True, False]).reset_index(drop=True)
    if frame.empty:
        return {}
    equity = initial
    open_positions: dict[int, dict[str, float | str]] = {}
    curve = []
    accepted = 0
    for timestamp in sorted(set(frame.entry_time) | set(frame.exit_time)):
        for index, position in list(open_positions.items()):
            row = frame.iloc[index]
            if row.exit_time == timestamp and row.entry_time < timestamp:
                equity += float(position["notional"]) * (float(row.gross_bps) - cost) / 1e4
                del open_positions[index]
                accepted += 1
        for index in frame.index[frame.entry_time == timestamp]:
            row = frame.iloc[index]
            if len(open_positions) >= max_positions:
                continue
            if any(position["symbol"] == row.symbol for position in open_positions.values()):
                continue
            stop_fraction = (float(row.stop_distance_bps) + cost) / 1e4
            desired = equity * (risk_pct / 100) / stop_fraction
            desired = min(desired, equity * per_position_leverage_cap)
            gross_now = sum(float(position["notional"]) for position in open_positions.values())
            desired = min(desired, max(0.0, equity * gross_leverage_cap - gross_now))
            if desired <= 0:
                continue
            open_positions[index] = {"symbol": row.symbol, "notional": desired}
        for index, position in list(open_positions.items()):
            row = frame.iloc[index]
            if row.exit_time == timestamp and row.entry_time == timestamp:
                equity += float(position["notional"]) * (float(row.gross_bps) - cost) / 1e4
                del open_positions[index]
                accepted += 1
        curve.append(equity)
    curve_array = np.asarray(curve)
    drawdown = 1 - curve_array / np.maximum.accumulate(curve_array)
    years = (end - start).days / 365.25
    return {
        "risk_pct": risk_pct,
        "start": start.isoformat(),
        "end_exclusive": end.isoformat(),
        "accepted_trades": accepted,
        "return_pct": (equity / initial - 1) * 100,
        "cagr_pct": ((equity / initial) ** (1 / years) - 1) * 100,
        "closed_dd_pct": float(drawdown.max() * 100),
        "final_equity_usd": equity,
        "cost_bps": cost,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--cache", required=True)
    parser.add_argument("--workers", type=int, default=24)
    args = parser.parse_args()
    output = Path(args.output)
    cache = Path(args.cache)
    output.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)

    manifest = download_all(cache, args.workers)
    pd.DataFrame(manifest).to_csv(output / "SOURCE_MANIFEST.csv", index=False)

    features: dict[str, pd.DataFrame] = {}
    funding: dict[str, pd.DatetimeIndex] = {}
    coverage = []
    for symbol in SYMBOLS:
        raw = load_klines(symbol, manifest)
        events = load_funding(symbol, manifest)
        coverage.append(
            {
                "symbol": symbol,
                "rows": len(raw),
                "first": None if raw.empty else raw.open_time.iloc[0],
                "last": None if raw.empty else raw.open_time.iloc[-1],
                "funding_events": len(events),
            }
        )
        if not raw.empty:
            features[symbol] = build_features(raw)
            funding[symbol] = events
        print(symbol, len(raw), flush=True)
    pd.DataFrame(coverage).to_csv(output / "COVERAGE.csv", index=False)

    periods = {
        "2024": (START, CUT1),
        "2025H1": (CUT1, CUT2),
        "2025H2": (CUT2, CUT3),
        "2026H1": (CUT3, PRE_JULY_END),
        "JULY2026": (PRE_JULY_END, END),
    }
    rows: list[dict[str, object]] = []
    trade_store: dict[tuple[str, str], list[dict[str, object]]] = {}
    for cfg_index, cfg in enumerate(CONFIGS, 1):
        for label, bounds in periods.items():
            trades: list[dict[str, object]] = []
            for symbol, frame in features.items():
                trades += simulate(symbol, frame, funding[symbol], cfg, *bounds)
            trade_store[(cfg.name, label)] = trades
            rows.append(
                {
                    "config": cfg.name,
                    "period": label,
                    **asdict(cfg),
                    **{f"base_{key}": value for key, value in metrics(trades, BASE_COST).items()},
                    **{f"stress_{key}": value for key, value in metrics(trades, STRESS_COST).items()},
                }
            )
        if cfg_index % 12 == 0:
            print(f"configs {cfg_index}/{len(CONFIGS)}", flush=True)

    grid = pd.DataFrame(rows)
    grid.to_csv(output / "CONFIG_RESULTS.csv", index=False)

    selection_rows = []
    for cfg in CONFIGS:
        first = grid[(grid.config == cfg.name) & (grid.period == "2024")].iloc[0]
        second = grid[(grid.config == cfg.name) & (grid.period == "2025H1")].iloc[0]
        eligible = (
            first.stress_trades >= 100
            and second.stress_trades >= 50
            and first.stress_avg_bps > 0
            and second.stress_avg_bps > 0
            and first.stress_pf > 1.05
            and second.stress_pf > 1.05
            and first.stress_breadth >= 0.40
            and second.stress_breadth >= 0.40
        )
        score = (
            min(first.stress_avg_bps, second.stress_avg_bps)
            * math.sqrt(min(first.stress_trades, second.stress_trades) / 100)
            * min(first.stress_pf, second.stress_pf, 3)
            if eligible
            else -1e9
        )
        selection_rows.append(
            {
                "config": cfg.name,
                "eligible": eligible,
                "score": score,
                "avg20_2024": first.stress_avg_bps,
                "pf20_2024": first.stress_pf,
                "trades_2024": first.stress_trades,
                "breadth_2024": first.stress_breadth,
                "avg20_2025H1": second.stress_avg_bps,
                "pf20_2025H1": second.stress_pf,
                "trades_2025H1": second.stress_trades,
                "breadth_2025H1": second.stress_breadth,
            }
        )
    selection = pd.DataFrame(selection_rows).sort_values(
        ["eligible", "score"], ascending=[False, False]
    )
    selection.to_csv(output / "SELECTION_BEFORE_2025H2.csv", index=False)
    chosen_name = str(selection.iloc[0].config)
    chosen = next(cfg for cfg in CONFIGS if cfg.name == chosen_name)

    chosen_trades = []
    factual_rows = []
    for label, bounds in periods.items():
        trades = pd.DataFrame(trade_store[(chosen_name, label)])
        if len(trades):
            trades["period"] = label
            chosen_trades.append(trades)
        factual_rows.append(
            {
                "period": label,
                **{f"base_{key}": value for key, value in metrics(trades, BASE_COST).items()},
                **{f"stress_{key}": value for key, value in metrics(trades, STRESS_COST).items()},
            }
        )
    chosen_frame = pd.concat(chosen_trades, ignore_index=True) if chosen_trades else pd.DataFrame()
    chosen_frame.to_csv(output / "CHOSEN_TRADES.csv", index=False)
    factual = pd.DataFrame(factual_rows)
    factual.to_csv(output / "FACTUAL_RESULTS.csv", index=False)

    account_rows = []
    for label, bounds in {
        "full_2024_to_july2026": (START, END),
        "test_2025H2_to_july2026": (CUT2, END),
        "fresh_2026H1_to_july": (CUT3, END),
    }.items():
        for risk_pct in [1.0, 2.0, 3.0, 5.0, 7.5, 10.0]:
            result = account(chosen_frame, risk_pct, STRESS_COST, *bounds)
            account_rows.append({"sample": label, **result})
    account_frame = pd.DataFrame(account_rows)
    account_frame.to_csv(output / "ACCOUNT_SCENARIOS.csv", index=False)

    summary = {
        "generated_at": datetime.now(UTC).isoformat(),
        "configs": len(CONFIGS),
        "eligible_configs": int(selection.eligible.sum()),
        "chosen": asdict(chosen),
        "selection": selection.head(20).to_dict(orient="records"),
        "factual": factual_rows,
        "account_scenarios": account_rows,
    }
    (output / "SUMMARY.json").write_text(json.dumps(summary, indent=2, default=str))
    (output / "REPORT_RU.md").write_text(
        "# Round 34 — altcoin trend breakout\n\n"
        "## Selection before 2025 H2\n\n"
        + selection.head(30).to_markdown(index=False, floatfmt=".3f")
        + "\n\n## Factual periods\n\n"
        + factual.to_markdown(index=False, floatfmt=".3f")
        + "\n\n## Account scenarios at 20 bps\n\n"
        + account_frame.to_markdown(index=False, floatfmt=".3f")
        + "\n"
    )
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
