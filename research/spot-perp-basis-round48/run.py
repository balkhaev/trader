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

SYMBOLS = [
    "SOLUSDT", "XRPUSDT", "DOGEUSDT", "BNBUSDT", "ADAUSDT",
    "LINKUSDT", "AVAXUSDT", "LTCUSDT", "BCHUSDT", "DOTUSDT",
    "AAVEUSDT", "UNIUSDT", "TRXUSDT", "ETCUSDT", "SUIUSDT",
]
INTERVAL = "15m"
WARMUP_START = pd.Timestamp("2023-12-01", tz="UTC")
START = pd.Timestamp("2024-01-01", tz="UTC")
CUT1 = pd.Timestamp("2025-01-01", tz="UTC")
CUT2 = pd.Timestamp("2025-07-01", tz="UTC")
CUT3 = pd.Timestamp("2026-01-01", tz="UTC")
END = pd.Timestamp("2026-07-01", tz="UTC")
PAIR_COST_BPS = 40.0
SPOT_BASE = "https://data.binance.vision/data/spot/monthly/klines"
FUT_BASE = "https://data.binance.vision/data/futures/um/monthly/klines"
FUND_BASE = "https://data.binance.vision/data/futures/um/monthly/fundingRate"
COLS = [
    "open_time", "open", "high", "low", "close", "volume", "close_time",
    "quote_volume", "trades", "taker_buy_base", "taker_buy_quote", "ignore",
]


@dataclass(frozen=True)
class Config:
    name: str
    window: int
    entry_z: float
    min_basis_bps: float
    hold_bars: int
    exit_z: float = 0.5


CONFIGS = [
    Config(
        f"BASIS_W{window}_Z{str(z).replace('.', 'p')}_B{basis}_H{hold}",
        window, z, basis, hold,
    )
    for window in (672, 1344)
    for z in (1.5, 2.0, 2.5)
    for basis in (5.0, 10.0, 20.0)
    for hold in (4, 8, 16)
]


def get(url: str, timeout: int = 120) -> requests.Response:
    last: Exception | None = None
    for attempt in range(5):
        try:
            response = requests.get(url, timeout=timeout, headers={"User-Agent": "basis-round48/1"})
            if response.status_code == 404:
                return response
            response.raise_for_status()
            return response
        except Exception as exc:
            last = exc
            time.sleep(1 + attempt)
    raise RuntimeError(f"{url}: {last}")


def sha256(path: Path) -> str:
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
        if path.exists() and sha256(path) == expected:
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
            kline_name = f"{symbol}-{INTERVAL}-{month}.zip"
            output.extend([
                (symbol, month, "spot", f"{SPOT_BASE}/{symbol}/{INTERVAL}/{kline_name}", cache / "spot" / symbol / kline_name),
                (symbol, month, "futures", f"{FUT_BASE}/{symbol}/{INTERVAL}/{kline_name}", cache / "futures" / symbol / kline_name),
            ])
            funding_name = f"{symbol}-fundingRate-{month}.zip"
            output.append((symbol, month, "funding", f"{FUND_BASE}/{symbol}/{funding_name}", cache / "funding" / symbol / funding_name))
    return output


def download_all(cache: Path, workers: int) -> list[dict[str, object]]:
    work = tasks(cache)
    results = []
    with cf.ThreadPoolExecutor(max_workers=workers) as executor:
        for index, item in enumerate(executor.map(fetch_verified, work), 1):
            results.append(item)
            if index % 250 == 0:
                print(f"archives {index}/{len(work)}", flush=True)
    return results


def verified_paths(symbol: str, manifest: list[dict[str, object]], kind: str) -> list[Path]:
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
        return pd.to_datetime(numeric, utc=True, errors="coerce")
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
    return frame.dropna(subset=["open_time", "open", "high", "low", "close"])


def read_funding(path: Path) -> pd.DataFrame:
    raw = first_member(path)
    if not raw:
        return pd.DataFrame(columns=["funding_time", "funding_rate"])
    table = pd.read_csv(io.BytesIO(raw), low_memory=False)
    if "calc_time" in table.columns:
        timestamp = table.calc_time
        rate = table.last_funding_rate if "last_funding_rate" in table else table.iloc[:, -1]
    else:
        table = pd.read_csv(io.BytesIO(raw), header=None, low_memory=False)
        timestamp, rate = table.iloc[:, 0], table.iloc[:, -1]
    return pd.DataFrame({"funding_time": parse_time(timestamp), "funding_rate": pd.to_numeric(rate, errors="coerce")}).dropna()


def load_kind(symbol: str, manifest: list[dict[str, object]], kind: str) -> pd.DataFrame:
    parts = [read_kline(path) for path in verified_paths(symbol, manifest, kind)]
    if not parts:
        return pd.DataFrame(columns=COLS)
    frame = pd.concat(parts, ignore_index=True)
    return frame[(frame.open_time >= WARMUP_START) & (frame.open_time < END)].sort_values("open_time").drop_duplicates("open_time").reset_index(drop=True)


def load_funding(symbol: str, manifest: list[dict[str, object]]) -> pd.DatetimeIndex:
    parts = [read_funding(path) for path in verified_paths(symbol, manifest, "funding")]
    if not parts:
        return pd.DatetimeIndex([], tz="UTC")
    frame = pd.concat(parts, ignore_index=True)
    frame = frame[(frame.funding_time >= WARMUP_START) & (frame.funding_time < END)]
    return pd.DatetimeIndex(frame.funding_time.drop_duplicates().sort_values())


def build_pair(spot: pd.DataFrame, futures: pd.DataFrame) -> pd.DataFrame:
    s = spot[["open_time", "open", "close"]].rename(columns={"open": "spot_open", "close": "spot_close"})
    f = futures[["open_time", "open", "close"]].rename(columns={"open": "fut_open", "close": "fut_close"})
    pair = s.merge(f, on="open_time", how="inner").sort_values("open_time").reset_index(drop=True)
    pair["basis_bps"] = (pair.fut_close / pair.spot_close - 1) * 1e4
    for window in (672, 1344):
        mean = pair.basis_bps.rolling(window, min_periods=window // 3).mean()
        std = pair.basis_bps.rolling(window, min_periods=window // 3).std().replace(0, np.nan)
        pair[f"z{window}"] = (pair.basis_bps - mean) / std
    return pair


def crosses_funding(events_ns: np.ndarray, entry_ns: int, exit_ns: int) -> bool:
    if not len(events_ns):
        return False
    index = np.searchsorted(events_ns, entry_ns, side="left")
    return index < len(events_ns) and events_ns[index] <= exit_ns


def simulate_symbol(symbol: str, pair: pd.DataFrame, funding: pd.DatetimeIndex,
                    cfg: Config, start: pd.Timestamp, end: pd.Timestamp) -> list[dict[str, object]]:
    z = pair[f"z{cfg.window}"].to_numpy(float)
    basis = pair.basis_bps.to_numpy(float)
    times = list(pair.open_time)
    time_ns = pair.open_time.astype("int64").to_numpy()
    spot_open = pair.spot_open.to_numpy(float)
    fut_open = pair.fut_open.to_numpy(float)
    mask = (z >= cfg.entry_z) & (basis >= cfg.min_basis_bps)
    first = np.searchsorted(time_ns, start.value)
    final = np.searchsorted(time_ns, end.value)
    candidates = np.flatnonzero(mask & (np.arange(len(pair)) >= first) & (np.arange(len(pair)) < final))
    funding_ns = funding.astype("int64").to_numpy()
    rows = []
    last_exit = -1
    for signal_index in candidates:
        entry_index = signal_index + 1
        if entry_index <= last_exit or entry_index >= final:
            continue
        scheduled_exit = entry_index + cfg.hold_bars
        if scheduled_exit >= final:
            continue
        exit_index = scheduled_exit
        reason = "time"
        for j in range(entry_index, scheduled_exit):
            if np.isfinite(z[j]) and z[j] <= cfg.exit_z and j + 1 <= scheduled_exit:
                exit_index = j + 1
                reason = "basis_revert"
                break
        if exit_index >= final:
            continue
        entry_time, exit_time = times[entry_index], times[exit_index]
        if entry_time.date() != exit_time.date():
            continue
        if crosses_funding(funding_ns, int(time_ns[entry_index]), int(time_ns[exit_index])):
            continue
        s0, s1 = spot_open[entry_index], spot_open[exit_index]
        f0, f1 = fut_open[entry_index], fut_open[exit_index]
        if min(s0, s1, f0, f1) <= 0:
            continue
        spot_bps = (s1 / s0 - 1) * 1e4
        short_fut_bps = -(f1 / f0 - 1) * 1e4
        gross_bps = spot_bps + short_fut_bps
        rows.append({
            "config": cfg.name, "symbol": symbol,
            "signal_time": times[signal_index], "entry_time": entry_time,
            "exit_time": exit_time, "entry_basis_bps": basis[signal_index],
            "entry_z": z[signal_index], "spot_bps": spot_bps,
            "short_fut_bps": short_fut_bps, "gross_spread_bps": gross_bps,
            "net40_bps": gross_bps - PAIR_COST_BPS, "reason": reason,
        })
        last_exit = exit_index
    return rows


def metrics(trades: pd.DataFrame) -> dict[str, float | int]:
    if trades.empty:
        return {"trades": 0, "avg_bps": np.nan, "pf": np.nan, "win_rate": np.nan, "symbols": 0, "breadth": np.nan}
    values = trades.net40_bps.to_numpy(float)
    losses = -values[values < 0].sum()
    by_symbol = trades.groupby("symbol").net40_bps.mean()
    return {
        "trades": int(len(values)), "avg_bps": float(values.mean()),
        "pf": float(values[values > 0].sum() / losses) if losses else float("inf"),
        "win_rate": float(np.mean(values > 0)), "symbols": int(len(by_symbol)),
        "breadth": float((by_symbol > 0).mean()) if len(by_symbol) else np.nan,
    }


def account(trades: pd.DataFrame, fraction_per_pair: float,
            start: pd.Timestamp, end: pd.Timestamp,
            capital: float = 10_000.0, max_positions: int = 5,
            gross_cap: float = 3.0) -> dict[str, float | int]:
    if trades.empty:
        return {"fraction_per_pair": fraction_per_pair, "return_pct": 0.0, "cagr_pct": 0.0, "closed_dd_pct": 0.0, "trades": 0}
    data = trades.sort_values(["entry_time", "entry_z"], ascending=[True, False]).reset_index(drop=True)
    equity = capital
    peak = capital
    max_dd = 0.0
    open_positions: dict[int, float] = {}
    accepted = 0
    for timestamp in sorted(set(data.entry_time) | set(data.exit_time)):
        for idx, notional in list(open_positions.items()):
            row = data.iloc[idx]
            if row.exit_time == timestamp and row.entry_time < timestamp:
                equity += notional * row.net40_bps / 1e4
                peak = max(peak, equity)
                max_dd = max(max_dd, 1 - equity / peak)
                del open_positions[idx]
        for idx in data.index[data.entry_time == timestamp]:
            row = data.iloc[idx]
            if len(open_positions) >= max_positions:
                continue
            if any(data.iloc[j].symbol == row.symbol for j in open_positions):
                continue
            notional = equity * fraction_per_pair
            # Each pair has two equal legs, so gross exposure is 2x pair notional.
            remaining_gross = max(0.0, equity * gross_cap - sum(2 * n for n in open_positions.values()))
            notional = min(notional, remaining_gross / 2)
            if notional <= 0:
                continue
            open_positions[idx] = notional
            accepted += 1
        for idx, notional in list(open_positions.items()):
            row = data.iloc[idx]
            if row.exit_time == timestamp and row.entry_time == timestamp:
                equity += notional * row.net40_bps / 1e4
                peak = max(peak, equity)
                max_dd = max(max_dd, 1 - equity / peak)
                del open_positions[idx]
    years = max((end - start).days / 365.25, 1 / 365.25)
    cagr = -100.0 if equity <= 0 else ((equity / capital) ** (1 / years) - 1) * 100
    return {"fraction_per_pair": fraction_per_pair, "end_usd": equity,
            "return_pct": (equity / capital - 1) * 100, "cagr_pct": cagr,
            "closed_dd_pct": max_dd * 100, "trades": accepted,
            "max_gross_pct": gross_cap * 100}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--workers", type=int, default=24)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    args.cache.mkdir(parents=True, exist_ok=True)

    manifest = download_all(args.cache, args.workers)
    pd.DataFrame(manifest).to_csv(args.output / "SOURCE_MANIFEST.csv", index=False)
    pairs: dict[str, pd.DataFrame] = {}
    funding: dict[str, pd.DatetimeIndex] = {}
    coverage = []
    for symbol in SYMBOLS:
        spot = load_kind(symbol, manifest, "spot")
        futures = load_kind(symbol, manifest, "futures")
        rates = load_funding(symbol, manifest)
        coverage.append({"symbol": symbol, "spot_rows": len(spot), "futures_rows": len(futures), "funding_events": len(rates)})
        if len(spot) and len(futures):
            pairs[symbol] = build_pair(spot, futures)
            funding[symbol] = rates
    pd.DataFrame(coverage).to_csv(args.output / "COVERAGE.csv", index=False)

    periods = {"2024": (START, CUT1), "2025H1": (CUT1, CUT2), "2025H2": (CUT2, CUT3), "2026H1": (CUT3, END)}
    stores: dict[str, dict[str, pd.DataFrame]] = {}
    grid = []
    for cfg in CONFIGS:
        stores[cfg.name] = {}
        for label, (start, end) in periods.items():
            rows = []
            for symbol, pair in pairs.items():
                rows.extend(simulate_symbol(symbol, pair, funding[symbol], cfg, start, end))
            trades = pd.DataFrame(rows)
            if len(trades):
                for column in ("signal_time", "entry_time", "exit_time"):
                    trades[column] = pd.to_datetime(trades[column], utc=True)
            stores[cfg.name][label] = trades
            grid.append({"config": cfg.name, "period": label, **asdict(cfg), **metrics(trades)})
    grid_frame = pd.DataFrame(grid)
    grid_frame.to_csv(args.output / "CONFIG_RESULTS_ALL_PERIODS.csv", index=False)

    selection = []
    for cfg in CONFIGS:
        a, b = metrics(stores[cfg.name]["2024"]), metrics(stores[cfg.name]["2025H1"])
        eligible = (a["trades"] >= 100 and b["trades"] >= 50
                    and a["avg_bps"] > 0 and b["avg_bps"] > 0
                    and a["pf"] >= 1.15 and b["pf"] >= 1.15
                    and min(a["breadth"], b["breadth"]) >= 0.50)
        score = min(a["avg_bps"], b["avg_bps"]) * math.sqrt(min(a["trades"], b["trades"]) / 50) * min(a["pf"], b["pf"], 3) if eligible else -1e9
        selection.append({"config": cfg.name, "eligible": eligible, "score": score,
                          **{f"2024_{k}": v for k, v in a.items()}, **{f"2025H1_{k}": v for k, v in b.items()}})
    selection_frame = pd.DataFrame(selection).sort_values("score", ascending=False)
    selection_frame.to_csv(args.output / "SELECTION_BEFORE_LATE_PERIODS.csv", index=False)
    chosen_name = str(selection_frame.iloc[0].config)
    chosen = next(cfg for cfg in CONFIGS if cfg.name == chosen_name)

    factual, accounts = [], []
    late_parts = []
    for label in ("2025H2", "2026H1"):
        trades = stores[chosen.name][label]
        trades.to_csv(args.output / f"CHOSEN_TRADES_{label}.csv", index=False)
        factual.append({"period": label, **metrics(trades)})
        late_parts.append(trades)
        start, end = periods[label]
        for fraction in (0.05, 0.10, 0.20, 0.33, 0.50, 0.75):
            accounts.append({"period": label, **account(trades, fraction, start, end)})
    late = pd.concat(late_parts, ignore_index=True) if any(len(x) for x in late_parts) else pd.DataFrame()
    factual.append({"period": "LATE_12M", **metrics(late)})
    for fraction in (0.05, 0.10, 0.20, 0.33, 0.50, 0.75):
        accounts.append({"period": "LATE_12M", **account(late, fraction, CUT2, END)})
    pd.DataFrame(factual).to_csv(args.output / "FACTUAL_LATE_RESULTS.csv", index=False)
    pd.DataFrame(accounts).to_csv(args.output / "ACCOUNT_SCENARIOS.csv", index=False)

    summary = {"generated_at": datetime.now(UTC).isoformat(), "configs": len(CONFIGS),
               "eligible_configs": int(selection_frame.eligible.sum()), "chosen": asdict(chosen),
               "factual": factual, "accounts": accounts,
               "selection": selection_frame.to_dict(orient="records")}
    (args.output / "SUMMARY.json").write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    (args.output / "REPORT_RU.md").write_text(
        "# Round 48 — spot/perpetual basis convergence\n\n"
        "Long spot / short perpetual при экстремальной положительной basis. "
        "Конфигурация выбирается по 2024 и 2025H1; проверяется на 2025H2 и 2026H1. "
        "Полная стоимость пары — 40 bps. Позиции, пересекающие funding, исключены.\n\n"
        + pd.DataFrame(factual).to_markdown(index=False, floatfmt=".3f")
        + "\n\n" + pd.DataFrame(accounts).to_markdown(index=False, floatfmt=".3f") + "\n",
        encoding="utf-8")
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
