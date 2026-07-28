#!/usr/bin/env python3
from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import io
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
    "BTCUSD_PERP", "ETHUSD_PERP", "BNBUSD_PERP", "XRPUSD_PERP",
    "ADAUSD_PERP", "DOGEUSD_PERP", "SOLUSD_PERP", "LINKUSD_PERP",
    "LTCUSD_PERP", "BCHUSD_PERP",
]
INTERVAL = "5m"
WARMUP_START = pd.Timestamp("2024-06-01", tz="UTC")
START = pd.Timestamp("2024-07-01", tz="UTC")
CUT1 = pd.Timestamp("2025-01-01", tz="UTC")
CUT2 = pd.Timestamp("2025-07-01", tz="UTC")
CUT3 = pd.Timestamp("2026-01-01", tz="UTC")
END = pd.Timestamp("2026-07-01", tz="UTC")
COST_BPS = 20.0
KLINE_BASE = "https://data.binance.vision/data/futures/cm/monthly/klines"
LIQ_BASE = "https://data.binance.vision/data/futures/cm/daily/liquidationSnapshot"
KLINE_COLS = [
    "open_time", "open", "high", "low", "close", "volume", "close_time",
    "base_volume", "trades", "taker_buy_volume", "taker_buy_base", "ignore",
]


@dataclass(frozen=True)
class Config:
    name: str
    family: str
    side: int
    move_atr: float
    liq_z: float
    side_share: float
    wick: float
    hold: int
    stop_atr: float
    target_r: float


CONFIGS: list[Config] = []
for side, label in ((1, "LONG_AFTER_SELL"), (-1, "SHORT_AFTER_BUY")):
    for move in (1.5, 2.0):
        for liq_z in (1.0, 2.0):
            for wick in (0.35, 0.50):
                for hold in (6, 12, 24):
                    CONFIGS.append(Config(
                        f"REV_{label}_M{int(move*10)}_Z{int(liq_z*10)}_W{int(wick*100)}_H{hold}",
                        "reversal", side, move, liq_z, 0.70, wick, hold, 1.5, 3.0,
                    ))
for side, label in ((-1, "SELL_CASCADE"), (1, "BUY_SQUEEZE")):
    for move in (1.5, 2.0):
        for liq_z in (1.0, 2.0):
            for hold in (3, 6, 12):
                CONFIGS.append(Config(
                    f"CONT_{label}_M{int(move*10)}_Z{int(liq_z*10)}_H{hold}",
                    "continuation", side, move, liq_z, 0.75, 0.0, hold, 1.5, 2.0,
                ))


def get(url: str, timeout: int = 120) -> requests.Response:
    last: Exception | None = None
    for attempt in range(5):
        try:
            response = requests.get(url, timeout=timeout, headers={"User-Agent": "coinm-liquidation-round49/1"})
            if response.status_code == 404:
                return response
            response.raise_for_status()
            return response
        except Exception as exc:
            last = exc
            time.sleep(1 + attempt)
    raise RuntimeError(f"{url}: {last}")


def file_sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch_verified(task: tuple[str, str, str, str, Path]) -> dict[str, object]:
    symbol, period, kind, url, path = task
    path.parent.mkdir(parents=True, exist_ok=True)
    meta: dict[str, object] = {"symbol": symbol, "period": period, "kind": kind, "url": url, "path": str(path)}
    try:
        checksum = get(url + ".CHECKSUM", 60)
        if checksum.status_code == 404:
            return meta | {"status": "missing"}
        expected = checksum.text.strip().split()[0].lower()
        if path.exists() and file_sha(path) == expected:
            return meta | {"status": "cached_verified", "sha256": expected, "bytes": path.stat().st_size}
        response = get(url, 180)
        if response.status_code == 404:
            return meta | {"status": "missing"}
        actual = hashlib.sha256(response.content).hexdigest()
        if actual != expected:
            raise RuntimeError(f"checksum {actual} != {expected}")
        temp = path.with_suffix(path.suffix + ".tmp")
        temp.write_bytes(response.content)
        temp.replace(path)
        return meta | {"status": "downloaded_verified", "sha256": actual, "bytes": len(response.content)}
    except Exception as exc:
        return meta | {"status": "error", "error": str(exc)}


def tasks(cache: Path) -> list[tuple[str, str, str, str, Path]]:
    output = []
    months = pd.period_range(WARMUP_START.tz_localize(None), (END - pd.Timedelta(days=1)).tz_localize(None), freq="M")
    days = pd.date_range(WARMUP_START, END - pd.Timedelta(days=1), freq="1D")
    for symbol in SYMBOLS:
        for period in months:
            month = period.strftime("%Y-%m")
            name = f"{symbol}-{INTERVAL}-{month}.zip"
            output.append((symbol, month, "kline", f"{KLINE_BASE}/{symbol}/{INTERVAL}/{name}", cache / "kline" / symbol / name))
        for day in days:
            date = day.strftime("%Y-%m-%d")
            name = f"{symbol}-liquidationSnapshot-{date}.zip"
            output.append((symbol, date, "liquidation", f"{LIQ_BASE}/{symbol}/{name}", cache / "liquidation" / symbol / name))
    return output


def download_all(cache: Path, workers: int) -> list[dict[str, object]]:
    work = tasks(cache)
    result = []
    with cf.ThreadPoolExecutor(max_workers=workers) as executor:
        for index, item in enumerate(executor.map(fetch_verified, work), 1):
            result.append(item)
            if index % 500 == 0:
                print(f"archives {index}/{len(work)}", flush=True)
    return result


def paths(symbol: str, manifest: list[dict[str, object]], kind: str) -> list[Path]:
    return sorted(
        Path(str(item["path"])) for item in manifest
        if item["symbol"] == symbol and item["kind"] == kind
        and item["status"] in {"cached_verified", "downloaded_verified"}
    )


def first_member(path: Path) -> bytes:
    with zipfile.ZipFile(path) as bundle:
        names = [name for name in bundle.namelist() if not name.endswith("/")]
        return bundle.read(names[0]) if names else b""


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
    frame.open_time = parse_time(frame.open_time)
    for column in KLINE_COLS[1:-1]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame.dropna(subset=["open_time", "open", "high", "low", "close", "volume"])


def norm(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value).lower())


def read_liquidation(path: Path) -> pd.DataFrame:
    raw = first_member(path)
    if not raw:
        return pd.DataFrame(columns=["time", "side", "quantity", "price"])
    first = pd.read_csv(io.BytesIO(raw), low_memory=False)
    mapping = {norm(column): column for column in first.columns}
    if not any(key in mapping for key in ("time", "tradetime", "updatetime")):
        first = pd.read_csv(io.BytesIO(raw), header=None, low_memory=False)
        names = ["symbol", "price", "orig_qty", "executed_qty", "average_price", "status", "time_in_force", "type", "side", "time"]
        first = first.iloc[:, :min(first.shape[1], len(names))]
        first.columns = names[:first.shape[1]]
        mapping = {norm(column): column for column in first.columns}
    time_col = next((mapping[key] for key in ("time", "tradetime", "updatetime", "eventtime") if key in mapping), None)
    side_col = next((mapping[key] for key in ("side",) if key in mapping), None)
    qty_col = next((mapping[key] for key in ("executedquantity", "executedqty", "filledquantity", "cumqty", "origquantity", "origqty", "quantity") if key in mapping), None)
    price_col = next((mapping[key] for key in ("averageprice", "avgprice", "price") if key in mapping), None)
    if time_col is None or side_col is None or qty_col is None or price_col is None:
        return pd.DataFrame(columns=["time", "side", "quantity", "price"])
    output = pd.DataFrame({
        "time": parse_time(first[time_col]),
        "side": first[side_col].astype(str).str.upper(),
        "quantity": pd.to_numeric(first[qty_col], errors="coerce"),
        "price": pd.to_numeric(first[price_col], errors="coerce"),
    })
    return output.dropna(subset=["time", "quantity", "price"])


def load_symbol(symbol: str, manifest: list[dict[str, object]]) -> tuple[pd.DataFrame, pd.DataFrame]:
    klines = [read_kline(path) for path in paths(symbol, manifest, "kline")]
    liquidations = [read_liquidation(path) for path in paths(symbol, manifest, "liquidation")]
    kline = pd.concat(klines, ignore_index=True) if klines else pd.DataFrame(columns=KLINE_COLS)
    liq = pd.concat(liquidations, ignore_index=True) if liquidations else pd.DataFrame(columns=["time", "side", "quantity", "price"])
    kline = kline[(kline.open_time >= WARMUP_START) & (kline.open_time < END)].sort_values("open_time").drop_duplicates("open_time").reset_index(drop=True)
    liq = liq[(liq.time >= WARMUP_START) & (liq.time < END)].sort_values("time").reset_index(drop=True)
    return kline, liq


def atr(frame: pd.DataFrame, periods: int = 14) -> pd.Series:
    previous = frame.close.shift()
    tr = pd.concat([
        frame.high - frame.low,
        (frame.high - previous).abs(),
        (frame.low - previous).abs(),
    ], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / periods, adjust=False, min_periods=periods).mean()


def zscore(series: pd.Series, window: int, minimum: int) -> pd.Series:
    mean = series.rolling(window, min_periods=minimum).mean()
    std = series.rolling(window, min_periods=minimum).std().replace(0, np.nan)
    return (series - mean) / std


def features(kline: pd.DataFrame, liquidation: pd.DataFrame) -> pd.DataFrame:
    frame = kline.copy()
    for column in ("open", "high", "low", "close", "volume"):
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame["atr"] = atr(frame)
    frame["atr_pct"] = frame.atr / frame.close
    frame["move3"] = frame.close.pct_change(3) / frame.atr_pct.replace(0, np.nan)
    frame["move6"] = frame.close.pct_change(6) / frame.atr_pct.replace(0, np.nan)
    candle_range = (frame.high - frame.low).replace(0, np.nan)
    body_high = frame[["open", "close"]].max(axis=1)
    body_low = frame[["open", "close"]].min(axis=1)
    frame["uwick"] = (frame.high - body_high) / candle_range
    frame["lwick"] = (body_low - frame.low) / candle_range
    frame["cpos"] = (frame.close - frame.low) / candle_range
    frame["contig"] = frame.open_time.diff().eq(pd.Timedelta(minutes=5)).rolling(7, min_periods=7).sum().eq(7)
    if liquidation.empty:
        for column in ("sell_qty", "buy_qty", "liq_qty", "liq_count", "sell_share", "buy_share", "liq_ratio", "liq_z"):
            frame[column] = 0.0
        return frame
    liq = liquidation.copy()
    liq["bucket"] = liq.time.dt.floor("5min")
    liq["sell_qty"] = np.where(liq.side == "SELL", liq.quantity, 0.0)
    liq["buy_qty"] = np.where(liq.side == "BUY", liq.quantity, 0.0)
    aggregate = liq.groupby("bucket").agg(
        sell_qty=("sell_qty", "sum"), buy_qty=("buy_qty", "sum"),
        liq_qty=("quantity", "sum"), liq_count=("quantity", "size"),
    ).reset_index().rename(columns={"bucket": "open_time"})
    frame = frame.merge(aggregate, on="open_time", how="left")
    for column in ("sell_qty", "buy_qty", "liq_qty", "liq_count"):
        frame[column] = frame[column].fillna(0.0)
    frame["sell_share"] = frame.sell_qty / frame.liq_qty.replace(0, np.nan)
    frame["buy_share"] = frame.buy_qty / frame.liq_qty.replace(0, np.nan)
    frame["liq_ratio"] = frame.liq_qty / frame.volume.replace(0, np.nan)
    # One month of 5-minute bars; minimum one week. Per-symbol normalization
    # makes contract multipliers irrelevant.
    frame["liq_z"] = zscore(np.log1p(frame.liq_qty), 8640, 2016)
    return frame


def signal(frame: pd.DataFrame, cfg: Config) -> tuple[pd.Series, pd.Series]:
    if cfg.family == "reversal" and cfg.side == 1:
        mask = (frame.contig & (frame.move3 <= -cfg.move_atr) & (frame.liq_z >= cfg.liq_z)
                & (frame.sell_share >= cfg.side_share) & (frame.lwick >= cfg.wick) & (frame.cpos >= 0.55))
        strength = -frame.move3 + frame.liq_z + frame.sell_share + frame.lwick
    elif cfg.family == "reversal" and cfg.side == -1:
        mask = (frame.contig & (frame.move3 >= cfg.move_atr) & (frame.liq_z >= cfg.liq_z)
                & (frame.buy_share >= cfg.side_share) & (frame.uwick >= cfg.wick) & (frame.cpos <= 0.45))
        strength = frame.move3 + frame.liq_z + frame.buy_share + frame.uwick
    elif cfg.family == "continuation" and cfg.side == -1:
        mask = (frame.contig & (frame.move3 <= -cfg.move_atr) & (frame.liq_z >= cfg.liq_z)
                & (frame.sell_share >= cfg.side_share) & (frame.cpos <= 0.20))
        strength = -frame.move3 + frame.liq_z + frame.sell_share
    else:
        mask = (frame.contig & (frame.move3 >= cfg.move_atr) & (frame.liq_z >= cfg.liq_z)
                & (frame.buy_share >= cfg.side_share) & (frame.cpos >= 0.80))
        strength = frame.move3 + frame.liq_z + frame.buy_share
    return mask.fillna(False), strength.replace([np.inf, -np.inf], np.nan).fillna(0.0)


def simulate_symbol(symbol: str, frame: pd.DataFrame, cfg: Config,
                    start: pd.Timestamp, end: pd.Timestamp) -> list[dict[str, object]]:
    mask, strength = signal(frame, cfg)
    timestamps = frame.open_time.astype("int64").to_numpy()
    first = np.searchsorted(timestamps, start.value)
    final = np.searchsorted(timestamps, end.value)
    candidates = np.flatnonzero(mask.to_numpy() & (np.arange(len(frame)) >= first) & (np.arange(len(frame)) < final))
    arrays = {column: frame[column].to_numpy(float) for column in ("open", "high", "low", "atr", "liq_z", "sell_share", "buy_share")}
    times = list(frame.open_time)
    rows = []
    last_exit = -1
    for signal_index in candidates:
        entry_index = signal_index + 1
        if entry_index <= last_exit or entry_index >= final:
            continue
        scheduled_exit = entry_index + cfg.hold
        if scheduled_exit >= final:
            continue
        if times[entry_index].date() != times[scheduled_exit].date():
            continue
        entry = arrays["open"][entry_index]
        a = arrays["atr"][signal_index]
        if not np.isfinite(entry) or not np.isfinite(a) or a <= 0:
            continue
        stop = entry - cfg.side * cfg.stop_atr * a
        target = entry + cfg.side * cfg.stop_atr * cfg.target_r * a
        exit_price = arrays["open"][scheduled_exit]
        exit_index = scheduled_exit
        reason = "time"
        for j in range(entry_index, scheduled_exit):
            opening, high, low = arrays["open"][j], arrays["high"][j], arrays["low"][j]
            if cfg.side == 1 and opening <= stop:
                exit_price, exit_index, reason = opening, j, "stop_gap"; break
            if cfg.side == -1 and opening >= stop:
                exit_price, exit_index, reason = opening, j, "stop_gap"; break
            if cfg.side == 1 and opening >= target:
                exit_price, exit_index, reason = opening, j, "target_gap"; break
            if cfg.side == -1 and opening <= target:
                exit_price, exit_index, reason = opening, j, "target_gap"; break
            stop_hit = (cfg.side == 1 and low <= stop) or (cfg.side == -1 and high >= stop)
            target_hit = (cfg.side == 1 and high >= target) or (cfg.side == -1 and low <= target)
            if stop_hit:
                exit_price, exit_index, reason = stop, j, "stop"; break
            if target_hit:
                exit_price, exit_index, reason = target, j, "target"; break
        gross = cfg.side * (exit_price / entry - 1) * 1e4
        rows.append({
            "config": cfg.name, "family": cfg.family, "symbol": symbol,
            "side": cfg.side, "signal_time": times[signal_index],
            "entry_time": times[entry_index], "exit_time": times[exit_index],
            "gross_bps": gross, "net20_bps": gross - COST_BPS,
            "stop_distance_bps": abs(stop / entry - 1) * 1e4 + COST_BPS,
            "strength": float(strength.iloc[signal_index]),
            "liq_z": float(arrays["liq_z"][signal_index]),
            "sell_share": float(arrays["sell_share"][signal_index]) if np.isfinite(arrays["sell_share"][signal_index]) else np.nan,
            "buy_share": float(arrays["buy_share"][signal_index]) if np.isfinite(arrays["buy_share"][signal_index]) else np.nan,
            "reason": reason,
        })
        last_exit = exit_index
    return rows


def metrics(trades: pd.DataFrame) -> dict[str, float | int]:
    if trades.empty:
        return {"trades": 0, "avg_bps": np.nan, "pf": np.nan, "win_rate": np.nan, "symbols": 0, "breadth": np.nan, "avg_R": np.nan}
    values = trades.net20_bps.to_numpy(float)
    loss = -values[values < 0].sum()
    by_symbol = trades.groupby("symbol").net20_bps.mean()
    r = values / trades.stop_distance_bps.to_numpy(float)
    return {"trades": int(len(values)), "avg_bps": float(values.mean()),
            "pf": float(values[values > 0].sum() / loss) if loss else float("inf"),
            "win_rate": float(np.mean(values > 0)), "symbols": int(len(by_symbol)),
            "breadth": float((by_symbol > 0).mean()) if len(by_symbol) else np.nan,
            "avg_R": float(r.mean())}


def account(trades: pd.DataFrame, risk_pct: float, start: pd.Timestamp, end: pd.Timestamp,
            capital: float = 10_000.0, max_positions: int = 4, gross_cap: float = 4.0) -> dict[str, float | int]:
    if trades.empty:
        return {"risk_pct": risk_pct, "return_pct": 0.0, "cagr_pct": 0.0, "closed_dd_pct": 0.0, "trades": 0}
    data = trades.sort_values(["entry_time", "strength"], ascending=[True, False]).reset_index(drop=True)
    equity, peak, max_dd = capital, capital, 0.0
    open_positions: dict[int, float] = {}
    accepted = 0
    for timestamp in sorted(set(data.entry_time) | set(data.exit_time)):
        for idx, notional in list(open_positions.items()):
            row = data.iloc[idx]
            if row.exit_time == timestamp and row.entry_time < timestamp:
                equity += notional * row.net20_bps / 1e4
                peak = max(peak, equity); max_dd = max(max_dd, 1 - equity / peak)
                del open_positions[idx]
        for idx in data.index[data.entry_time == timestamp]:
            row = data.iloc[idx]
            if len(open_positions) >= max_positions:
                continue
            if any(data.iloc[j].symbol == row.symbol for j in open_positions):
                continue
            distance = row.stop_distance_bps / 1e4
            notional = min(equity * (risk_pct / 100) / distance, equity * 2)
            remaining = max(0.0, equity * gross_cap - sum(open_positions.values()))
            notional = min(notional, remaining)
            if notional > 0:
                open_positions[idx] = notional; accepted += 1
        for idx, notional in list(open_positions.items()):
            row = data.iloc[idx]
            if row.exit_time == timestamp and row.entry_time == timestamp:
                equity += notional * row.net20_bps / 1e4
                peak = max(peak, equity); max_dd = max(max_dd, 1 - equity / peak)
                del open_positions[idx]
    years = max((end - start).days / 365.25, 1 / 365.25)
    cagr = -100.0 if equity <= 0 else ((equity / capital) ** (1 / years) - 1) * 100
    return {"risk_pct": risk_pct, "end_usd": equity, "return_pct": (equity / capital - 1) * 100,
            "cagr_pct": cagr, "closed_dd_pct": max_dd * 100, "trades": accepted,
            "max_positions": max_positions, "gross_cap_x": gross_cap}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--workers", type=int, default=40)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True); args.cache.mkdir(parents=True, exist_ok=True)
    manifest = download_all(args.cache, args.workers)
    pd.DataFrame(manifest).to_csv(args.output / "SOURCE_MANIFEST.csv", index=False)

    frames: dict[str, pd.DataFrame] = {}
    coverage = []
    for symbol in SYMBOLS:
        kline, liquidation = load_symbol(symbol, manifest)
        coverage.append({"symbol": symbol, "kline_rows": len(kline), "liquidation_rows": len(liquidation),
                         "first_kline": None if kline.empty else kline.open_time.iloc[0],
                         "last_kline": None if kline.empty else kline.open_time.iloc[-1],
                         "first_liquidation": None if liquidation.empty else liquidation.time.iloc[0],
                         "last_liquidation": None if liquidation.empty else liquidation.time.iloc[-1]})
        if len(kline) and len(liquidation):
            frames[symbol] = features(kline, liquidation)
    pd.DataFrame(coverage).to_csv(args.output / "COVERAGE.csv", index=False)

    periods = {"2024H2": (START, CUT1), "2025H1": (CUT1, CUT2), "2025H2": (CUT2, CUT3), "2026H1": (CUT3, END)}
    stores: dict[str, dict[str, pd.DataFrame]] = {}
    grid = []
    for cfg in CONFIGS:
        stores[cfg.name] = {}
        for label, (start, end) in periods.items():
            rows = []
            for symbol, frame in frames.items():
                rows.extend(simulate_symbol(symbol, frame, cfg, start, end))
            trades = pd.DataFrame(rows)
            if len(trades):
                for column in ("signal_time", "entry_time", "exit_time"):
                    trades[column] = pd.to_datetime(trades[column], utc=True)
            stores[cfg.name][label] = trades
            grid.append({"config": cfg.name, "period": label, **asdict(cfg), **metrics(trades)})
    pd.DataFrame(grid).to_csv(args.output / "CONFIG_RESULTS_ALL_PERIODS.csv", index=False)

    selection = []
    for cfg in CONFIGS:
        a, b = metrics(stores[cfg.name]["2024H2"]), metrics(stores[cfg.name]["2025H1"])
        eligible = (a["trades"] >= 20 and b["trades"] >= 20 and a["avg_bps"] > 0 and b["avg_bps"] > 0
                    and a["pf"] >= 1.15 and b["pf"] >= 1.15 and min(a["breadth"], b["breadth"]) >= 0.50)
        score = min(a["avg_bps"], b["avg_bps"]) * math.sqrt(min(a["trades"], b["trades"]) / 20) * min(a["pf"], b["pf"], 3) if eligible else -1e9
        selection.append({"config": cfg.name, "eligible": eligible, "score": score,
                          **{f"2024H2_{k}": v for k, v in a.items()}, **{f"2025H1_{k}": v for k, v in b.items()}})
    selection_frame = pd.DataFrame(selection).sort_values("score", ascending=False)
    selection_frame.to_csv(args.output / "SELECTION_BEFORE_LATE_PERIODS.csv", index=False)
    chosen_name = str(selection_frame.iloc[0].config)
    chosen = next(cfg for cfg in CONFIGS if cfg.name == chosen_name)

    factual, accounts, late_parts = [], [], []
    for label in ("2025H2", "2026H1"):
        trades = stores[chosen.name][label]
        trades.to_csv(args.output / f"CHOSEN_TRADES_{label}.csv", index=False)
        factual.append({"period": label, **metrics(trades)})
        late_parts.append(trades)
        start, end = periods[label]
        for risk in (0.5, 1.0, 2.0, 4.0, 6.0):
            accounts.append({"period": label, **account(trades, risk, start, end)})
    late = pd.concat(late_parts, ignore_index=True) if any(len(frame) for frame in late_parts) else pd.DataFrame()
    factual.append({"period": "LATE_12M", **metrics(late)})
    for risk in (0.5, 1.0, 2.0, 4.0, 6.0):
        accounts.append({"period": "LATE_12M", **account(late, risk, CUT2, END)})
    pd.DataFrame(factual).to_csv(args.output / "FACTUAL_LATE_RESULTS.csv", index=False)
    pd.DataFrame(accounts).to_csv(args.output / "ACCOUNT_SCENARIOS.csv", index=False)
    summary = {"generated_at": datetime.now(UTC).isoformat(), "configs": len(CONFIGS),
               "eligible_configs": int(selection_frame.eligible.sum()), "chosen": asdict(chosen),
               "coverage": coverage, "factual": factual, "accounts": accounts,
               "selection": selection_frame.to_dict(orient="records")}
    (args.output / "SUMMARY.json").write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    (args.output / "REPORT_RU.md").write_text(
        "# Round 49 — COIN-M liquidation clusters\n\n"
        "Используются фактические liquidationSnapshot и 5m klines. Конфигурация выбирается на 2024H2 и 2025H1, "
        "затем без изменения проверяется на 2025H2 и 2026H1. Издержки — 20 bps.\n\n"
        + pd.DataFrame(factual).to_markdown(index=False, floatfmt=".3f") + "\n\n"
        + pd.DataFrame(accounts).to_markdown(index=False, floatfmt=".3f") + "\n",
        encoding="utf-8")
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
