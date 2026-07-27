#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

from config import CUT, JULY_END, PRE_JULY_END, START
from data import download_july, download_monthly, load_funding, load_klines

SYMBOLS = [
    "SOLUSDT","BNBUSDT","XRPUSDT","ADAUSDT","DOGEUSDT","AVAXUSDT",
    "LINKUSDT","DOTUSDT","LTCUSDT","BCHUSDT","TRXUSDT","ETCUSDT",
    "NEARUSDT","ATOMUSDT","APTUSDT","ARBUSDT","OPUSDT","SUIUSDT",
    "INJUSDT","TIAUSDT","SEIUSDT","AAVEUSDT","UNIUSDT","FILUSDT",
    "WLDUSDT","1000PEPEUSDT","1000BONKUSDT","1000SHIBUSDT","STXUSDT","ICPUSDT",
]
COST_BPS = 20.0

@dataclass(frozen=True)
class Config:
    name: str
    mode: str
    lookback: int
    z_threshold: float
    k: int
    hold: int
    market_threshold: float

CONFIGS: list[Config] = []
for lookback in (16, 32):
    for z in (1.0, 1.5):
        for k in (3, 5):
            for hold in (8, 16):
                CONFIGS.append(Config(f"NEUT_LB{lookback}_Z{int(z*10)}_K{k}_H{hold}", "neutral", lookback, z, k, hold, 0.0))
                for threshold in (0.25, 0.50):
                    CONFIGS.append(Config(f"DIR_LB{lookback}_Z{int(z*10)}_K{k}_H{hold}_M{int(threshold*100)}", "directional", lookback, z, k, hold, threshold))


def atr(frame: pd.DataFrame, n: int = 14) -> pd.Series:
    previous = frame.close.shift()
    true_range = pd.concat(
        [frame.high - frame.low, (frame.high - previous).abs(), (frame.low - previous).abs()],
        axis=1,
    ).max(axis=1)
    return true_range.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


def prepare(frame: pd.DataFrame) -> pd.DataFrame:
    x = frame.copy().sort_values("open_time")
    for column in ("open", "high", "low", "close", "volume"):
        x[column] = pd.to_numeric(x[column], errors="coerce")
    x["atr"] = atr(x)
    log_return = np.log(x.close).diff()
    realized = log_return.rolling(96, min_periods=48).std()
    for lookback in (16, 32):
        x[f"score{lookback}"] = np.log(x.close).diff(lookback) / (realized * np.sqrt(lookback) + 1e-12)
    return x.dropna(subset=["open_time", "open", "high", "low", "close", "atr"])


def matrices(frames: dict[str, pd.DataFrame]):
    index = pd.DatetimeIndex(sorted(set().union(*[set(frame.open_time) for frame in frames.values()])))
    data = {}
    for field in ("open", "high", "low", "atr", "score16", "score32"):
        columns = {}
        for symbol, frame in frames.items():
            columns[symbol] = pd.Series(frame[field].to_numpy(float), index=pd.DatetimeIndex(frame.open_time))
        data[field] = pd.DataFrame(columns, index=index)
    return data


def build_signal_events(matrix: dict[str, pd.DataFrame], cfg: Config) -> pd.DataFrame:
    score = matrix[f"score{cfg.lookback}"]
    hourly = score.index.minute == 0
    score = score.loc[hourly]
    count = score.notna().sum(axis=1)
    median = score.median(axis=1)
    std = score.std(axis=1).replace(0, np.nan)
    z = score.sub(median, axis=0).div(std, axis=0)
    breadth = (score > 0).sum(axis=1) / count.replace(0, np.nan)
    rows = []
    for timestamp in score.index[count >= 24]:
        row = z.loc[timestamp].dropna()
        if cfg.mode == "neutral":
            longs = row[row >= cfg.z_threshold].nlargest(cfg.k)
            shorts = row[row <= -cfg.z_threshold].nsmallest(cfg.k)
            if len(longs) < cfg.k or len(shorts) < cfg.k:
                continue
            for symbol, value in longs.items():
                rows.append({"event_time": timestamp, "symbol": symbol, "side": 1, "z": float(value), "strength": float(abs(value) + abs(score.at[timestamp, symbol]) / 2)})
            for symbol, value in shorts.items():
                rows.append({"event_time": timestamp, "symbol": symbol, "side": -1, "z": float(value), "strength": float(abs(value) + abs(score.at[timestamp, symbol]) / 2)})
        else:
            market = float(median.at[timestamp])
            br = float(breadth.at[timestamp])
            if market >= cfg.market_threshold and br >= 0.58:
                selected = row[row >= cfg.z_threshold].nlargest(cfg.k)
                side = 1
            elif market <= -cfg.market_threshold and br <= 0.42:
                selected = row[row <= -cfg.z_threshold].nsmallest(cfg.k)
                side = -1
            else:
                continue
            if len(selected) < cfg.k:
                continue
            for symbol, value in selected.items():
                rows.append({"event_time": timestamp, "symbol": symbol, "side": side, "z": float(value), "strength": float(abs(value) + abs(score.at[timestamp, symbol]) / 2)})
    return pd.DataFrame(rows)


def crosses(events_ns: np.ndarray, entry_ns: int, exit_ns: int) -> bool:
    if not len(events_ns):
        return False
    index = np.searchsorted(events_ns, entry_ns, side="left")
    return index < len(events_ns) and events_ns[index] <= exit_ns


def simulate(
    signals: pd.DataFrame,
    frames: dict[str, pd.DataFrame],
    funding: dict[str, pd.DatetimeIndex],
    cfg: Config,
    start: pd.Timestamp,
    end: pd.Timestamp,
) -> pd.DataFrame:
    if signals.empty:
        return pd.DataFrame()
    lookup = {symbol: {time: index for index, time in enumerate(frame.open_time)} for symbol, frame in frames.items()}
    arrays = {
        symbol: {field: frame[field].to_numpy(float) for field in ("open", "high", "low", "atr")}
        for symbol, frame in frames.items()
    }
    times = {symbol: list(frame.open_time) for symbol, frame in frames.items()}
    funding_ns = {symbol: index.astype("int64").to_numpy() for symbol, index in funding.items()}
    last_exit = {symbol: -1 for symbol in frames}
    rows = []
    subset = signals[(signals.event_time >= start) & (signals.event_time < end)].sort_values(["event_time", "strength"], ascending=[True, False])
    for _, signal in subset.iterrows():
        symbol = str(signal.symbol)
        signal_index = lookup[symbol].get(signal.event_time)
        if signal_index is None or signal_index <= last_exit[symbol]:
            continue
        entry_index = signal_index + 1
        scheduled = entry_index + cfg.hold
        if scheduled >= len(times[symbol]):
            continue
        entry_time = times[symbol][entry_index]
        scheduled_time = times[symbol][scheduled]
        if not (start <= entry_time < end) or scheduled_time >= end or entry_time.date() != scheduled_time.date():
            continue
        if crosses(funding_ns[symbol], int(pd.Timestamp(entry_time).value), int(pd.Timestamp(scheduled_time).value)):
            continue
        side = int(signal.side)
        array = arrays[symbol]
        entry = array["open"][entry_index]
        atr_value = array["atr"][signal_index]
        if not np.isfinite(atr_value):
            continue
        stop = entry - side * 2.0 * atr_value
        exit_price = array["open"][scheduled]
        exit_index = scheduled
        reason = "time"
        mae = 0.0
        mfe = 0.0
        for bar_index in range(entry_index, scheduled):
            excursions = [
                side * (array["high"][bar_index] / entry - 1) * 1e4,
                side * (array["low"][bar_index] / entry - 1) * 1e4,
            ]
            mae = min(mae, *excursions)
            mfe = max(mfe, *excursions)
            if side == 1 and array["open"][bar_index] <= stop:
                exit_price, exit_index, reason = array["open"][bar_index], bar_index, "stop_gap"
                break
            if side == -1 and array["open"][bar_index] >= stop:
                exit_price, exit_index, reason = array["open"][bar_index], bar_index, "stop_gap"
                break
            if side == 1 and array["low"][bar_index] <= stop:
                exit_price, exit_index, reason = stop, bar_index, "stop"
                break
            if side == -1 and array["high"][bar_index] >= stop:
                exit_price, exit_index, reason = stop, bar_index, "stop"
                break
        gross = side * (exit_price / entry - 1) * 1e4
        rows.append({
            "config": cfg.name,
            "mode": cfg.mode,
            "event_time": signal.event_time,
            "symbol": symbol,
            "side": side,
            "entry_time": entry_time,
            "exit_time": times[symbol][exit_index],
            "gross_bps": gross,
            "net20_bps": gross - COST_BPS,
            "stop_distance_bps": abs(stop / entry - 1) * 1e4 + COST_BPS,
            "z": float(signal.z),
            "strength": float(signal.strength),
            "reason": reason,
            "mae_bps": mae,
            "mfe_bps": mfe,
        })
        last_exit[symbol] = exit_index
    return pd.DataFrame(rows)


def event_returns(frame: pd.DataFrame) -> pd.DataFrame:
    if frame.empty:
        return pd.DataFrame(columns=["event_time", "event_bps", "legs"])
    return frame.groupby("event_time").agg(event_bps=("net20_bps", "mean"), legs=("net20_bps", "size")).reset_index()


def metrics(frame: pd.DataFrame) -> dict[str, float | int]:
    events = event_returns(frame)
    if events.empty:
        return {"events": 0, "legs": 0, "event_avg_bps": np.nan, "event_pf": np.nan, "event_win_rate": np.nan}
    values = events.event_bps.to_numpy(float)
    losses = -values[values < 0].sum()
    return {
        "events": int(len(events)),
        "legs": int(events.legs.sum()),
        "event_avg_bps": float(values.mean()),
        "event_pf": float(values[values > 0].sum() / losses) if losses else float("inf"),
        "event_win_rate": float(np.mean(values > 0)),
    }


def account(frame: pd.DataFrame, fraction_per_leg: float, capital: float = 10_000.0) -> dict[str, float | int]:
    events = event_returns(frame)
    equity = capital
    peak = capital
    max_drawdown = 0.0
    for _, event in events.sort_values("event_time").iterrows():
        gross_fraction = min(float(event.legs) * fraction_per_leg, 0.60)
        equity += equity * gross_fraction * float(event.event_bps) / 1e4
        peak = max(peak, equity)
        max_drawdown = max(max_drawdown, 1 - equity / peak)
    days = (JULY_END - PRE_JULY_END).days
    return {
        "fraction_per_leg": fraction_per_leg,
        "end_usd": equity,
        "return_pct": (equity / capital - 1) * 100,
        "mechanical_annualized_pct": ((equity / capital) ** (365 / days) - 1) * 100 if equity > 0 else -100.0,
        "closed_dd_pct": max_drawdown * 100,
        "events": len(events),
        "legs": int(events.legs.sum()) if len(events) else 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--workers", type=int, default=24)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    manifest = download_monthly(SYMBOLS, args.cache, args.workers) + download_july(SYMBOLS, args.cache, args.workers)
    pd.DataFrame(manifest).to_csv(args.output / "SOURCE_MANIFEST.csv", index=False)
    frames = {}
    funding = {}
    coverage = []
    for symbol in SYMBOLS:
        raw = load_klines(symbol, manifest, include_july=True)
        events = load_funding(symbol, manifest, include_july=True)
        coverage.append({"symbol": symbol, "rows": len(raw), "first": None if raw.empty else raw.open_time.iloc[0], "last": None if raw.empty else raw.open_time.iloc[-1], "funding_events": len(events)})
        if len(raw):
            frames[symbol] = prepare(raw)
            funding[symbol] = events
    pd.DataFrame(coverage).to_csv(args.output / "COVERAGE.csv", index=False)
    matrix = matrices(frames)
    stores = {}
    grid = []
    for index, cfg in enumerate(CONFIGS, 1):
        signals = build_signal_events(matrix, cfg)
        stores[cfg.name] = {}
        for label, bounds in {"2025H2": (START, CUT), "2026H1": (CUT, PRE_JULY_END)}.items():
            trades = simulate(signals, frames, funding, cfg, *bounds)
            stores[cfg.name][label] = trades
            grid.append({"config": cfg.name, "period": label, **asdict(cfg), **metrics(trades)})
        print(f"configs {index}/{len(CONFIGS)}", flush=True)
    pd.DataFrame(grid).to_csv(args.output / "CONFIG_RESULTS_PRE_JULY.csv", index=False)
    selection = []
    for cfg in CONFIGS:
        first = metrics(stores[cfg.name]["2025H2"])
        second = metrics(stores[cfg.name]["2026H1"])
        eligible = (
            first["events"] >= 50 and second["events"] >= 50
            and first["event_avg_bps"] > 0 and second["event_avg_bps"] > 0
            and first["event_pf"] >= 1.10 and second["event_pf"] >= 1.10
        )
        score = (
            min(first["event_avg_bps"], second["event_avg_bps"])
            * math.sqrt(min(first["events"], second["events"]) / 50)
            * min(first["event_pf"], second["event_pf"], 3)
            if eligible else -1e9
        )
        selection.append({"config": cfg.name, "eligible": eligible, "score": score, **{f"2025H2_{key}": value for key, value in first.items()}, **{f"2026H1_{key}": value for key, value in second.items()}})
    selection_frame = pd.DataFrame(selection).sort_values("score", ascending=False)
    selection_frame.to_csv(args.output / "SELECTION_BEFORE_JULY.csv", index=False)
    chosen_name = str(selection_frame.iloc[0].config)
    chosen = next(cfg for cfg in CONFIGS if cfg.name == chosen_name)
    july_signals = build_signal_events(matrix, chosen)
    july = simulate(july_signals, frames, funding, chosen, PRE_JULY_END, JULY_END)
    july.to_csv(args.output / "JULY_TRADES.csv", index=False)
    event_returns(july).to_csv(args.output / "JULY_EVENTS.csv", index=False)
    accounts = [account(july, fraction) for fraction in (0.02, 0.04, 0.06, 0.08)]
    pd.DataFrame(accounts).to_csv(args.output / "JULY_ACCOUNT_SCENARIOS.csv", index=False)
    summary = {
        "generated_at": datetime.now(UTC).isoformat(),
        "configs": len(CONFIGS),
        "eligible_configs": int(selection_frame.eligible.sum()),
        "chosen": asdict(chosen),
        "july": metrics(july),
        "accounts": accounts,
        "selection": selection_frame.to_dict(orient="records"),
    }
    (args.output / "SUMMARY.json").write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    (args.output / "REPORT_RU.md").write_text("# Round 40 — vectorized medium cross-sectional\n\n```json\n" + json.dumps(summary, indent=2, default=str) + "\n```\n", encoding="utf-8")
    print(json.dumps(summary, indent=2, default=str))

if __name__ == "__main__":
    main()
