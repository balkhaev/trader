#!/usr/bin/env python3
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

SYMBOLS = ["SOLUSDT", "XRPUSDT", "DOGEUSDT"]
DEV_START = pd.Timestamp("2026-06-25", tz="UTC")
DEV_END = pd.Timestamp("2026-07-01", tz="UTC")
TEST_START = pd.Timestamp("2026-07-01", tz="UTC")
TEST_END = pd.Timestamp("2026-07-07", tz="UTC")
BOOK_BASE = "https://data.binance.vision/data/futures/um/daily/bookTicker"
BASE_COST = 8.0
STRESS_COST = 12.0

@dataclass(frozen=True)
class Config:
    name: str
    family: str
    side: int
    imbalance: float
    move5_bps: float
    ttl: int
    hold: int
    penetration_bps: float
    min_spread_bps: float

CONFIGS: list[Config] = []
for side, imbalance, hold in itertools.product((1, -1), (0.45, 0.65, 0.80), (2, 5, 10)):
    CONFIGS.append(Config(f"TAKER_{'L' if side==1 else 'S'}_I{int(imbalance*100)}_H{hold}", "taker", side, imbalance, 0.0, 0, hold, 0.0, 0.0))
for side, imbalance, ttl, hold, pen in itertools.product((1, -1), (0.45, 0.65, 0.80), (2, 5), (5, 10), (0.0, 0.20)):
    CONFIGS.append(Config(f"PASS_{'L' if side==1 else 'S'}_I{int(imbalance*100)}_T{ttl}_H{hold}_P{int(pen*10)}", "passive", side, imbalance, 0.0, ttl, hold, pen, 0.0))
for side, imbalance, move, ttl, hold in itertools.product((1, -1), (0.35, 0.55), (1.0, 2.0), (2, 5), (5, 10)):
    CONFIGS.append(Config(f"FADE_{'L' if side==1 else 'S'}_I{int(imbalance*100)}_M{int(move*10)}_T{ttl}_H{hold}", "fade", side, imbalance, move, ttl, hold, 0.20, 0.0))


def get(url: str, timeout: int = 180) -> requests.Response:
    last = None
    for attempt in range(6):
        try:
            response = requests.get(url, timeout=timeout, headers={"User-Agent": "bookticker-round43/1"})
            if response.status_code == 404:
                return response
            response.raise_for_status()
            return response
        except Exception as exc:
            last = exc
            time.sleep(2 + attempt * 2)
    raise RuntimeError(f"{url}: {last}")


def sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch(task: tuple[str, str, str, Path]) -> dict[str, object]:
    symbol, date, url, path = task
    path.parent.mkdir(parents=True, exist_ok=True)
    meta: dict[str, object] = {"symbol": symbol, "date": date, "url": url, "path": str(path)}
    try:
        checksum = get(url + ".CHECKSUM", 60)
        if checksum.status_code == 404:
            return meta | {"status": "missing"}
        match = re.search(r"\b([0-9a-fA-F]{64})\b", checksum.text)
        if not match:
            raise RuntimeError("invalid checksum")
        expected = match.group(1).lower()
        if path.exists() and sha(path) == expected:
            return meta | {"status": "cached_verified", "sha256": expected, "bytes": path.stat().st_size}
        response = get(url, 300)
        if response.status_code == 404:
            return meta | {"status": "missing"}
        actual = hashlib.sha256(response.content).hexdigest()
        if actual != expected:
            raise RuntimeError(f"sha {actual} != {expected}")
        temp = path.with_suffix(path.suffix + ".tmp")
        temp.write_bytes(response.content)
        temp.replace(path)
        return meta | {"status": "downloaded_verified", "sha256": actual, "bytes": len(response.content)}
    except Exception as exc:
        return meta | {"status": "error", "error": str(exc)}


def download_all(cache: Path, workers: int) -> list[dict[str, object]]:
    tasks = []
    for symbol in SYMBOLS:
        for day in pd.date_range(DEV_START, TEST_END - pd.Timedelta(days=1), freq="1D"):
            date = day.strftime("%Y-%m-%d")
            name = f"{symbol}-bookTicker-{date}.zip"
            tasks.append((symbol, date, f"{BOOK_BASE}/{symbol}/{name}", cache / symbol / name))
    rows = []
    with cf.ThreadPoolExecutor(max_workers=workers) as executor:
        for index, item in enumerate(executor.map(fetch, tasks), 1):
            rows.append(item)
            print(f"archives {index}/{len(tasks)}", flush=True)
    return rows


def parse_time(series: pd.Series) -> pd.Series:
    numeric = pd.to_numeric(series, errors="coerce")
    valid = numeric.dropna()
    if valid.empty:
        return pd.to_datetime(series, utc=True, errors="coerce")
    median = valid.median()
    unit = "us" if median > 1e14 else ("ms" if median > 1e11 else "s")
    return pd.to_datetime(numeric, unit=unit, utc=True, errors="coerce")


def read_day(path: Path) -> pd.DataFrame:
    with zipfile.ZipFile(path) as bundle:
        members = [name for name in bundle.namelist() if not name.endswith("/")]
        raw = bundle.read(members[0])
    first = raw.splitlines()[0].decode("utf-8", errors="replace").lower()
    header = any(token in first for token in ("best_bid", "bid_price", "update_id", "transaction_time"))
    frame = pd.read_csv(io.BytesIO(raw), header=0 if header else None, low_memory=False)
    if header:
        frame.columns = [str(c).strip().lower().replace(" ", "_") for c in frame.columns]
        aliases = {
            "best_bid_price": "bid",
            "bid_price": "bid",
            "best_bid_qty": "bid_qty",
            "bid_qty": "bid_qty",
            "best_ask_price": "ask",
            "ask_price": "ask",
            "best_ask_qty": "ask_qty",
            "ask_qty": "ask_qty",
            "transaction_time": "ts",
            "event_time": "event_ts",
            "time": "ts",
        }
        frame = frame.rename(columns={key: value for key, value in aliases.items() if key in frame.columns})
    else:
        if frame.shape[1] == 7:
            frame.columns = ["update_id", "bid", "bid_qty", "ask", "ask_qty", "ts", "event_ts"]
        elif frame.shape[1] >= 8:
            frame = frame.iloc[:, :8]
            frame.columns = ["update_id", "symbol", "bid", "bid_qty", "ask", "ask_qty", "ts", "event_ts"]
        else:
            raise ValueError(f"unexpected bookTicker schema {path}: {frame.shape[1]}")
    if "ts" not in frame and "event_ts" in frame:
        frame["ts"] = frame.event_ts
    required = ["bid", "bid_qty", "ask", "ask_qty", "ts"]
    if not set(required).issubset(frame.columns):
        raise ValueError(f"missing columns {path}: {frame.columns.tolist()}")
    for column in required[:-1]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame["time"] = parse_time(frame.ts)
    frame = frame.dropna(subset=["time", "bid", "ask", "bid_qty", "ask_qty"])
    frame = frame[(frame.bid > 0) & (frame.ask >= frame.bid)]
    frame["second"] = frame.time.dt.floor("s")
    second = frame.sort_values("time").groupby("second", sort=True).last().reset_index()
    return second[["second", "bid", "bid_qty", "ask", "ask_qty"]]


def load_symbol(cache: Path, symbol: str) -> pd.DataFrame:
    parts = []
    for path in sorted((cache / symbol).glob(f"{symbol}-bookTicker-*.zip")):
        try:
            parts.append(read_day(path))
        except Exception as exc:
            print("parse warning", path, exc, flush=True)
    if not parts:
        return pd.DataFrame()
    data = pd.concat(parts, ignore_index=True).sort_values("second").drop_duplicates("second")
    data["mid"] = (data.bid + data.ask) / 2
    data["spread_bps"] = (data.ask - data.bid) / data.mid * 1e4
    data["imbalance"] = (data.bid_qty - data.ask_qty) / (data.bid_qty + data.ask_qty).replace(0, np.nan)
    data["microprice"] = (data.ask * data.bid_qty + data.bid * data.ask_qty) / (data.bid_qty + data.ask_qty).replace(0, np.nan)
    data["micro_premium_bps"] = (data.microprice / data.mid - 1) * 1e4
    data["move5_bps"] = data.mid.pct_change(5) * 1e4
    data["contiguous"] = data.second.diff().eq(pd.Timedelta(seconds=1)).rolling(12, min_periods=12).sum().eq(12)
    return data.dropna().reset_index(drop=True)


def raw_signal(row: pd.Series, cfg: Config) -> bool:
    if not bool(row.contiguous) or row.spread_bps < cfg.min_spread_bps:
        return False
    if cfg.side == 1:
        imbalance_ok = row.imbalance >= cfg.imbalance and row.micro_premium_bps > 0
        move_ok = row.move5_bps <= -cfg.move5_bps if cfg.family == "fade" else True
    else:
        imbalance_ok = row.imbalance <= -cfg.imbalance and row.micro_premium_bps < 0
        move_ok = row.move5_bps >= cfg.move5_bps if cfg.family == "fade" else True
    return bool(imbalance_ok and move_ok)


def simulate(symbol: str, data: pd.DataFrame, cfg: Config, start: pd.Timestamp, end: pd.Timestamp, cost: float) -> pd.DataFrame:
    subset = data[(data.second >= start) & (data.second < end)].copy().reset_index(drop=True)
    if subset.empty:
        return pd.DataFrame()
    rows = []
    blocked_until = pd.Timestamp.min.tz_localize("UTC")
    for index, row in subset.iterrows():
        signal_time = row.second
        if signal_time <= blocked_until or not raw_signal(row, cfg):
            continue
        side = cfg.side
        if cfg.family == "taker":
            entry_index = index + 1
            if entry_index >= len(subset) or subset.second.iloc[entry_index] != signal_time + pd.Timedelta(seconds=1):
                continue
            entry = subset.ask.iloc[entry_index] if side == 1 else subset.bid.iloc[entry_index]
        else:
            limit = row.bid if side == 1 else row.ask
            entry_index = None
            for candidate in range(index + 1, min(index + cfg.ttl + 1, len(subset))):
                if subset.second.iloc[candidate] != signal_time + pd.Timedelta(seconds=candidate - index):
                    break
                penetration = limit * cfg.penetration_bps / 1e4
                filled = subset.ask.iloc[candidate] <= limit - penetration if side == 1 else subset.bid.iloc[candidate] >= limit + penetration
                if filled:
                    entry_index = candidate
                    break
            if entry_index is None:
                continue
            entry = limit
        exit_index = entry_index + cfg.hold
        if exit_index >= len(subset):
            continue
        if subset.second.iloc[exit_index] != subset.second.iloc[entry_index] + pd.Timedelta(seconds=cfg.hold):
            continue
        exit_price = subset.bid.iloc[exit_index] if side == 1 else subset.ask.iloc[exit_index]
        gross_bps = side * (exit_price / entry - 1) * 1e4
        rows.append({
            "config": cfg.name,
            "family": cfg.family,
            "symbol": symbol,
            "side": side,
            "signal_time": signal_time,
            "entry_time": subset.second.iloc[entry_index],
            "exit_time": subset.second.iloc[exit_index],
            "entry_price": float(entry),
            "exit_price": float(exit_price),
            "gross_bps": float(gross_bps),
            "net_bps": float(gross_bps - cost),
            "signal_spread_bps": float(row.spread_bps),
            "signal_imbalance": float(row.imbalance),
            "signal_move5_bps": float(row.move5_bps),
            "signal_micro_premium_bps": float(row.micro_premium_bps),
        })
        blocked_until = subset.second.iloc[exit_index]
    return pd.DataFrame(rows)


def metrics(frame: pd.DataFrame) -> dict[str, float | int]:
    if frame.empty:
        return {"trades": 0, "avg_bps": np.nan, "pf": np.nan, "win_rate": np.nan, "breadth": 0.0}
    values = frame.net_bps.to_numpy(float)
    losses = -values[values < 0].sum()
    by_symbol = frame.groupby("symbol").net_bps.agg(["count", "mean"])
    eligible = by_symbol[by_symbol["count"] >= 100]
    return {
        "trades": int(len(values)),
        "avg_bps": float(values.mean()),
        "pf": float(values[values > 0].sum() / losses) if losses else float("inf"),
        "win_rate": float(np.mean(values > 0)),
        "breadth": float((eligible["mean"] > 0).mean()) if len(eligible) else 0.0,
    }


def account(frame: pd.DataFrame, fraction: float, capital: float = 10_000.0) -> dict[str, float | int]:
    data = frame.sort_values(["entry_time", "symbol"]).reset_index(drop=True)
    equity = capital
    peak = capital
    drawdown = 0.0
    for _, trade in data.iterrows():
        equity += equity * fraction * float(trade.net_bps) / 1e4
        peak = max(peak, equity)
        drawdown = max(drawdown, 1 - equity / peak)
    days = (TEST_END - TEST_START).days
    return {
        "fraction_per_trade": fraction,
        "end_usd": float(equity),
        "return_pct": float((equity / capital - 1) * 100),
        "mechanical_annualized_pct": float(((equity / capital) ** (365 / days) - 1) * 100) if equity > 0 else -100.0,
        "closed_dd_pct": float(drawdown * 100),
        "trades": int(len(data)),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    manifest = download_all(args.cache, args.workers)
    pd.DataFrame(manifest).to_csv(args.output / "SOURCE_MANIFEST.csv", index=False)
    data = {}
    coverage = []
    for symbol in SYMBOLS:
        frame = load_symbol(args.cache, symbol)
        data[symbol] = frame
        coverage.append({"symbol": symbol, "seconds": len(frame), "first": None if frame.empty else frame.second.iloc[0], "last": None if frame.empty else frame.second.iloc[-1], "median_spread_bps": None if frame.empty else float(frame.spread_bps.median())})
    pd.DataFrame(coverage).to_csv(args.output / "COVERAGE.csv", index=False)
    stores = {}
    grid = []
    for cfg in CONFIGS:
        dev_parts = [simulate(symbol, frame, cfg, DEV_START, DEV_END, STRESS_COST) for symbol, frame in data.items()]
        dev = pd.concat(dev_parts, ignore_index=True) if dev_parts else pd.DataFrame()
        stores[cfg.name] = dev
        grid.append({"config": cfg.name, **asdict(cfg), **metrics(dev)})
    grid_frame = pd.DataFrame(grid).sort_values(["avg_bps", "pf"], ascending=False)
    grid_frame.to_csv(args.output / "DEV_CONFIG_RESULTS.csv", index=False)
    eligible = grid_frame[(grid_frame.trades >= 500) & (grid_frame.avg_bps > 0) & (grid_frame.pf >= 1.05) & (grid_frame.breadth >= 2 / 3)].copy()
    if len(eligible):
        eligible["score"] = eligible.avg_bps * np.sqrt(eligible.trades / 500) * np.minimum(eligible.pf, 3)
        chosen_row = eligible.sort_values("score", ascending=False).iloc[0]
    else:
        chosen_row = grid_frame.iloc[0]
    chosen = next(cfg for cfg in CONFIGS if cfg.name == chosen_row.config)
    test_parts = [simulate(symbol, frame, chosen, TEST_START, TEST_END, STRESS_COST) for symbol, frame in data.items()]
    test = pd.concat(test_parts, ignore_index=True) if test_parts else pd.DataFrame()
    test.to_csv(args.output / "TEST_TRADES.csv", index=False)
    accounts = [account(test, fraction) for fraction in (0.05, 0.10, 0.25, 0.50)] if len(test) else []
    pd.DataFrame(accounts).to_csv(args.output / "TEST_ACCOUNT_SCENARIOS.csv", index=False)
    summary = {
        "generated_at": datetime.now(UTC).isoformat(),
        "configs": len(CONFIGS),
        "eligible_configs": int(len(eligible)),
        "chosen": asdict(chosen),
        "development": metrics(stores[chosen.name]),
        "test": metrics(test),
        "accounts": accounts,
    }
    (args.output / "SUMMARY.json").write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    (args.output / "REPORT_RU.md").write_text("# Round 43 — bookTicker execution research\n\n```json\n" + json.dumps(summary, indent=2, default=str) + "\n```\n", encoding="utf-8")
    print(json.dumps(summary, indent=2, default=str))

if __name__ == "__main__":
    main()
