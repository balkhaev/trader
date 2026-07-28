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
    "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT",
    "AVAXUSDT", "LINKUSDT", "DOTUSDT", "LTCUSDT", "BCHUSDT",
    "TRXUSDT", "ETCUSDT", "NEARUSDT", "ATOMUSDT", "APTUSDT",
    "ARBUSDT", "OPUSDT", "SUIUSDT", "INJUSDT", "TIAUSDT",
    "SEIUSDT", "AAVEUSDT", "UNIUSDT", "FILUSDT", "WLDUSDT",
    "1000PEPEUSDT", "1000BONKUSDT", "1000SHIBUSDT", "STXUSDT", "ICPUSDT",
]
INTERVAL = "15m"
WARMUP_START = pd.Timestamp("2023-12-01", tz="UTC")
START = pd.Timestamp("2024-01-01", tz="UTC")
CUT1 = pd.Timestamp("2025-01-01", tz="UTC")
CUT2 = pd.Timestamp("2025-07-01", tz="UTC")
CUT3 = pd.Timestamp("2026-01-01", tz="UTC")
END = pd.Timestamp("2026-07-01", tz="UTC")
COST_BPS = 20.0
KLINE_BASE = "https://data.binance.vision/data/futures/um/monthly/klines"
FUNDING_BASE = "https://data.binance.vision/data/futures/um/monthly/fundingRate"
COLS = [
    "open_time", "open", "high", "low", "close", "volume", "close_time",
    "quote_volume", "trades", "taker_buy_base", "taker_buy_quote", "ignore",
]


@dataclass(frozen=True)
class Config:
    name: str
    slot: str
    mode: str
    lookback: int
    z_threshold: float
    k: int
    hold: int
    stop_atr: float = 2.0


CONFIGS: list[Config] = []
for slot in ("09:30", "09:45", "10:00"):
    for mode in ("neutral_momentum", "directional_momentum", "neutral_reversal"):
        for lookback in (4, 12):
            for z_threshold in (0.75, 1.25):
                for k in (3, 5):
                    for hold in (4, 8):
                        CONFIGS.append(Config(
                            name=f"{slot.replace(':','')}_{mode}_LB{lookback}_Z{int(z_threshold*100)}_K{k}_H{hold}",
                            slot=slot, mode=mode, lookback=lookback,
                            z_threshold=z_threshold, k=k, hold=hold,
                        ))


def get(url: str, timeout: int = 120) -> requests.Response:
    last: Exception | None = None
    for attempt in range(5):
        try:
            response = requests.get(url, timeout=timeout, headers={"User-Agent": "altcoin-us-open-round52/1"})
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
    return frame.dropna(subset=["open_time", "open", "high", "low", "close"])


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
    events = pd.DatetimeIndex(np.concatenate([index.astype("int64") for index in funding_parts]) if funding_parts else [], tz="UTC")
    return frame, events.drop_duplicates().sort_values()


def atr(frame: pd.DataFrame, periods: int = 14) -> pd.Series:
    previous = frame.close.shift()
    tr = pd.concat([frame.high - frame.low, (frame.high - previous).abs(), (frame.low - previous).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / periods, adjust=False, min_periods=periods).mean()


def build_panel(frames: dict[str, pd.DataFrame]) -> pd.DataFrame:
    pieces = []
    for symbol, raw in frames.items():
        frame = raw.copy()
        for column in ("open", "high", "low", "close", "volume", "quote_volume"):
            frame[column] = pd.to_numeric(frame[column], errors="coerce")
        frame["atr"] = atr(frame)
        frame["atr_pct"] = frame.atr / frame.close
        logret = np.log(frame.close).diff()
        volatility = logret.rolling(96, min_periods=48).std()
        for lookback in (4, 12):
            frame[f"score{lookback}"] = np.log(frame.close).diff(lookback) / (volatility * np.sqrt(lookback) + 1e-12)
        frame["symbol"] = symbol
        pieces.append(frame[["open_time", "open", "high", "low", "close", "atr", "score4", "score12", "symbol"]])
    return pd.concat(pieces, ignore_index=True).dropna().sort_values(["open_time", "symbol"]).reset_index(drop=True)


def event_candidates(panel: pd.DataFrame, cfg: Config) -> pd.DataFrame:
    score_col = f"score{cfg.lookback}"
    local = panel.open_time.dt.tz_convert("America/New_York")
    hour, minute = map(int, cfg.slot.split(":"))
    x = panel[(local.dt.hour == hour) & (local.dt.minute == minute)].copy()
    context = x.groupby("open_time")[score_col].agg(median="median", std="std", count="count").reset_index()
    breadth = x.assign(pos=x[score_col] > 0).groupby("open_time").pos.mean().rename("breadth").reset_index()
    x = x.merge(context, on="open_time").merge(breadth, on="open_time")
    x = x[(x["count"] >= 20) & x["std"].gt(0)].copy()
    x["z"] = (x[score_col] - x["median"]) / x["std"]
    rows = []
    for timestamp, group in x.groupby("open_time", sort=True):
        if cfg.mode == "neutral_momentum":
            longs = group[group.z >= cfg.z_threshold].nlargest(cfg.k, "z").copy()
            shorts = group[group.z <= -cfg.z_threshold].nsmallest(cfg.k, "z").copy()
            if len(longs) < cfg.k or len(shorts) < cfg.k:
                continue
            longs["side"] = 1; shorts["side"] = -1
            chosen = pd.concat([longs, shorts], ignore_index=True)
        elif cfg.mode == "neutral_reversal":
            longs = group[group.z <= -cfg.z_threshold].nsmallest(cfg.k, "z").copy()
            shorts = group[group.z >= cfg.z_threshold].nlargest(cfg.k, "z").copy()
            if len(longs) < cfg.k or len(shorts) < cfg.k:
                continue
            longs["side"] = 1; shorts["side"] = -1
            chosen = pd.concat([longs, shorts], ignore_index=True)
        else:
            median = float(group["median"].iloc[0]); breadth_value = float(group.breadth.iloc[0])
            if median >= 0.25 and breadth_value >= 0.60:
                chosen = group[group.z >= cfg.z_threshold].nlargest(cfg.k, "z").copy(); chosen["side"] = 1
            elif median <= -0.25 and breadth_value <= 0.40:
                chosen = group[group.z <= -cfg.z_threshold].nsmallest(cfg.k, "z").copy(); chosen["side"] = -1
            else:
                continue
            if len(chosen) < cfg.k:
                continue
        chosen["event_time"] = timestamp
        chosen["strength"] = chosen.z.abs() + chosen[score_col].abs() / 2
        rows.append(chosen)
    return pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()


def crosses_funding(events_ns: np.ndarray, entry_ns: int, exit_ns: int) -> bool:
    if not len(events_ns):
        return False
    index = np.searchsorted(events_ns, entry_ns, side="left")
    return index < len(events_ns) and events_ns[index] <= exit_ns


def simulate(events: pd.DataFrame, frames: dict[str, pd.DataFrame], funding: dict[str, pd.DatetimeIndex], cfg: Config,
             start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    if events.empty:
        return pd.DataFrame()
    indexes = {symbol: {time: index for index, time in enumerate(frame.open_time)} for symbol, frame in frames.items()}
    arrays = {symbol: {column: frame[column].to_numpy(float) for column in ("open", "high", "low", "atr")} for symbol, frame in frames.items()}
    times = {symbol: list(frame.open_time) for symbol, frame in frames.items()}
    funding_ns = {symbol: index.astype("int64").to_numpy() for symbol, index in funding.items()}
    last_exit = {symbol: -1 for symbol in frames}
    rows = []
    subset = events[(events.event_time >= start) & (events.event_time < end)].sort_values(["event_time", "strength"], ascending=[True, False])
    for _, row in subset.iterrows():
        symbol = str(row.symbol); signal_index = indexes[symbol].get(row.event_time)
        if signal_index is None or signal_index <= last_exit[symbol]:
            continue
        entry_index = signal_index + 1; scheduled_exit = entry_index + cfg.hold
        if scheduled_exit >= len(times[symbol]):
            continue
        entry_time = times[symbol][entry_index]; scheduled_time = times[symbol][scheduled_exit]
        if not (start <= entry_time < end) or scheduled_time >= end or entry_time.date() != scheduled_time.date():
            continue
        if crosses_funding(funding_ns[symbol], int(pd.Timestamp(entry_time).value), int(pd.Timestamp(scheduled_time).value)):
            continue
        side = int(row.side); entry = arrays[symbol]["open"][entry_index]; signal_atr = arrays[symbol]["atr"][signal_index]
        if not np.isfinite(signal_atr) or signal_atr <= 0:
            continue
        stop = entry - side * cfg.stop_atr * signal_atr
        exit_price = arrays[symbol]["open"][scheduled_exit]; exit_index = scheduled_exit; reason = "time"
        for j in range(entry_index, scheduled_exit):
            opening, high, low = arrays[symbol]["open"][j], arrays[symbol]["high"][j], arrays[symbol]["low"][j]
            if side == 1 and opening <= stop:
                exit_price, exit_index, reason = opening, j, "stop_gap"; break
            if side == -1 and opening >= stop:
                exit_price, exit_index, reason = opening, j, "stop_gap"; break
            if side == 1 and low <= stop:
                exit_price, exit_index, reason = stop, j, "stop"; break
            if side == -1 and high >= stop:
                exit_price, exit_index, reason = stop, j, "stop"; break
        gross = side * (exit_price / entry - 1) * 1e4
        rows.append({
            "config": cfg.name, "mode": cfg.mode, "event_time": row.event_time,
            "symbol": symbol, "side": side, "entry_time": entry_time,
            "exit_time": times[symbol][exit_index], "gross_bps": gross,
            "net20_bps": gross - COST_BPS,
            "stop_distance_bps": abs(stop / entry - 1) * 1e4 + COST_BPS,
            "z": float(row.z), "strength": float(row.strength), "reason": reason,
        })
        last_exit[symbol] = exit_index
    return pd.DataFrame(rows)


def event_returns(trades: pd.DataFrame) -> pd.DataFrame:
    if trades.empty:
        return pd.DataFrame(columns=["event_time", "event_bps", "legs"])
    return trades.groupby("event_time").agg(event_bps=("net20_bps", "mean"), legs=("net20_bps", "size")).reset_index()


def metrics(trades: pd.DataFrame) -> dict[str, float | int]:
    events = event_returns(trades)
    if events.empty:
        return {"events": 0, "legs": 0, "event_avg_bps": np.nan, "event_pf": np.nan, "event_win_rate": np.nan}
    values = events.event_bps.to_numpy(float); loss = -values[values < 0].sum()
    return {"events": int(len(values)), "legs": int(events.legs.sum()), "event_avg_bps": float(values.mean()),
            "event_pf": float(values[values > 0].sum() / loss) if loss else float("inf"),
            "event_win_rate": float(np.mean(values > 0))}


def account(events: pd.DataFrame, fraction_per_leg: float, start: pd.Timestamp, end: pd.Timestamp,
            capital: float = 10_000.0, gross_cap: float = 0.60) -> dict[str, float | int]:
    equity, peak, max_dd = capital, capital, 0.0
    for _, row in events.sort_values("event_time").iterrows():
        gross = min(float(row.legs) * fraction_per_leg, gross_cap)
        equity = max(0.0, equity * (1 + gross * float(row.event_bps) / 1e4))
        peak = max(peak, equity); max_dd = max(max_dd, 1 - equity / peak if peak else 1.0)
    years = max((end - start).days / 365.25, 1 / 365.25)
    cagr = -100.0 if equity <= 0 else ((equity / capital) ** (1 / years) - 1) * 100
    return {"fraction_per_leg": fraction_per_leg, "end_usd": equity,
            "return_pct": (equity / capital - 1) * 100, "cagr_pct": cagr,
            "closed_dd_pct": max_dd * 100, "events": int(len(events)),
            "legs": int(events.legs.sum()) if len(events) else 0, "gross_cap_pct": gross_cap * 100}


def main() -> None:
    parser = argparse.ArgumentParser(); parser.add_argument("--output", required=True, type=Path); parser.add_argument("--cache", required=True, type=Path); parser.add_argument("--workers", type=int, default=32)
    args = parser.parse_args(); args.output.mkdir(parents=True, exist_ok=True); args.cache.mkdir(parents=True, exist_ok=True)
    manifest = download_all(args.cache, args.workers); pd.DataFrame(manifest).to_csv(args.output / "SOURCE_MANIFEST.csv", index=False)
    frames, funding, coverage = {}, {}, []
    for symbol in SYMBOLS:
        frame, events = load_symbol(symbol, manifest)
        coverage.append({"symbol": symbol, "rows": len(frame), "funding_events": len(events),
                         "first": None if frame.empty else frame.open_time.iloc[0], "last": None if frame.empty else frame.open_time.iloc[-1]})
        if len(frame):
            frames[symbol] = frame; funding[symbol] = events
    pd.DataFrame(coverage).to_csv(args.output / "COVERAGE.csv", index=False)
    panel = build_panel(frames)
    periods = {"2024": (START, CUT1), "2025H1": (CUT1, CUT2), "2025H2": (CUT2, CUT3), "2026H1": (CUT3, END)}
    stores, grid = {}, []
    for index, cfg in enumerate(CONFIGS, 1):
        candidates = event_candidates(panel, cfg); stores[cfg.name] = {}
        for label, bounds in periods.items():
            trades = simulate(candidates, frames, funding, cfg, *bounds); stores[cfg.name][label] = trades
            grid.append({"config": cfg.name, "period": label, **asdict(cfg), **metrics(trades)})
        if index % 24 == 0:
            print(f"configs {index}/{len(CONFIGS)}", flush=True)
    pd.DataFrame(grid).to_csv(args.output / "CONFIG_RESULTS_ALL_PERIODS.csv", index=False)
    selection = []
    for cfg in CONFIGS:
        a, b = metrics(stores[cfg.name]["2024"]), metrics(stores[cfg.name]["2025H1"])
        eligible = (a["events"] >= 50 and b["events"] >= 30 and a["event_avg_bps"] > 0 and b["event_avg_bps"] > 0 and a["event_pf"] >= 1.10 and b["event_pf"] >= 1.10)
        score = min(a["event_avg_bps"], b["event_avg_bps"]) * math.sqrt(min(a["events"], b["events"]) / 30) * min(a["event_pf"], b["event_pf"], 3) if eligible else -1e9
        selection.append({"config": cfg.name, "eligible": eligible, "score": score,
                          **{f"2024_{k}": v for k, v in a.items()}, **{f"2025H1_{k}": v for k, v in b.items()}})
    selection_frame = pd.DataFrame(selection).sort_values("score", ascending=False); selection_frame.to_csv(args.output / "SELECTION_BEFORE_LATE_PERIODS.csv", index=False)
    chosen_name = str(selection_frame.iloc[0].config); chosen = next(cfg for cfg in CONFIGS if cfg.name == chosen_name)
    factual, accounts, late_parts = [], [], []
    for label in ("2025H2", "2026H1"):
        start, end = periods[label]; trades = stores[chosen.name][label]; events = event_returns(trades)
        trades.to_csv(args.output / f"CHOSEN_TRADES_{label}.csv", index=False); events.to_csv(args.output / f"CHOSEN_EVENTS_{label}.csv", index=False)
        factual.append({"period": label, **metrics(trades)}); late_parts.append(trades)
        for fraction in (0.02, 0.04, 0.06, 0.08):
            accounts.append({"period": label, **account(events, fraction, start, end)})
    late = pd.concat(late_parts, ignore_index=True) if any(len(frame) for frame in late_parts) else pd.DataFrame(); late_events = event_returns(late)
    factual.append({"period": "LATE_12M", **metrics(late)})
    for fraction in (0.02, 0.04, 0.06, 0.08):
        accounts.append({"period": "LATE_12M", **account(late_events, fraction, CUT2, END)})
    pd.DataFrame(factual).to_csv(args.output / "FACTUAL_LATE_RESULTS.csv", index=False); pd.DataFrame(accounts).to_csv(args.output / "ACCOUNT_SCENARIOS.csv", index=False)
    summary = {"generated_at": datetime.now(UTC).isoformat(), "configs": len(CONFIGS), "eligible_configs": int(selection_frame.eligible.sum()), "chosen": asdict(chosen), "factual": factual, "accounts": accounts, "selection": selection_frame.to_dict(orient="records")}
    (args.output / "SUMMARY.json").write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    (args.output / "REPORT_RU.md").write_text("# Round 52 — altcoin US-open cross-sectional\n\n" + pd.DataFrame(factual).to_markdown(index=False, floatfmt=".3f") + "\n\n" + pd.DataFrame(accounts).to_markdown(index=False, floatfmt=".3f") + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
