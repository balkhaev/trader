#!/usr/bin/env python3
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

PAIRS = [
    ("SOLUSDT", "AVAXUSDT"), ("APTUSDT", "SUIUSDT"),
    ("ARBUSDT", "OPUSDT"), ("INJUSDT", "SEIUSDT"),
    ("DOTUSDT", "ATOMUSDT"), ("NEARUSDT", "ATOMUSDT"),
    ("AAVEUSDT", "UNIUSDT"), ("DOGEUSDT", "1000SHIBUSDT"),
    ("1000PEPEUSDT", "1000BONKUSDT"), ("BCHUSDT", "LTCUSDT"),
    ("FILUSDT", "ICPUSDT"), ("STXUSDT", "ICPUSDT"),
    ("XRPUSDT", "ADAUSDT"), ("LINKUSDT", "TRXUSDT"),
    ("TIAUSDT", "SUIUSDT"),
]
SYMBOLS = sorted({symbol for pair in PAIRS for symbol in pair})
INTERVAL = "15m"
WARMUP_START = pd.Timestamp("2023-11-01", tz="UTC")
START = pd.Timestamp("2024-01-01", tz="UTC")
CUT1 = pd.Timestamp("2025-01-01", tz="UTC")
CUT2 = pd.Timestamp("2025-07-01", tz="UTC")
CUT3 = pd.Timestamp("2026-01-01", tz="UTC")
END = pd.Timestamp("2026-07-01", tz="UTC")
PAIR_COST_BPS = 40.0
KLINE_BASE = "https://data.binance.vision/data/futures/um/monthly/klines"
FUNDING_BASE = "https://data.binance.vision/data/futures/um/monthly/fundingRate"
COLS = [
    "open_time", "open", "high", "low", "close", "volume", "close_time",
    "quote_volume", "trades", "taker_buy_base", "taker_buy_quote", "ignore",
]


@dataclass(frozen=True)
class Config:
    name: str
    mode: str
    beta_window: int
    shock_horizon: int
    z_threshold: float
    hold_bars: int
    stop_bps: float


CONFIGS = [
    Config(
        f"{mode.upper()}_W{window}_H{horizon}_Z{int(z*10)}_T{hold}_S{int(stop)}",
        mode, window, horizon, z, hold, stop,
    )
    for mode in ("reversion", "momentum")
    for window in (1344, 2880)
    for horizon in (16, 32)
    for z in (2.0, 2.5)
    for hold in (16, 32)
    for stop in (200.0, 300.0)
]


def get(url: str, timeout: int = 120) -> requests.Response:
    last: Exception | None = None
    for attempt in range(5):
        try:
            response = requests.get(url, timeout=timeout, headers={"User-Agent": "sector-pair-round53/1"})
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
    symbol, month, kind, url, path = task
    path.parent.mkdir(parents=True, exist_ok=True)
    meta: dict[str, object] = {"symbol": symbol, "month": month, "kind": kind, "url": url, "path": str(path)}
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
    for symbol in SYMBOLS:
        for period in months:
            month = period.strftime("%Y-%m")
            name = f"{symbol}-{INTERVAL}-{month}.zip"
            output.append((symbol, month, "kline", f"{KLINE_BASE}/{symbol}/{INTERVAL}/{name}", cache / "kline" / symbol / name))
            fund_name = f"{symbol}-fundingRate-{month}.zip"
            output.append((symbol, month, "funding", f"{FUNDING_BASE}/{symbol}/{fund_name}", cache / "funding" / symbol / fund_name))
    return output


def download_all(cache: Path, workers: int) -> list[dict[str, object]]:
    work = tasks(cache)
    result = []
    with cf.ThreadPoolExecutor(max_workers=workers) as executor:
        for index, item in enumerate(executor.map(fetch_verified, work), 1):
            result.append(item)
            if index % 250 == 0:
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
        return pd.DataFrame(columns=COLS)
    frame = pd.read_csv(io.BytesIO(raw), header=None, low_memory=False).iloc[:, :12]
    frame.columns = COLS
    frame.open_time = parse_time(frame.open_time)
    for column in COLS[1:-1]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame.dropna(subset=["open_time", "open", "close"])


def read_funding(path: Path) -> pd.DatetimeIndex:
    raw = first_member(path)
    if not raw:
        return pd.DatetimeIndex([], tz="UTC")
    table = pd.read_csv(io.BytesIO(raw), low_memory=False)
    if "calc_time" in table.columns:
        values = table.calc_time
    else:
        table = pd.read_csv(io.BytesIO(raw), header=None, low_memory=False)
        values = table.iloc[:, 0]
    return pd.DatetimeIndex(parse_time(values).dropna())


def load_symbol(symbol: str, manifest: list[dict[str, object]]) -> tuple[pd.DataFrame, pd.DatetimeIndex]:
    parts = [read_kline(path) for path in paths(symbol, manifest, "kline")]
    funding_parts = [read_funding(path) for path in paths(symbol, manifest, "funding")]
    frame = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=COLS)
    frame = frame[(frame.open_time >= WARMUP_START) & (frame.open_time < END)].sort_values("open_time").drop_duplicates("open_time").reset_index(drop=True)
    values = np.concatenate([index.astype("int64") for index in funding_parts]) if funding_parts else np.array([], dtype="int64")
    return frame, pd.DatetimeIndex(values, tz="UTC").drop_duplicates().sort_values()


def build_pair(a: str, b: str, frames: dict[str, pd.DataFrame]) -> pd.DataFrame:
    left = frames[a][["open_time", "open", "close"]].rename(columns={"open": "a_open", "close": "a_close"})
    right = frames[b][["open_time", "open", "close"]].rename(columns={"open": "b_open", "close": "b_close"})
    pair = left.merge(right, on="open_time", how="inner").sort_values("open_time").reset_index(drop=True)
    pair["a_log"] = np.log(pair.a_close)
    pair["b_log"] = np.log(pair.b_close)
    pair["a_ret"] = pair.a_log.diff()
    pair["b_ret"] = pair.b_log.diff()
    for window in (1344, 2880):
        covariance = pair.a_ret.rolling(window, min_periods=window // 3).cov(pair.b_ret).shift(1)
        variance = pair.b_ret.rolling(window, min_periods=window // 3).var().shift(1).replace(0, np.nan)
        beta = (covariance / variance).clip(lower=0.10, upper=3.0)
        pair[f"beta{window}"] = beta
        for horizon in (16, 32):
            residual = pair.a_log.diff(horizon) - beta * pair.b_log.diff(horizon)
            residual_std = residual.shift(1).rolling(window, min_periods=window // 3).std().replace(0, np.nan)
            pair[f"z{window}_{horizon}"] = residual / residual_std
    return pair


def crosses(events: pd.DatetimeIndex, entry: pd.Timestamp, exit_: pd.Timestamp) -> bool:
    values = events.astype("int64").to_numpy()
    if not len(values):
        return False
    index = np.searchsorted(values, entry.value, side="left")
    return index < len(values) and values[index] <= exit_.value


def simulate_pair(pair_name: str, a: str, b: str, frame: pd.DataFrame,
                  funding: dict[str, pd.DatetimeIndex], cfg: Config,
                  start: pd.Timestamp, end: pd.Timestamp) -> list[dict[str, object]]:
    z = frame[f"z{cfg.beta_window}_{cfg.shock_horizon}"].to_numpy(float)
    times = list(frame.open_time)
    time_ns = frame.open_time.astype("int64").to_numpy()
    a_open = frame.a_open.to_numpy(float)
    b_open = frame.b_open.to_numpy(float)
    mask = np.isfinite(z) & (np.abs(z) >= cfg.z_threshold) & (frame.open_time.dt.minute == 45).to_numpy()
    first = np.searchsorted(time_ns, start.value)
    final = np.searchsorted(time_ns, end.value)
    candidates = np.flatnonzero(mask & (np.arange(len(frame)) >= first) & (np.arange(len(frame)) < final))
    rows = []
    last_exit = -1
    for signal_index in candidates:
        entry_index = signal_index + 1
        if entry_index <= last_exit or entry_index >= final:
            continue
        scheduled_exit = entry_index + cfg.hold_bars
        if scheduled_exit >= final:
            continue
        entry_time = times[entry_index]
        scheduled_time = times[scheduled_exit]
        if entry_time.date() != scheduled_time.date():
            continue
        if crosses(funding[a], entry_time, scheduled_time) or crosses(funding[b], entry_time, scheduled_time):
            continue
        sign = 1 if z[signal_index] > 0 else -1
        # Positive residual means A outperformed B. Reversion shorts A/longs B;
        # momentum does the opposite.
        side_a = -sign if cfg.mode == "reversion" else sign
        side_b = -side_a
        entry_a, entry_b = a_open[entry_index], b_open[entry_index]
        if min(entry_a, entry_b) <= 0:
            continue
        exit_index = scheduled_exit
        reason = "time"
        for j in range(entry_index + 1, scheduled_exit + 1):
            gross = (
                side_a * (a_open[j] / entry_a - 1)
                + side_b * (b_open[j] / entry_b - 1)
            ) * 1e4
            if gross <= -cfg.stop_bps:
                exit_index = j
                reason = "pair_stop"
                break
        gross = (
            side_a * (a_open[exit_index] / entry_a - 1)
            + side_b * (b_open[exit_index] / entry_b - 1)
        ) * 1e4
        rows.append({
            "config": cfg.name, "pair": pair_name, "symbol_a": a,
            "symbol_b": b, "side_a": side_a, "side_b": side_b,
            "signal_time": times[signal_index], "entry_time": entry_time,
            "exit_time": times[exit_index], "signal_z": z[signal_index],
            "gross_pair_bps": gross, "net40_bps": gross - PAIR_COST_BPS,
            "reason": reason,
        })
        last_exit = exit_index
    return rows


def metrics(trades: pd.DataFrame) -> dict[str, float | int]:
    if trades.empty:
        return {"trades": 0, "avg_bps": np.nan, "pf": np.nan, "win_rate": np.nan, "pairs": 0, "breadth": np.nan}
    values = trades.net40_bps.to_numpy(float)
    loss = -values[values < 0].sum()
    by_pair = trades.groupby("pair").net40_bps.mean()
    return {"trades": int(len(values)), "avg_bps": float(values.mean()),
            "pf": float(values[values > 0].sum() / loss) if loss else float("inf"),
            "win_rate": float(np.mean(values > 0)), "pairs": int(len(by_pair)),
            "breadth": float((by_pair > 0).mean()) if len(by_pair) else np.nan}


def account(trades: pd.DataFrame, fraction_per_pair: float,
            start: pd.Timestamp, end: pd.Timestamp,
            capital: float = 10_000.0, max_pairs: int = 4,
            gross_cap: float = 4.0) -> dict[str, float | int]:
    if trades.empty:
        return {"fraction_per_pair": fraction_per_pair, "return_pct": 0.0, "cagr_pct": 0.0, "closed_dd_pct": 0.0, "trades": 0}
    data = trades.sort_values(["entry_time", "signal_z"], ascending=[True, False]).reset_index(drop=True)
    equity, peak, max_dd = capital, capital, 0.0
    open_positions: dict[int, float] = {}
    accepted = 0
    for timestamp in sorted(set(data.entry_time) | set(data.exit_time)):
        for idx, notional in list(open_positions.items()):
            row = data.iloc[idx]
            if row.exit_time == timestamp and row.entry_time < timestamp:
                equity += notional * row.net40_bps / 1e4
                peak = max(peak, equity); max_dd = max(max_dd, 1 - equity / peak)
                del open_positions[idx]
        for idx in data.index[data.entry_time == timestamp]:
            row = data.iloc[idx]
            if len(open_positions) >= max_pairs:
                continue
            used = {symbol for position_idx in open_positions for symbol in (data.iloc[position_idx].symbol_a, data.iloc[position_idx].symbol_b)}
            if row.symbol_a in used or row.symbol_b in used:
                continue
            notional = equity * fraction_per_pair
            remaining = max(0.0, equity * gross_cap - sum(2 * value for value in open_positions.values()))
            notional = min(notional, remaining / 2)
            if notional > 0:
                open_positions[idx] = notional; accepted += 1
        for idx, notional in list(open_positions.items()):
            row = data.iloc[idx]
            if row.exit_time == timestamp and row.entry_time == timestamp:
                equity += notional * row.net40_bps / 1e4
                peak = max(peak, equity); max_dd = max(max_dd, 1 - equity / peak)
                del open_positions[idx]
    years = max((end - start).days / 365.25, 1 / 365.25)
    cagr = -100.0 if equity <= 0 else ((equity / capital) ** (1 / years) - 1) * 100
    return {"fraction_per_pair": fraction_per_pair, "end_usd": equity,
            "return_pct": (equity / capital - 1) * 100, "cagr_pct": cagr,
            "closed_dd_pct": max_dd * 100, "trades": accepted,
            "max_pairs": max_pairs, "gross_cap_x": gross_cap}


def main() -> None:
    parser = argparse.ArgumentParser(); parser.add_argument("--output", required=True, type=Path); parser.add_argument("--cache", required=True, type=Path); parser.add_argument("--workers", type=int, default=32)
    args = parser.parse_args(); args.output.mkdir(parents=True, exist_ok=True); args.cache.mkdir(parents=True, exist_ok=True)
    manifest = download_all(args.cache, args.workers); pd.DataFrame(manifest).to_csv(args.output / "SOURCE_MANIFEST.csv", index=False)
    frames, funding, coverage = {}, {}, []
    for symbol in SYMBOLS:
        frame, events = load_symbol(symbol, manifest)
        coverage.append({"symbol": symbol, "rows": len(frame), "funding_events": len(events), "first": None if frame.empty else frame.open_time.iloc[0], "last": None if frame.empty else frame.open_time.iloc[-1]})
        if len(frame):
            frames[symbol] = frame; funding[symbol] = events
    pd.DataFrame(coverage).to_csv(args.output / "COVERAGE.csv", index=False)
    pair_frames = {f"{a}__{b}": build_pair(a, b, frames) for a, b in PAIRS if a in frames and b in frames}
    periods = {"2024": (START, CUT1), "2025H1": (CUT1, CUT2), "2025H2": (CUT2, CUT3), "2026H1": (CUT3, END)}
    stores, grid = {}, []
    for index, cfg in enumerate(CONFIGS, 1):
        stores[cfg.name] = {}
        for label, (start, end) in periods.items():
            rows = []
            for pair_name, frame in pair_frames.items():
                a, b = pair_name.split("__")
                rows.extend(simulate_pair(pair_name, a, b, frame, funding, cfg, start, end))
            trades = pd.DataFrame(rows)
            if len(trades):
                for column in ("signal_time", "entry_time", "exit_time"):
                    trades[column] = pd.to_datetime(trades[column], utc=True)
            stores[cfg.name][label] = trades
            grid.append({"config": cfg.name, "period": label, **asdict(cfg), **metrics(trades)})
        if index % 16 == 0:
            print(f"configs {index}/{len(CONFIGS)}", flush=True)
    pd.DataFrame(grid).to_csv(args.output / "CONFIG_RESULTS_ALL_PERIODS.csv", index=False)
    selection = []
    for cfg in CONFIGS:
        a, b = metrics(stores[cfg.name]["2024"]), metrics(stores[cfg.name]["2025H1"])
        eligible = (a["trades"] >= 50 and b["trades"] >= 25 and a["avg_bps"] > 0 and b["avg_bps"] > 0 and a["pf"] >= 1.15 and b["pf"] >= 1.15 and min(a["breadth"], b["breadth"]) >= 0.50)
        score = min(a["avg_bps"], b["avg_bps"]) * math.sqrt(min(a["trades"], b["trades"]) / 25) * min(a["pf"], b["pf"], 3) if eligible else -1e9
        selection.append({"config": cfg.name, "eligible": eligible, "score": score, **{f"2024_{k}": v for k, v in a.items()}, **{f"2025H1_{k}": v for k, v in b.items()}})
    selection_frame = pd.DataFrame(selection).sort_values("score", ascending=False); selection_frame.to_csv(args.output / "SELECTION_BEFORE_LATE_PERIODS.csv", index=False)
    chosen_name = str(selection_frame.iloc[0].config); chosen = next(cfg for cfg in CONFIGS if cfg.name == chosen_name)
    factual, accounts, late_parts = [], [], []
    for label in ("2025H2", "2026H1"):
        start, end = periods[label]; trades = stores[chosen.name][label]
        trades.to_csv(args.output / f"CHOSEN_TRADES_{label}.csv", index=False); factual.append({"period": label, **metrics(trades)}); late_parts.append(trades)
        for fraction in (0.05, 0.10, 0.20, 0.33, 0.50, 0.75):
            accounts.append({"period": label, **account(trades, fraction, start, end)})
    late = pd.concat(late_parts, ignore_index=True) if any(len(frame) for frame in late_parts) else pd.DataFrame(); factual.append({"period": "LATE_12M", **metrics(late)})
    for fraction in (0.05, 0.10, 0.20, 0.33, 0.50, 0.75):
        accounts.append({"period": "LATE_12M", **account(late, fraction, CUT2, END)})
    pd.DataFrame(factual).to_csv(args.output / "FACTUAL_LATE_RESULTS.csv", index=False); pd.DataFrame(accounts).to_csv(args.output / "ACCOUNT_SCENARIOS.csv", index=False)
    summary = {"generated_at": datetime.now(UTC).isoformat(), "pairs": len(pair_frames), "configs": len(CONFIGS), "eligible_configs": int(selection_frame.eligible.sum()), "chosen": asdict(chosen), "factual": factual, "accounts": accounts, "selection": selection_frame.to_dict(orient="records")}
    (args.output / "SUMMARY.json").write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    (args.output / "REPORT_RU.md").write_text("# Round 53 — sector pair residual stat-arb\n\n" + pd.DataFrame(factual).to_markdown(index=False, floatfmt=".3f") + "\n\n" + pd.DataFrame(accounts).to_markdown(index=False, floatfmt=".3f") + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
