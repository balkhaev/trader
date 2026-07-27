#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import io
import sys
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve()
BASE_PATH = HERE.parent / "run.py"
spec = importlib.util.spec_from_file_location("bookticker_base", BASE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("cannot load base runner")
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)

base.DEV_START = pd.Timestamp("2026-05-25", tz="UTC")
base.DEV_END = pd.Timestamp("2026-06-01", tz="UTC")
base.TEST_START = pd.Timestamp("2026-06-01", tz="UTC")
base.TEST_END = pd.Timestamp("2026-06-08", tz="UTC")
base.BOOK_BASE = "https://data.binance.vision/data/futures/um/monthly/bookTicker"


def download_all(cache: Path, workers: int):
    tasks = []
    for symbol in base.SYMBOLS:
        for month in ("2026-05", "2026-06"):
            name = f"{symbol}-bookTicker-{month}.zip"
            tasks.append((symbol, month, f"{base.BOOK_BASE}/{symbol}/{name}", cache / symbol / name))
    rows = []
    import concurrent.futures as cf
    with cf.ThreadPoolExecutor(max_workers=workers) as executor:
        for index, item in enumerate(executor.map(base.fetch, tasks), 1):
            rows.append(item)
            print(f"archives {index}/{len(tasks)}", flush=True)
    return rows


def normalize_chunk(frame: pd.DataFrame, header: bool) -> pd.DataFrame:
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
            raise ValueError(f"unexpected bookTicker columns: {frame.shape[1]}")
    if "ts" not in frame and "event_ts" in frame:
        frame["ts"] = frame.event_ts
    required = ["bid", "bid_qty", "ask", "ask_qty", "ts"]
    if not set(required).issubset(frame.columns):
        raise ValueError(f"missing columns: {frame.columns.tolist()}")
    for column in required[:-1]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame["time"] = base.parse_time(frame.ts)
    frame = frame.dropna(subset=["time", "bid", "ask", "bid_qty", "ask_qty"])
    frame = frame[
        (frame.time >= base.DEV_START)
        & (frame.time < base.TEST_END)
        & (frame.bid > 0)
        & (frame.ask >= frame.bid)
    ]
    if frame.empty:
        return pd.DataFrame(columns=["second", "bid", "bid_qty", "ask", "ask_qty"])
    frame["second"] = frame.time.dt.floor("s")
    return (
        frame.sort_values("time")
        .groupby("second", sort=True)
        .last()
        .reset_index()[["second", "bid", "bid_qty", "ask", "ask_qty"]]
    )


def read_archive(path: Path) -> pd.DataFrame:
    pieces = []
    with zipfile.ZipFile(path) as bundle:
        members = [name for name in bundle.namelist() if not name.endswith("/")]
        member = members[0]
        with bundle.open(member) as handle:
            first = handle.readline().decode("utf-8", errors="replace").lower()
        header = any(token in first for token in ("best_bid", "bid_price", "update_id", "transaction_time"))
        with bundle.open(member) as handle:
            reader = pd.read_csv(handle, header=0 if header else None, chunksize=1_000_000, low_memory=False)
            for chunk in reader:
                normalized = normalize_chunk(chunk, header)
                if len(normalized):
                    pieces.append(normalized)
    if not pieces:
        return pd.DataFrame(columns=["second", "bid", "bid_qty", "ask", "ask_qty"])
    return (
        pd.concat(pieces, ignore_index=True)
        .sort_values("second")
        .groupby("second", sort=True)
        .last()
        .reset_index()
    )


def load_symbol(cache: Path, symbol: str) -> pd.DataFrame:
    pieces = []
    for path in sorted((cache / symbol).glob(f"{symbol}-bookTicker-2026-*.zip")):
        try:
            part = read_archive(path)
            if len(part):
                pieces.append(part)
        except Exception as exc:
            print("parse warning", path, exc, flush=True)
    if not pieces:
        return pd.DataFrame()
    data = pd.concat(pieces, ignore_index=True).sort_values("second").drop_duplicates("second")
    data["mid"] = (data.bid + data.ask) / 2
    data["spread_bps"] = (data.ask - data.bid) / data.mid * 1e4
    data["imbalance"] = (data.bid_qty - data.ask_qty) / (data.bid_qty + data.ask_qty).replace(0, np.nan)
    data["microprice"] = (data.ask * data.bid_qty + data.bid * data.ask_qty) / (data.bid_qty + data.ask_qty).replace(0, np.nan)
    data["micro_premium_bps"] = (data.microprice / data.mid - 1) * 1e4
    data["move5_bps"] = data.mid.pct_change(5) * 1e4
    data["contiguous"] = data.second.diff().eq(pd.Timedelta(seconds=1)).rolling(12, min_periods=12).sum().eq(12)
    return data.dropna().reset_index(drop=True)


base.download_all = download_all
base.load_symbol = load_symbol

if __name__ == "__main__":
    base.main()
