#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve()
PREMIUM_DIR = HERE.parents[1] / "altcoin-round27-premium"
sys.path.insert(0, str(PREMIUM_DIR))

import config as source_config  # noqa: E402
import data as source_data  # noqa: E402

SYMBOLS = list(source_config.SYMBOLS)
WARMUP_START = pd.Timestamp("2023-12-01", tz="UTC")
START = pd.Timestamp("2024-01-01", tz="UTC")
CUT1 = pd.Timestamp("2025-01-01", tz="UTC")
CUT2 = pd.Timestamp("2025-07-01", tz="UTC")
CUT3 = pd.Timestamp("2026-01-01", tz="UTC")
END = pd.Timestamp("2026-07-01", tz="UTC")
COST_BPS = 20.0

source_data.WARMUP_START = WARMUP_START
source_data.PRE_JULY_END = END
source_data.JULY_END = END


@dataclass(frozen=True)
class Config:
    name: str
    side: int
    funding_threshold_bps: float
    premium_z: float
    mode: str
    move_threshold: float
    hold_bars: int
    persistence: bool
    stop_atr: float = 2.0
    k: int = 3


CONFIGS: list[Config] = []
for side, side_name in ((-1, "SHORT_POS"), (1, "LONG_NEG")):
    for funding_threshold in (0.25, 0.50, 1.0):
        for premium_z in (0.5, 1.5):
            for mode in ("extension", "unwind"):
                for hold in (8, 16, 32):
                    for persistence in (False, True):
                        CONFIGS.append(Config(
                            name=(
                                f"{side_name}_F{str(funding_threshold).replace('.', 'p')}"
                                f"_P{str(premium_z).replace('.', 'p')}_{mode.upper()}"
                                f"_H{hold}_{'PERSIST' if persistence else 'RAW'}"
                            ),
                            side=side,
                            funding_threshold_bps=funding_threshold,
                            premium_z=premium_z,
                            mode=mode,
                            move_threshold=0.5,
                            hold_bars=hold,
                            persistence=persistence,
                        ))


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


def load_monthly_funding(symbol: str, manifest: list[dict[str, object]]) -> pd.DataFrame:
    parts = [
        source_data.read_funding_zip(path)
        for path in source_data.verified_paths(symbol, manifest, {"funding_monthly"})
    ]
    if not parts:
        return pd.DataFrame(columns=["funding_time", "funding_rate"])
    frame = pd.concat(parts, ignore_index=True)
    return (
        frame[(frame.funding_time >= WARMUP_START) & (frame.funding_time < END)]
        .sort_values("funding_time")
        .drop_duplicates("funding_time")
        .reset_index(drop=True)
    )


def build_symbol_events(price: pd.DataFrame, premium: pd.DataFrame,
                        funding: pd.DataFrame, symbol: str) -> pd.DataFrame:
    p = price.copy().sort_values("open_time").reset_index(drop=True)
    q = premium.copy().sort_values("open_time").reset_index(drop=True)
    for frame in (p, q):
        for column in ("open", "high", "low", "close", "volume", "quote_volume"):
            frame[column] = pd.to_numeric(frame[column], errors="coerce")
    p["atr"] = atr(p)
    p["atr_pct"] = p.atr / p.close
    p["move8h_atr"] = p.close.pct_change(32) / p.atr_pct.replace(0, np.nan)
    p["volume_z"] = zscore(np.log1p(p.quote_volume.clip(lower=0)), 672, 192)
    q["premium_z"] = zscore(q.close, 672, 192)
    feature = p[["open_time", "open", "high", "low", "close", "atr", "move8h_atr", "volume_z"]].merge(
        q[["open_time", "premium_z"]], on="open_time", how="inner"
    )
    feature["known_time"] = feature.open_time + pd.Timedelta(minutes=15)
    rates = funding.copy().sort_values("funding_time")
    rates["funding_bps"] = rates.funding_rate * 1e4
    rates["previous_bps"] = rates.funding_bps.shift(1)
    events = rates.merge(
        feature,
        left_on="funding_time",
        right_on="known_time",
        how="left",
    )
    events["symbol"] = symbol
    return events.dropna(subset=["funding_bps", "premium_z", "move8h_atr", "atr"])


def signal(events: pd.DataFrame, cfg: Config) -> pd.DataFrame:
    x = events.copy()
    if cfg.persistence:
        x = x[np.sign(x.funding_bps) == np.sign(x.previous_bps)]
    if cfg.side == -1:
        mask = (x.funding_bps >= cfg.funding_threshold_bps) & (x.premium_z >= cfg.premium_z)
        if cfg.mode == "extension":
            mask &= x.move8h_atr >= cfg.move_threshold
        else:
            mask &= x.move8h_atr <= -cfg.move_threshold
    else:
        mask = (x.funding_bps <= -cfg.funding_threshold_bps) & (x.premium_z <= -cfg.premium_z)
        if cfg.mode == "extension":
            mask &= x.move8h_atr <= -cfg.move_threshold
        else:
            mask &= x.move8h_atr >= cfg.move_threshold
    x = x[mask].copy()
    x["strength"] = x.funding_bps.abs() + x.premium_z.abs() + x.move8h_atr.abs() / 2
    return x


def actual_funding(funding: pd.DataFrame, entry: pd.Timestamp,
                   exit_: pd.Timestamp, side: int) -> float:
    crossed = funding[(funding.funding_time > entry) & (funding.funding_time <= exit_)]
    return float((-side * crossed.funding_rate * 1e4).sum())


def simulate(all_events: pd.DataFrame, prices: dict[str, pd.DataFrame],
             funding: dict[str, pd.DataFrame], cfg: Config,
             start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    candidates = signal(all_events, cfg)
    candidates = candidates[(candidates.funding_time >= start) & (candidates.funding_time < end)]
    selected = []
    for event_time, group in candidates.groupby("funding_time", sort=True):
        selected.append(group.nlargest(cfg.k, "strength"))
    if not selected:
        return pd.DataFrame()
    selected_frame = pd.concat(selected, ignore_index=True).sort_values(["funding_time", "strength"], ascending=[True, False])
    index = {s: {t: i for i, t in enumerate(frame.open_time)} for s, frame in prices.items()}
    arrays = {
        s: {c: frame[c].to_numpy(float) for c in ("open", "high", "low", "atr")}
        for s, frame in prices.items()
    }
    times = {s: list(frame.open_time) for s, frame in prices.items()}
    last_exit = {s: -1 for s in prices}
    rows: list[dict[str, object]] = []
    for _, row in selected_frame.iterrows():
        symbol = str(row.symbol)
        event_time = pd.Timestamp(row.funding_time)
        entry_time = event_time + pd.Timedelta(minutes=15)
        signal_index = index.get(symbol, {}).get(event_time - pd.Timedelta(minutes=15))
        entry_index = index.get(symbol, {}).get(entry_time)
        if signal_index is None or entry_index is None or entry_index <= last_exit[symbol]:
            continue
        scheduled_exit = entry_index + cfg.hold_bars
        if scheduled_exit >= len(times[symbol]):
            continue
        scheduled_time = times[symbol][scheduled_exit]
        if not (start <= entry_time < end) or scheduled_time >= end:
            continue
        if entry_time.date() != scheduled_time.date():
            continue
        entry = arrays[symbol]["open"][entry_index]
        signal_atr = arrays[symbol]["atr"][signal_index]
        if not np.isfinite(entry) or not np.isfinite(signal_atr) or signal_atr <= 0:
            continue
        stop = entry - cfg.side * cfg.stop_atr * signal_atr
        exit_price = arrays[symbol]["open"][scheduled_exit]
        exit_index = scheduled_exit
        reason = "time"
        for j in range(entry_index, scheduled_exit):
            opening = arrays[symbol]["open"][j]
            high = arrays[symbol]["high"][j]
            low = arrays[symbol]["low"][j]
            if cfg.side == 1 and opening <= stop:
                exit_price, exit_index, reason = opening, j, "stop_gap"
                break
            if cfg.side == -1 and opening >= stop:
                exit_price, exit_index, reason = opening, j, "stop_gap"
                break
            if cfg.side == 1 and low <= stop:
                exit_price, exit_index, reason = stop, j, "stop"
                break
            if cfg.side == -1 and high >= stop:
                exit_price, exit_index, reason = stop, j, "stop"
                break
        exit_time = times[symbol][exit_index]
        price_bps = cfg.side * (exit_price / entry - 1) * 1e4
        funding_bps = actual_funding(funding[symbol], entry_time, exit_time, cfg.side)
        net = price_bps + funding_bps - COST_BPS
        rows.append({
            "config": cfg.name,
            "event_time": event_time,
            "symbol": symbol,
            "side": cfg.side,
            "entry_time": entry_time,
            "exit_time": exit_time,
            "signal_funding_bps": float(row.funding_bps),
            "premium_z": float(row.premium_z),
            "move8h_atr": float(row.move8h_atr),
            "strength": float(row.strength),
            "price_bps": price_bps,
            "realized_funding_bps": funding_bps,
            "net20_bps": net,
            "stop_distance_bps": abs(stop / entry - 1) * 1e4 + COST_BPS,
            "reason": reason,
        })
        last_exit[symbol] = exit_index
    return pd.DataFrame(rows)


def event_returns(trades: pd.DataFrame) -> pd.DataFrame:
    if trades.empty:
        return pd.DataFrame(columns=["event_time", "event_bps", "legs"])
    return trades.groupby("event_time").agg(
        event_bps=("net20_bps", "mean"),
        legs=("net20_bps", "size"),
        funding_bps=("realized_funding_bps", "mean"),
        price_bps=("price_bps", "mean"),
    ).reset_index()


def metrics(trades: pd.DataFrame) -> dict[str, float | int]:
    events = event_returns(trades)
    if events.empty:
        return {"events": 0, "legs": 0, "event_avg_bps": np.nan, "event_pf": np.nan,
                "event_win_rate": np.nan, "breadth": np.nan}
    values = events.event_bps.to_numpy(float)
    losses = -values[values < 0].sum()
    by_symbol = trades.groupby("symbol").net20_bps.mean()
    return {
        "events": int(len(events)),
        "legs": int(events.legs.sum()),
        "event_avg_bps": float(values.mean()),
        "event_pf": float(values[values > 0].sum() / losses) if losses else float("inf"),
        "event_win_rate": float(np.mean(values > 0)),
        "breadth": float((by_symbol > 0).mean()) if len(by_symbol) else np.nan,
    }


def account(events: pd.DataFrame, fraction_per_leg: float,
            start: pd.Timestamp, end: pd.Timestamp,
            capital: float = 10_000.0) -> dict[str, float | int]:
    equity = capital
    peak = capital
    max_dd = 0.0
    for _, row in events.sort_values("event_time").iterrows():
        gross = min(float(row.legs) * fraction_per_leg, 3.0)
        equity = max(0.0, equity * (1 + gross * float(row.event_bps) / 1e4))
        peak = max(peak, equity)
        max_dd = max(max_dd, 1 - equity / peak if peak else 1.0)
        if equity <= 0:
            break
    years = max((end - start).days / 365.25, 1 / 365.25)
    cagr = -100.0 if equity <= 0 else ((equity / capital) ** (1 / years) - 1) * 100
    return {"fraction_per_leg": fraction_per_leg, "end_usd": equity,
            "return_pct": (equity / capital - 1) * 100, "cagr_pct": cagr,
            "closed_dd_pct": max_dd * 100, "events": int(len(events)),
            "legs": int(events.legs.sum()) if len(events) else 0}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--workers", type=int, default=24)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    args.cache.mkdir(parents=True, exist_ok=True)

    manifest = source_data.download_all(SYMBOLS, args.cache, args.workers)
    pd.DataFrame(manifest).to_csv(args.output / "SOURCE_MANIFEST.csv", index=False)
    prices: dict[str, pd.DataFrame] = {}
    premium: dict[str, pd.DataFrame] = {}
    funding: dict[str, pd.DataFrame] = {}
    event_parts: list[pd.DataFrame] = []
    coverage = []
    for symbol in SYMBOLS:
        p = source_data.load_series(symbol, manifest, premium=False)
        q = source_data.load_series(symbol, manifest, premium=True)
        f = load_monthly_funding(symbol, manifest)
        coverage.append({"symbol": symbol, "price_rows": len(p), "premium_rows": len(q),
                         "funding_events": len(f)})
        if len(p) and len(q) and len(f):
            prices[symbol] = p
            premium[symbol] = q
            funding[symbol] = f
            event_parts.append(build_symbol_events(p, q, f, symbol))
    pd.DataFrame(coverage).to_csv(args.output / "COVERAGE.csv", index=False)
    all_events = pd.concat(event_parts, ignore_index=True) if event_parts else pd.DataFrame()

    dev_periods = {"2024": (START, CUT1), "2025H1": (CUT1, CUT2)}
    test_periods = {"2025H2": (CUT2, CUT3), "2026H1": (CUT3, END)}
    stores: dict[str, dict[str, pd.DataFrame]] = {}
    grid = []
    for cfg in CONFIGS:
        stores[cfg.name] = {}
        for label, bounds in {**dev_periods, **test_periods}.items():
            trades = simulate(all_events, prices, funding, cfg, *bounds)
            stores[cfg.name][label] = trades
            grid.append({"config": cfg.name, "period": label, **asdict(cfg), **metrics(trades)})
    grid_frame = pd.DataFrame(grid)
    grid_frame.to_csv(args.output / "CONFIG_RESULTS_ALL_PERIODS.csv", index=False)

    selection = []
    for cfg in CONFIGS:
        a = metrics(stores[cfg.name]["2024"])
        b = metrics(stores[cfg.name]["2025H1"])
        eligible = (a["events"] >= 15 and b["events"] >= 10
                    and a["event_avg_bps"] > 0 and b["event_avg_bps"] > 0
                    and a["event_pf"] >= 1.10 and b["event_pf"] >= 1.10
                    and min(a["breadth"], b["breadth"]) >= 0.40)
        score = (min(a["event_avg_bps"], b["event_avg_bps"])
                 * math.sqrt(min(a["events"], b["events"]) / 10)
                 * min(a["event_pf"], b["event_pf"], 3)) if eligible else -1e9
        selection.append({"config": cfg.name, "eligible": eligible, "score": score,
                          **{f"2024_{k}": v for k, v in a.items()},
                          **{f"2025H1_{k}": v for k, v in b.items()}})
    selection_frame = pd.DataFrame(selection).sort_values("score", ascending=False)
    selection_frame.to_csv(args.output / "SELECTION_BEFORE_LATE_PERIODS.csv", index=False)
    chosen_name = str(selection_frame.iloc[0].config)
    chosen = next(cfg for cfg in CONFIGS if cfg.name == chosen_name)

    factual_rows = []
    account_rows = []
    for label, (start, end) in test_periods.items():
        trades = stores[chosen.name][label]
        events = event_returns(trades)
        trades.to_csv(args.output / f"CHOSEN_TRADES_{label}.csv", index=False)
        events.to_csv(args.output / f"CHOSEN_EVENTS_{label}.csv", index=False)
        factual_rows.append({"period": label, **metrics(trades)})
        for fraction in (0.025, 0.05, 0.10, 0.20, 0.33, 0.50, 1.00):
            account_rows.append({"period": label, **account(events, fraction, start, end)})
    combined = pd.concat([stores[chosen.name][label] for label in test_periods], ignore_index=True)
    combined_events = event_returns(combined)
    factual_rows.append({"period": "LATE_12M", **metrics(combined)})
    for fraction in (0.025, 0.05, 0.10, 0.20, 0.33, 0.50, 1.00):
        account_rows.append({"period": "LATE_12M", **account(combined_events, fraction, CUT2, END)})
    pd.DataFrame(factual_rows).to_csv(args.output / "FACTUAL_LATE_RESULTS.csv", index=False)
    pd.DataFrame(account_rows).to_csv(args.output / "ACCOUNT_SCENARIOS.csv", index=False)

    summary = {"generated_at": datetime.now(UTC).isoformat(), "configs": len(CONFIGS),
               "eligible_configs": int(selection_frame.eligible.sum()),
               "chosen": asdict(chosen), "factual": factual_rows,
               "accounts": account_rows,
               "selection": selection_frame.to_dict(orient="records")}
    (args.output / "SUMMARY.json").write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    (args.output / "REPORT_RU.md").write_text(
        "# Round 46 — funding + premium confluence\n\n"
        "Конфигурация выбирается только на 2024 и 2025H1; затем без изменения "
        "проверяется на 2025H2 и 2026H1. Издержки — 20 bps на каждую ногу.\n\n"
        "## Поздние результаты\n\n" + pd.DataFrame(factual_rows).to_markdown(index=False, floatfmt=".3f")
        + "\n\n## Счёт $10 000\n\n" + pd.DataFrame(account_rows).to_markdown(index=False, floatfmt=".3f") + "\n",
        encoding="utf-8")
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
