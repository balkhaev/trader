from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import io
import json
import math
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
]
INTERVAL = "15m"
WARMUP_START = pd.Timestamp("2025-06-01", tz="UTC")
START = pd.Timestamp("2025-07-01", tz="UTC")
CUT = pd.Timestamp("2026-01-01", tz="UTC")
PRE_JULY_END = pd.Timestamp("2026-07-01", tz="UTC")
JULY_END = pd.Timestamp("2026-07-27", tz="UTC")
BASE_COST = 12.0
STRESS_COST = 20.0

BASE = "https://data.binance.vision/data/futures/um"
KLINE_MONTHLY = f"{BASE}/monthly/klines"
KLINE_DAILY = f"{BASE}/daily/klines"
PREMIUM_MONTHLY = f"{BASE}/monthly/premiumIndexKlines"
PREMIUM_DAILY = f"{BASE}/daily/premiumIndexKlines"
METRICS_DAILY = f"{BASE}/daily/metrics"
FUNDING_MONTHLY = f"{BASE}/monthly/fundingRate"

KLINE_COLS = [
    "open_time", "open", "high", "low", "close", "volume", "close_time",
    "quote_volume", "trades", "taker_buy_base", "taker_buy_quote", "ignore",
]
METRIC_COLS = [
    "create_time", "symbol", "sum_open_interest", "sum_open_interest_value",
    "count_toptrader_long_short_ratio", "sum_toptrader_long_short_ratio",
    "count_long_short_ratio", "sum_taker_long_short_vol_ratio",
]


@dataclass(frozen=True)
class Config:
    name: str
    move: float
    volz: float
    wick: float
    cpos: float
    oi_z: float | None
    premium_z: float | None
    retail_z: float | None
    top_z: float | None
    hold: int
    stop: float
    target: float | None


CONFIGS = [
    Config("FLOW_OI_LOOSE45", 1.5, 0.5, 0.40, 0.55, -0.5, None, None, None, 3, 1.5, 3.0),
    Config("FLOW_OI_STRICT60", 2.0, 1.0, 0.50, 0.60, -1.0, None, None, None, 4, 1.25, 3.0),
    Config("FLOW_PREM_LOOSE45", 1.5, 0.5, 0.40, 0.55, None, -1.0, None, None, 3, 1.5, 3.0),
    Config("FLOW_PREM_STRICT60", 2.0, 1.0, 0.50, 0.60, None, -1.5, None, None, 4, 1.25, 3.0),
    Config("FLOW_OI_PREM60", 1.5, 0.5, 0.40, 0.55, -0.5, -0.75, None, None, 4, 1.25, 4.0),
    Config("FLOW_OI_PREM90", 1.5, 0.5, 0.40, 0.55, -0.5, -0.75, None, None, 6, 1.25, None),
    Config("FLOW_OI_RETAIL60", 1.5, 0.5, 0.40, 0.55, -0.5, None, -0.75, None, 4, 1.25, 4.0),
    Config("FLOW_OI_TOP60", 1.5, 0.5, 0.40, 0.55, -0.5, None, None, 0.5, 4, 1.25, 4.0),
    Config("FLOW_PREM_RETAIL60", 1.5, 0.5, 0.40, 0.55, None, -0.75, -0.75, None, 4, 1.25, 4.0),
    Config("FLOW_ALL_CONFLUENCE90", 1.5, 0.5, 0.40, 0.55, -0.5, -0.75, -0.5, None, 6, 1.25, None),
]


def _get(url: str, timeout: int = 120) -> requests.Response:
    last: Exception | None = None
    for attempt in range(5):
        try:
            response = requests.get(
                url,
                timeout=timeout,
                headers={"User-Agent": "altcoin-confluence-round28/1"},
            )
            if response.status_code == 404:
                return response
            response.raise_for_status()
            return response
        except Exception as exc:
            last = exc
            time.sleep(1 + attempt)
    raise RuntimeError(f"{url}: {last}")


def _sha_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _task(symbol: str, period: str, kind: str, url: str, path: Path) -> tuple:
    return symbol, period, kind, url, path


def make_tasks(cache: Path) -> list[tuple]:
    tasks: list[tuple] = []
    months = pd.period_range(
        WARMUP_START.tz_localize(None),
        (PRE_JULY_END - pd.Timedelta(days=1)).tz_localize(None),
        freq="M",
    )
    days_metrics = pd.date_range(WARMUP_START, JULY_END - pd.Timedelta(days=1), freq="1D")
    july_days = pd.date_range(PRE_JULY_END, JULY_END - pd.Timedelta(days=1), freq="1D")
    for symbol in SYMBOLS:
        for period in months:
            month = period.strftime("%Y-%m")
            kname = f"{symbol}-{INTERVAL}-{month}.zip"
            tasks.append(_task(
                symbol, month, "kline_monthly",
                f"{KLINE_MONTHLY}/{symbol}/{INTERVAL}/{kname}",
                cache / "kline_monthly" / symbol / kname,
            ))
            pname = f"{symbol}-{INTERVAL}-{month}.zip"
            tasks.append(_task(
                symbol, month, "premium_monthly",
                f"{PREMIUM_MONTHLY}/{symbol}/{INTERVAL}/{pname}",
                cache / "premium_monthly" / symbol / pname,
            ))
            fname = f"{symbol}-fundingRate-{month}.zip"
            tasks.append(_task(
                symbol, month, "funding_monthly",
                f"{FUNDING_MONTHLY}/{symbol}/{fname}",
                cache / "funding_monthly" / symbol / fname,
            ))
        for day in july_days:
            date = day.strftime("%Y-%m-%d")
            kname = f"{symbol}-{INTERVAL}-{date}.zip"
            tasks.append(_task(
                symbol, date, "kline_daily",
                f"{KLINE_DAILY}/{symbol}/{INTERVAL}/{kname}",
                cache / "kline_daily" / symbol / kname,
            ))
            pname = f"{symbol}-{INTERVAL}-{date}.zip"
            tasks.append(_task(
                symbol, date, "premium_daily",
                f"{PREMIUM_DAILY}/{symbol}/{INTERVAL}/{pname}",
                cache / "premium_daily" / symbol / pname,
            ))
        for day in days_metrics:
            date = day.strftime("%Y-%m-%d")
            mname = f"{symbol}-metrics-{date}.zip"
            tasks.append(_task(
                symbol, date, "metrics_daily",
                f"{METRICS_DAILY}/{symbol}/{mname}",
                cache / "metrics_daily" / symbol / mname,
            ))
    return tasks


def fetch_verified(task: tuple) -> dict[str, object]:
    symbol, period, kind, url, path = task
    path.parent.mkdir(parents=True, exist_ok=True)
    meta = {
        "symbol": symbol, "period": period, "kind": kind,
        "url": url, "path": str(path),
    }
    try:
        checksum = _get(url + ".CHECKSUM", 60)
        if checksum.status_code == 404:
            return meta | {"status": "missing"}
        expected = checksum.text.strip().split()[0].lower()
        if path.exists() and _sha_file(path) == expected:
            return meta | {"status": "cached_verified", "sha256": expected, "bytes": path.stat().st_size}
        response = _get(url, 180)
        if response.status_code == 404:
            return meta | {"status": "missing"}
        actual = _sha_bytes(response.content)
        if actual != expected:
            raise RuntimeError(f"checksum {actual} != {expected}")
        temp = path.with_suffix(path.suffix + ".tmp")
        temp.write_bytes(response.content)
        temp.replace(path)
        return meta | {"status": "downloaded_verified", "sha256": actual, "bytes": len(response.content)}
    except Exception as exc:
        return meta | {"status": "error", "error": str(exc)}


def download_all(cache: Path, workers: int) -> list[dict[str, object]]:
    tasks = make_tasks(cache)
    output: list[dict[str, object]] = []
    with cf.ThreadPoolExecutor(max_workers=workers) as executor:
        for index, result in enumerate(executor.map(fetch_verified, tasks), 1):
            output.append(result)
            if index % 250 == 0:
                print(f"archives {index}/{len(tasks)}", flush=True)
    return output


def verified_paths(symbol: str, manifest: list[dict[str, object]], kinds: set[str]) -> list[Path]:
    return sorted(
        Path(str(item["path"]))
        for item in manifest
        if item["symbol"] == symbol
        and item["kind"] in kinds
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
    frame["open_time"] = parse_time(frame.open_time)
    for column in KLINE_COLS[1:-1]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame.dropna(subset=["open_time", "open", "high", "low", "close", "volume"])


def read_metrics(path: Path) -> pd.DataFrame:
    raw = first_member(path)
    if not raw:
        return pd.DataFrame(columns=METRIC_COLS)
    frame = pd.read_csv(io.BytesIO(raw), low_memory=False)
    normalized = {str(c).strip().lower(): c for c in frame.columns}
    if "create_time" in normalized:
        frame = frame.rename(columns={v: k for k, v in normalized.items()})
    else:
        frame = pd.read_csv(io.BytesIO(raw), header=None, low_memory=False)
        frame = frame.iloc[:, : len(METRIC_COLS)]
        frame.columns = METRIC_COLS[: frame.shape[1]]
    for column in METRIC_COLS:
        if column not in frame:
            frame[column] = np.nan
    frame = frame[METRIC_COLS]
    text_time = pd.to_datetime(frame.create_time, utc=True, errors="coerce")
    if text_time.notna().mean() >= 0.8:
        frame["create_time"] = text_time
    else:
        frame["create_time"] = parse_time(frame.create_time)
    for column in METRIC_COLS[2:]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame.dropna(subset=["create_time", "sum_open_interest_value"])


def load_concat(symbol: str, manifest: list[dict[str, object]], kinds: set[str], reader) -> pd.DataFrame:
    parts = [reader(path) for path in verified_paths(symbol, manifest, kinds)]
    if not parts:
        return pd.DataFrame()
    time_col = "open_time" if "open_time" in parts[0].columns else "create_time"
    frame = pd.concat(parts, ignore_index=True)
    return (
        frame[(frame[time_col] >= WARMUP_START) & (frame[time_col] < JULY_END)]
        .sort_values(time_col)
        .drop_duplicates(time_col)
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
        if values else pd.Series([], dtype="datetime64[ns, UTC]")
    )
    july = pd.date_range(PRE_JULY_END, JULY_END, freq="8h", tz="UTC")
    combined = pd.DatetimeIndex(list(historical) + list(july))
    return combined[(combined >= WARMUP_START) & (combined < JULY_END)].drop_duplicates().sort_values()


def atr(frame: pd.DataFrame, n: int = 14) -> pd.Series:
    prev = frame.close.shift()
    tr = pd.concat(
        [frame.high - frame.low, (frame.high - prev).abs(), (frame.low - prev).abs()],
        axis=1,
    ).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


def rolling_z(series: pd.Series, window: int = 672, minimum: int = 192) -> pd.Series:
    mean = series.rolling(window, min_periods=minimum).mean()
    std = series.rolling(window, min_periods=minimum).std().replace(0, np.nan)
    return (series - mean) / std


def build_features(kline: pd.DataFrame, premium: pd.DataFrame, metrics: pd.DataFrame) -> pd.DataFrame:
    frame = kline.copy()
    frame["atr"] = atr(frame)
    frame["atr_pct"] = frame.atr / frame.close
    frame["move3"] = frame.close.pct_change(3) / frame.atr_pct.replace(0, np.nan)
    logq = np.log1p(frame.quote_volume.clip(lower=0))
    frame["volz"] = rolling_z(logq)
    candle_range = (frame.high - frame.low).replace(0, np.nan)
    body_low = frame[["open", "close"]].min(axis=1)
    frame["lwick"] = (body_low - frame.low) / candle_range
    frame["cpos"] = (frame.close - frame.low) / candle_range
    frame["imb1"] = (2 * frame.taker_buy_base / frame.volume.replace(0, np.nan) - 1).clip(-1, 1)

    prem = premium[["open_time", "close"]].rename(columns={"close": "premium_close"}).copy()
    prem["premium_z"] = rolling_z(prem.premium_close)
    frame = pd.merge_asof(
        frame.sort_values("open_time"),
        prem.sort_values("open_time"),
        on="open_time",
        direction="backward",
        tolerance=pd.Timedelta(minutes=15),
    )

    m = metrics.copy().set_index("create_time").sort_index()
    m15 = m.resample("15min", label="left", closed="left").last().dropna(how="all")
    m15["oi_ret3"] = m15.sum_open_interest_value.pct_change(3)
    m15["oi_z"] = rolling_z(m15.oi_ret3)
    m15["retail_z"] = rolling_z(np.log(m15.count_long_short_ratio.clip(lower=1e-9)))
    m15["top_z"] = rolling_z(np.log(m15.sum_toptrader_long_short_ratio.clip(lower=1e-9)))
    m15["position_taker_z"] = rolling_z(np.log(m15.sum_taker_long_short_vol_ratio.clip(lower=1e-9)))
    m15 = m15.reset_index()
    frame = pd.merge_asof(
        frame.sort_values("open_time"),
        m15[["create_time", "oi_z", "retail_z", "top_z", "position_taker_z"]].sort_values("create_time"),
        left_on="open_time",
        right_on="create_time",
        direction="backward",
        tolerance=pd.Timedelta(minutes=15),
    )
    return frame


def crosses(events_ns: np.ndarray, entry_ns: int, exit_ns: int) -> bool:
    if not len(events_ns):
        return False
    index = np.searchsorted(events_ns, entry_ns, side="left")
    return index < len(events_ns) and events_ns[index] <= exit_ns


def signal(frame: pd.DataFrame, cfg: Config) -> np.ndarray:
    mask = (
        (frame.move3 <= -cfg.move)
        & (frame.volz >= cfg.volz)
        & (frame.lwick >= cfg.wick)
        & (frame.cpos >= cfg.cpos)
        & (frame.imb1 >= -0.1)
    )
    if cfg.oi_z is not None:
        mask &= frame.oi_z <= cfg.oi_z
    if cfg.premium_z is not None:
        mask &= frame.premium_z <= cfg.premium_z
    if cfg.retail_z is not None:
        mask &= frame.retail_z <= cfg.retail_z
    if cfg.top_z is not None:
        mask &= frame.top_z >= cfg.top_z
    return mask.fillna(False).to_numpy()


def simulate(
    symbol: str,
    frame: pd.DataFrame,
    events: pd.DatetimeIndex,
    cfg: Config,
    start: pd.Timestamp,
    end: pd.Timestamp,
) -> list[dict[str, object]]:
    mask = signal(frame, cfg)
    times = list(frame.open_time)
    time_ns = frame.open_time.astype("int64").to_numpy()
    open_ = frame.open.to_numpy(float)
    high = frame.high.to_numpy(float)
    low = frame.low.to_numpy(float)
    atrv = frame.atr.to_numpy(float)
    strength = (
        frame.move3.abs().fillna(0)
        + (-frame.oi_z).clip(lower=0).fillna(0) / 2
        + (-frame.premium_z).clip(lower=0).fillna(0) / 2
    ).to_numpy(float)
    event_ns = events.astype("int64").to_numpy()
    first = np.searchsorted(time_ns, start.value)
    final = np.searchsorted(time_ns, end.value)
    candidates = np.flatnonzero(mask & (np.arange(len(frame)) >= first) & (np.arange(len(frame)) < final))
    trades: list[dict[str, object]] = []
    last_exit = -1
    for signal_index in candidates:
        if signal_index <= last_exit or signal_index + 1 >= final:
            continue
        entry_index = signal_index + 1
        scheduled = entry_index + cfg.hold
        if scheduled >= final or not np.isfinite(atrv[signal_index]):
            continue
        if times[entry_index].date() != times[scheduled].date():
            continue
        if crosses(event_ns, int(time_ns[entry_index]), int(time_ns[scheduled])):
            continue
        entry = open_[entry_index]
        stop = entry - cfg.stop * atrv[signal_index]
        risk = entry - stop
        target = None if cfg.target is None else entry + cfg.target * risk
        exit_price = open_[scheduled]
        exit_index = scheduled
        reason = "time"
        mae = 0.0
        mfe = 0.0
        for i in range(entry_index, scheduled):
            mae = min(mae, (low[i] / entry - 1) * 1e4)
            mfe = max(mfe, (high[i] / entry - 1) * 1e4)
            if open_[i] <= stop:
                exit_price, exit_index, reason = open_[i], i, "stop_gap"
                break
            if low[i] <= stop:
                exit_price, exit_index, reason = stop, i, "stop"
                break
            if target is not None and high[i] >= target:
                exit_price, exit_index, reason = target, i, "target"
                break
        gross = (exit_price / entry - 1) * 1e4
        trades.append({
            "config": cfg.name,
            "symbol": symbol,
            "signal_time": times[signal_index],
            "entry_time": times[entry_index],
            "exit_time": times[exit_index],
            "gross_bps": gross,
            "net_bps": gross - BASE_COST,
            "stop_distance_bps": abs((stop / entry - 1) * 1e4),
            "strength": strength[signal_index],
            "reason": reason,
            "mae_bps": mae,
            "mfe_bps": mfe,
        })
        last_exit = exit_index
    return trades


def metrics(df: pd.DataFrame, cost: float = BASE_COST) -> dict[str, float | int]:
    if df.empty:
        return {"trades": 0, "avg_bps": np.nan, "pf": np.nan, "win_rate": np.nan, "total_bps": 0.0, "payoff": np.nan}
    values = df.gross_bps.to_numpy(float) - cost
    gains = values[values > 0]
    losses = -values[values < 0]
    return {
        "trades": int(len(values)),
        "avg_bps": float(values.mean()),
        "pf": float(gains.sum() / losses.sum()) if losses.sum() else float("inf"),
        "win_rate": float(np.mean(values > 0)),
        "total_bps": float(values.sum()),
        "payoff": float(gains.mean() / losses.mean()) if len(gains) and len(losses) else np.nan,
        "best_bps": float(values.max()),
        "worst_bps": float(values.min()),
    }


def breadth(df: pd.DataFrame, cost: float) -> float:
    if df.empty:
        return 0.0
    grouped = df.assign(adj=df.gross_bps - cost).groupby("symbol").agg(n=("adj", "size"), avg=("adj", "mean"))
    eligible = grouped[grouped.n >= 5]
    return float((eligible.avg > 0).mean()) if len(eligible) else 0.0


def day_bootstrap(df: pd.DataFrame, n: int = 30000) -> dict[str, float]:
    if df.empty:
        return {"lo": np.nan, "hi": np.nan, "p_positive": np.nan}
    x = df.copy()
    x["day"] = pd.to_datetime(x.entry_time, utc=True).dt.floor("D")
    groups = [g.net_bps.to_numpy(float) for _, g in x.groupby("day")]
    rng = np.random.default_rng(2801)
    out = np.empty(n)
    for i in range(n):
        out[i] = np.concatenate([groups[j] for j in rng.integers(0, len(groups), len(groups))]).mean()
    return {
        "lo": float(np.quantile(out, 0.025)),
        "hi": float(np.quantile(out, 0.975)),
        "p_positive": float(np.mean(out > 0)),
    }


def capital_sprint(
    df: pd.DataFrame,
    risk_pct: float,
    capital: float = 10_000.0,
    max_positions: int = 4,
    max_gross: float = 2.0,
    cost: float = BASE_COST,
) -> dict[str, float | int]:
    if df.empty:
        return {}
    trades = df.sort_values(["entry_time", "strength"], ascending=[True, False]).copy()
    entries: dict[pd.Timestamp, list[pd.Series]] = {}
    exits: dict[pd.Timestamp, list[pd.Series]] = {}
    for _, row in trades.iterrows():
        entries.setdefault(pd.Timestamp(row.entry_time), []).append(row)
        exits.setdefault(pd.Timestamp(row.exit_time), []).append(row)
    equity = capital
    peak = capital
    max_dd = 0.0
    positions: dict[tuple[str, pd.Timestamp], float] = {}
    accepted = 0
    for ts in sorted(set(entries) | set(exits)):
        for row in exits.get(ts, []):
            key = (str(row.symbol), pd.Timestamp(row.entry_time))
            if key in positions:
                notional = positions.pop(key)
                pnl = notional * (float(row.gross_bps) - cost) / 1e4
                equity += pnl
                accepted += 1
                peak = max(peak, equity)
                max_dd = min(max_dd, equity / peak - 1)
        for row in entries.get(ts, []):
            if len(positions) >= max_positions:
                continue
            if any(k[0] == str(row.symbol) for k in positions):
                continue
            stop_fraction = max(float(row.stop_distance_bps) / 1e4, 1e-4)
            desired = equity * (risk_pct / 100) / stop_fraction
            gross_open = sum(positions.values())
            available = max(0.0, equity * max_gross - gross_open)
            notional = min(desired, available, equity)
            if notional <= 0:
                continue
            positions[(str(row.symbol), pd.Timestamp(row.entry_time))] = notional
    days = max(1, int((pd.to_datetime(df.exit_time, utc=True).max() - pd.to_datetime(df.entry_time, utc=True).min()).days) + 1)
    return {
        "risk_pct_per_trade": risk_pct,
        "start_usd": capital,
        "end_usd": equity,
        "pnl_usd": equity - capital,
        "return_pct": (equity / capital - 1) * 100,
        "mechanical_annualized_pct": ((equity / capital) ** (365 / days) - 1) * 100 if equity > 0 else -100.0,
        "closed_dd_pct": -max_dd * 100,
        "accepted_trades": accepted,
        "max_positions": max_positions,
        "max_gross_pct": max_gross * 100,
        "cost_bps": cost,
    }


def monte_carlo_sprint(
    df: pd.DataFrame,
    risk_pct: float,
    paths: int = 10000,
    trades_per_path: int = 250,
) -> dict[str, float]:
    if df.empty:
        return {}
    r = (df.net_bps / (df.stop_distance_bps + BASE_COST)).replace([np.inf, -np.inf], np.nan).dropna().to_numpy(float)
    if not len(r):
        return {}
    rng = np.random.default_rng(2817)
    ending = np.empty(paths)
    max_dd = np.empty(paths)
    doubled = np.zeros(paths, dtype=bool)
    half_loss = np.zeros(paths, dtype=bool)
    f = risk_pct / 100
    for p in range(paths):
        sampled = rng.choice(r, size=trades_per_path, replace=True)
        equity = 1.0
        peak = 1.0
        dd = 0.0
        for outcome in sampled:
            equity *= max(0.001, 1 + f * outcome)
            peak = max(peak, equity)
            dd = min(dd, equity / peak - 1)
            if equity >= 2:
                doubled[p] = True
            if equity <= 0.5:
                half_loss[p] = True
        ending[p] = equity
        max_dd[p] = -dd
    return {
        "risk_pct": risk_pct,
        "paths": paths,
        "trades_per_path": trades_per_path,
        "median_end_multiple": float(np.median(ending)),
        "p10_end_multiple": float(np.quantile(ending, 0.1)),
        "p90_end_multiple": float(np.quantile(ending, 0.9)),
        "p_double_within_path": float(doubled.mean()),
        "p_half_loss_within_path": float(half_loss.mean()),
        "median_max_dd_pct": float(np.median(max_dd) * 100),
        "p90_max_dd_pct": float(np.quantile(max_dd, 0.9) * 100),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--cache", required=True)
    parser.add_argument("--workers", type=int, default=32)
    args = parser.parse_args()
    output = Path(args.output)
    cache = Path(args.cache)
    output.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)

    manifest = download_all(cache, args.workers)
    pd.DataFrame(manifest).to_csv(output / "SOURCE_MANIFEST.csv", index=False)

    frames: dict[str, pd.DataFrame] = {}
    funding: dict[str, pd.DatetimeIndex] = {}
    coverage = []
    for symbol in SYMBOLS:
        kline = load_concat(symbol, manifest, {"kline_monthly", "kline_daily"}, read_kline)
        premium = load_concat(symbol, manifest, {"premium_monthly", "premium_daily"}, read_kline)
        metrics_frame = load_concat(symbol, manifest, {"metrics_daily"}, read_metrics)
        events = load_funding(symbol, manifest)
        complete = not kline.empty and not premium.empty and not metrics_frame.empty
        coverage.append({
            "symbol": symbol,
            "kline_rows": len(kline),
            "premium_rows": len(premium),
            "metrics_rows": len(metrics_frame),
            "funding_events": len(events),
            "complete": complete,
        })
        if complete:
            frames[symbol] = build_features(kline, premium, metrics_frame)
            funding[symbol] = events
        print(symbol, len(kline), len(premium), len(metrics_frame), complete, flush=True)
    pd.DataFrame(coverage).to_csv(output / "COVERAGE.csv", index=False)

    stores: dict[str, dict[str, pd.DataFrame]] = {}
    rows: list[dict[str, object]] = []
    for cfg in CONFIGS:
        stores[cfg.name] = {}
        for label, bounds in {
            "2025H2": (START, CUT),
            "2026H1": (CUT, PRE_JULY_END),
            "JULY": (PRE_JULY_END, JULY_END),
        }.items():
            trades = []
            for symbol, frame in frames.items():
                trades += simulate(symbol, frame, funding[symbol], cfg, *bounds)
            table = pd.DataFrame(trades)
            stores[cfg.name][label] = table
            m12 = metrics(table, BASE_COST)
            m20 = metrics(table, STRESS_COST)
            rows.append({
                "config": cfg.name,
                "period": label,
                **asdict(cfg),
                **{f"{k}_12": v for k, v in m12.items()},
                **{f"{k}_20": v for k, v in m20.items()},
                "breadth_12": breadth(table, BASE_COST),
                "breadth_20": breadth(table, STRESS_COST),
            })
    grid = pd.DataFrame(rows)
    grid.to_csv(output / "CONFIG_RESULTS.csv", index=False)

    selection_rows = []
    for cfg in CONFIGS:
        a = grid[(grid.config == cfg.name) & (grid.period == "2025H2")].iloc[0]
        b = grid[(grid.config == cfg.name) & (grid.period == "2026H1")].iloc[0]
        eligible = (
            a.trades_12 >= 40 and b.trades_12 >= 40
            and a.avg_bps_12 > 0 and b.avg_bps_12 > 0
            and a.avg_bps_20 > 0 and b.avg_bps_20 > 0
            and a.pf_12 > 1.05 and b.pf_12 > 1.05
            and a.breadth_12 >= 0.35 and b.breadth_12 >= 0.35
        )
        score = (
            min(a.avg_bps_20, b.avg_bps_20)
            * math.sqrt(min(a.trades_12, b.trades_12) / 100)
            * min(a.pf_12, b.pf_12, 3)
            if eligible else -1e9
        )
        selection_rows.append({
            "config": cfg.name,
            "eligible": bool(eligible),
            "score": float(score),
            "trades_2025H2": int(a.trades_12),
            "avg12_2025H2": float(a.avg_bps_12),
            "avg20_2025H2": float(a.avg_bps_20),
            "pf_2025H2": float(a.pf_12),
            "breadth_2025H2": float(a.breadth_12),
            "trades_2026H1": int(b.trades_12),
            "avg12_2026H1": float(b.avg_bps_12),
            "avg20_2026H1": float(b.avg_bps_20),
            "pf_2026H1": float(b.pf_12),
            "breadth_2026H1": float(b.breadth_12),
        })
    selection = pd.DataFrame(selection_rows).sort_values(["eligible", "score"], ascending=[False, False])
    selection.to_csv(output / "SELECTION_BEFORE_JULY.csv", index=False)
    chosen_name = str(selection.iloc[0].config)
    chosen = next(c for c in CONFIGS if c.name == chosen_name)
    pre = pd.concat([stores[chosen_name]["2025H2"], stores[chosen_name]["2026H1"]], ignore_index=True)
    july = stores[chosen_name]["JULY"].copy()
    pre.to_csv(output / "CHOSEN_PRE_JULY_TRADES.csv", index=False)
    july.to_csv(output / "JULY_TRADES.csv", index=False)

    coin_rows = []
    if not july.empty:
        for symbol, group in july.groupby("symbol"):
            coin_rows.append({"symbol": symbol, **metrics(group, BASE_COST), "avg20": metrics(group, STRESS_COST)["avg_bps"]})
    pd.DataFrame(coin_rows).sort_values("avg_bps", ascending=False).to_csv(output / "JULY_COIN_RANKING.csv", index=False)

    sprint_rows = []
    for risk in [0.25, 0.5, 1.0, 1.5, 2.0, 3.0]:
        sprint_rows.append({"sample": "pre_july", **capital_sprint(pre, risk)})
        sprint_rows.append({"sample": "july", **capital_sprint(july, risk)})
    pd.DataFrame(sprint_rows).to_csv(output / "CAPITAL_SPRINT_SCENARIOS.csv", index=False)

    mc_rows = [monte_carlo_sprint(pre, risk) for risk in [0.25, 0.5, 1.0, 1.5, 2.0, 3.0]]
    pd.DataFrame(mc_rows).to_csv(output / "MONTE_CARLO_SPRINT.csv", index=False)

    summary = {
        "generated_at": datetime.now(UTC).isoformat(),
        "symbols_requested": len(SYMBOLS),
        "symbols_complete": len(frames),
        "configs": len(CONFIGS),
        "eligible_configs": int(selection.eligible.sum()),
        "chosen": asdict(chosen),
        "selection": selection.to_dict(orient="records"),
        "july_12bps": metrics(july, BASE_COST),
        "july_20bps": metrics(july, STRESS_COST),
        "july_bootstrap": day_bootstrap(july),
        "sprint_scenarios": sprint_rows,
        "monte_carlo": mc_rows,
    }
    (output / "SUMMARY.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    (output / "REPORT_RU.md").write_text(
        "# Round 28 — deleveraging confluence и capital sprint\n\n"
        "Сигнал объединяет ценовую капитуляцию, OI flush, отрицательную premium и позиционирование.\n\n"
        "## Выбор до июля\n\n"
        + selection.to_markdown(index=False, floatfmt=".2f")
        + "\n\n## Фактический июль\n\n```json\n"
        + json.dumps({
            "chosen": asdict(chosen),
            "july_12bps": metrics(july, BASE_COST),
            "july_20bps": metrics(july, STRESS_COST),
            "july_bootstrap": day_bootstrap(july),
        }, ensure_ascii=False, indent=2)
        + "\n```\n\n## Capital sprint\n\n"
        + pd.DataFrame(sprint_rows).to_markdown(index=False, floatfmt=".2f")
        + "\n\n## Monte Carlo\n\n"
        + pd.DataFrame(mc_rows).to_markdown(index=False, floatfmt=".3f")
        + "\n"
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
