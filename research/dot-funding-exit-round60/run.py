from __future__ import annotations

import argparse
import importlib.util
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
BASE_PATH = HERE.parents[1] / "altcoin-round41-funding-carry" / "run.py"
sys.path.insert(0, str(PREMIUM_DIR))

import config as premium_config  # noqa: E402
import data as data_mod  # noqa: E402

spec = importlib.util.spec_from_file_location("funding_base", BASE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("cannot load funding base")
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)

SYMBOL = "DOTUSDT"
WARMUP_START = pd.Timestamp("2023-12-01", tz="UTC")
START = pd.Timestamp("2024-01-01", tz="UTC")
CUT1 = pd.Timestamp("2025-01-01", tz="UTC")
CUT2 = pd.Timestamp("2025-07-01", tz="UTC")
CUT3 = pd.Timestamp("2026-01-01", tz="UTC")
END = pd.Timestamp("2026-07-01", tz="UTC")
COST_BPS = 20.0
SIGNAL_THRESHOLD_BPS = -2.0

for module in (data_mod,):
    module.WARMUP_START = WARMUP_START
    module.PRE_JULY_END = END
    module.JULY_END = END
base.SYMBOLS = [SYMBOL]
base.START = START
base.CUT = CUT1
base.PRE_JULY_END = END
base.JULY_END = END
base.COST_BPS = COST_BPS


@dataclass(frozen=True)
class ExitConfig:
    name: str
    hold_bars: int
    stop_atr: float | None
    target_r: float | None


HOLDS = [8, 16, 32]
STOPS = [1.5, 2.0, 3.0, 4.0, 6.0]
TARGETS = [2.0, 3.0, 4.0, None]
CONFIGS = [
    ExitConfig(
        f"H{hold}_S{str(stop).replace('.', 'p')}_T{'TIME' if target is None else str(target).replace('.', 'p')}",
        hold,
        stop,
        target,
    )
    for hold in HOLDS
    for stop in STOPS
    for target in TARGETS
] + [ExitConfig(f"H{hold}_NO_STOP", hold, None, None) for hold in HOLDS]

PERIODS = {
    "2024": (START, CUT1),
    "2025H1": (CUT1, CUT2),
    "2025H2": (CUT2, CUT3),
    "2026H1": (CUT3, END),
}


def load_monthly_funding(symbol: str, manifest: list[dict[str, object]]) -> pd.DataFrame:
    parts = [
        data_mod.read_funding_zip(path)
        for path in data_mod.verified_paths(symbol, manifest, {"funding_monthly"})
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
    return true_range.ewm(alpha=1 / periods, adjust=False, min_periods=periods).mean()


def simulate(price: pd.DataFrame, funding: pd.DataFrame, config: ExitConfig, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    frame = price.copy().sort_values("open_time").reset_index(drop=True)
    for column in ("open", "high", "low", "close"):
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame["atr"] = atr(frame)
    index_map = {timestamp: index for index, timestamp in enumerate(frame.open_time)}
    open_ = frame.open.to_numpy(float)
    high = frame.high.to_numpy(float)
    low = frame.low.to_numpy(float)
    atr_values = frame.atr.to_numpy(float)
    times = list(frame.open_time)

    events = funding.sort_values("funding_time").copy()
    events["rate_bps"] = events.funding_rate * 1e4
    events = events[
        (events.funding_time >= start)
        & (events.funding_time < end)
        & (events.rate_bps <= SIGNAL_THRESHOLD_BPS)
    ]
    rows: list[dict[str, object]] = []
    last_exit = -1
    for _, event in events.iterrows():
        event_time = pd.Timestamp(event.funding_time)
        signal_index = index_map.get(event_time)
        entry_time = event_time + pd.Timedelta(minutes=15)
        entry_index = index_map.get(entry_time)
        if signal_index is None or entry_index is None or signal_index <= last_exit:
            continue
        exit_index_planned = entry_index + config.hold_bars
        if exit_index_planned >= len(frame):
            continue
        planned_exit_time = times[exit_index_planned]
        if not (start <= entry_time < end) or planned_exit_time >= end:
            continue
        if entry_time.date() != planned_exit_time.date():
            continue
        signal_atr = atr_values[signal_index]
        if not np.isfinite(signal_atr) or signal_atr <= 0:
            continue
        entry = open_[entry_index]
        stop = None if config.stop_atr is None else entry - config.stop_atr * signal_atr
        risk = None if stop is None else entry - stop
        target = None if config.target_r is None or risk is None else entry + config.target_r * risk
        exit_price = open_[exit_index_planned]
        exit_index = exit_index_planned
        reason = "time"
        mae = 0.0
        mfe = 0.0
        for index in range(entry_index, exit_index_planned):
            mae = min(mae, (low[index] / entry - 1) * 1e4)
            mfe = max(mfe, (high[index] / entry - 1) * 1e4)
            if stop is not None:
                if open_[index] <= stop:
                    exit_price, exit_index, reason = open_[index], index, "stop_gap"
                    break
                if low[index] <= stop:
                    exit_price, exit_index, reason = stop, index, "stop"
                    break
            if target is not None and high[index] >= target:
                exit_price, exit_index, reason = target, index, "target"
                break
        exit_time = times[exit_index]
        price_bps = (exit_price / entry - 1) * 1e4
        next_funding_bps = base.actual_funding(funding, entry_time, exit_time, 1)
        net20_bps = price_bps + next_funding_bps - COST_BPS
        stop_distance_bps = np.nan if stop is None else abs((stop / entry - 1) * 1e4)
        r20 = np.nan if stop is None else net20_bps / (stop_distance_bps + COST_BPS)
        rows.append({
            "symbol": SYMBOL,
            "config": config.name,
            "event_time": event_time,
            "entry_time": entry_time,
            "exit_time": exit_time,
            "signal_funding_bps": float(event.rate_bps),
            "next_funding_bps": float(next_funding_bps),
            "price_bps": float(price_bps),
            "net20_bps": float(net20_bps),
            "stop_distance_bps": stop_distance_bps,
            "R20": r20,
            "mae_bps": mae,
            "mfe_bps": mfe,
            "reason": reason,
        })
        last_exit = exit_index
    return pd.DataFrame(rows)


def metrics(frame: pd.DataFrame) -> dict[str, float | int]:
    if frame.empty:
        return {"trades": 0, "avg_bps": np.nan, "pf": np.nan, "win_rate": np.nan, "avg_R": np.nan, "total_R": 0.0, "worst_bps": np.nan, "best_bps": np.nan}
    values = frame.net20_bps.to_numpy(float)
    gains = values[values > 0].sum()
    losses = -values[values < 0].sum()
    valid_r = frame.R20.dropna().to_numpy(float)
    return {
        "trades": int(len(frame)),
        "avg_bps": float(values.mean()),
        "pf": float(gains / losses) if losses else float("inf"),
        "win_rate": float(np.mean(values > 0)),
        "avg_R": float(valid_r.mean()) if len(valid_r) else np.nan,
        "total_R": float(valid_r.sum()) if len(valid_r) else np.nan,
        "worst_bps": float(values.min()),
        "best_bps": float(values.max()),
    }


def account(frame: pd.DataFrame, fraction: float, start: pd.Timestamp, end: pd.Timestamp, initial: float = 10_000.0) -> dict[str, float | int]:
    data = frame[
        (pd.to_datetime(frame.entry_time, utc=True) >= start)
        & (pd.to_datetime(frame.entry_time, utc=True) < end)
    ].sort_values("entry_time")
    equity = initial
    peak = initial
    max_dd = 0.0
    for _, trade in data.iterrows():
        equity *= max(0.0, 1 + fraction * float(trade.net20_bps) / 1e4)
        peak = max(peak, equity)
        max_dd = max(max_dd, 1 - equity / peak if peak else 1.0)
        if equity <= 0:
            break
    years = max((end - start).days / 365.25, 1 / 365.25)
    return {
        "fraction_per_position": fraction,
        "return_pct": float((equity / initial - 1) * 100),
        "cagr_pct": float(((equity / initial) ** (1 / years) - 1) * 100) if equity > 0 else -100.0,
        "closed_dd_pct": float(max_dd * 100),
        "trades": int(len(data)),
        "end_usd": float(equity),
    }


def parameter_distance(a: ExitConfig, b: ExitConfig) -> int:
    hold_distance = abs(HOLDS.index(a.hold_bars) - HOLDS.index(b.hold_bars))
    if a.stop_atr is None or b.stop_atr is None:
        stop_distance = 0 if a.stop_atr is None and b.stop_atr is None else 2
    else:
        stop_distance = abs(STOPS.index(a.stop_atr) - STOPS.index(b.stop_atr))
    if a.target_r is None or b.target_r is None:
        target_distance = 0 if a.target_r is None and b.target_r is None else 1
    else:
        target_distance = abs(TARGETS.index(a.target_r) - TARGETS.index(b.target_r))
    return hold_distance + stop_distance + target_distance


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--workers", type=int, default=24)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    args.cache.mkdir(parents=True, exist_ok=True)

    manifest = data_mod.download_all([SYMBOL], args.cache, args.workers)
    pd.DataFrame(manifest).to_csv(args.output / "SOURCE_MANIFEST.csv", index=False)
    price = data_mod.load_series(SYMBOL, manifest, premium=False)
    funding = load_monthly_funding(SYMBOL, manifest)
    if price.empty or funding.empty:
        raise RuntimeError("incomplete DOT data")
    pd.DataFrame([{"symbol": SYMBOL, "price_rows": len(price), "funding_events": len(funding), "first_price": price.open_time.iloc[0], "last_price": price.open_time.iloc[-1], "first_funding": funding.funding_time.iloc[0], "last_funding": funding.funding_time.iloc[-1]}]).to_csv(args.output / "COVERAGE.csv", index=False)

    stores: dict[tuple[str, str], pd.DataFrame] = {}
    metric_rows: list[dict[str, object]] = []
    for config in CONFIGS:
        for period, bounds in PERIODS.items():
            trades = simulate(price, funding, config, *bounds)
            stores[(config.name, period)] = trades
            metric_rows.append({**asdict(config), "period": period, **metrics(trades)})
    grid = pd.DataFrame(metric_rows)
    grid.to_csv(args.output / "EXIT_CONFIG_PERIOD_METRICS.csv", index=False)

    config_map = {config.name: config for config in CONFIGS}
    selection_rows: list[dict[str, object]] = []
    eligible_names: set[str] = set()
    for config in CONFIGS:
        a = grid[(grid.name == config.name) & (grid.period == "2024")].iloc[0]
        b = grid[(grid.name == config.name) & (grid.period == "2025H1")].iloc[0]
        eligible = a.trades >= 12 and b.trades >= 6 and a.avg_bps > 0 and b.avg_bps > 0 and a.pf >= 1.15 and b.pf >= 1.15
        if eligible:
            eligible_names.add(config.name)
        score = min(a.avg_bps, b.avg_bps) * math.sqrt(min(a.trades, b.trades) / 6) * min(a.pf, b.pf, 3) if eligible else -1e9
        selection_rows.append({**asdict(config), "eligible_early": bool(eligible), "score": float(score), "2024_trades": int(a.trades), "2024_avg_bps": float(a.avg_bps) if pd.notna(a.avg_bps) else np.nan, "2024_pf": float(a.pf) if pd.notna(a.pf) else np.nan, "2025H1_trades": int(b.trades), "2025H1_avg_bps": float(b.avg_bps) if pd.notna(b.avg_bps) else np.nan, "2025H1_pf": float(b.pf) if pd.notna(b.pf) else np.nan})
    selection = pd.DataFrame(selection_rows)
    selection["eligible_neighbor_count"] = selection.name.apply(lambda name: sum(parameter_distance(config_map[name], config_map[other]) <= 1 for other in eligible_names))
    selection.to_csv(args.output / "EXIT_SELECTION_BEFORE_TEST.csv", index=False)
    robust = selection[(selection.eligible_early) & (selection.eligible_neighbor_count >= 3)].sort_values(["score", "2025H1_avg_bps"], ascending=False)
    if robust.empty:
        robust = selection[selection.eligible_early].sort_values(["score", "2025H1_avg_bps"], ascending=False)
    if robust.empty:
        raise RuntimeError("no early-positive exit configuration")
    chosen_name = str(robust.iloc[0]["name"])
    chosen = config_map[chosen_name]

    trade_parts: list[pd.DataFrame] = []
    period_rows: list[dict[str, object]] = []
    for period in PERIODS:
        trades = stores[(chosen_name, period)].copy()
        period_rows.append({"period": period, **metrics(trades)})
        if len(trades):
            trades["period"] = period
            trade_parts.append(trades)
    chosen_trades = pd.concat(trade_parts, ignore_index=True) if trade_parts else pd.DataFrame()
    chosen_trades.to_csv(args.output / "CHOSEN_TRADES.csv", index=False)
    period_frame = pd.DataFrame(period_rows)
    period_frame.to_csv(args.output / "CHOSEN_PERIOD_METRICS.csv", index=False)

    account_rows: list[dict[str, object]] = []
    for label, bounds in {"2025H2": PERIODS["2025H2"], "2026H1": PERIODS["2026H1"], "FIXED_LATE_12M": (CUT2, END), "FULL_30M": (START, END)}.items():
        for fraction in (0.05, 0.10, 0.20, 0.33, 0.50, 1.0, 2.0, 3.0):
            account_rows.append({"period": label, **account(chosen_trades, fraction, *bounds)})
    accounts = pd.DataFrame(account_rows)
    accounts.to_csv(args.output / "ACCOUNT_SCENARIOS.csv", index=False)

    summary = {"generated_at": datetime.now(UTC).isoformat(), "fixed_signal": {"symbol": SYMBOL, "side": "long", "known_funding_threshold_bps": SIGNAL_THRESHOLD_BPS}, "exit_configs": len(CONFIGS), "chosen_exit": asdict(chosen), "chosen_neighbor_count": int(selection.loc[selection.name == chosen_name, "eligible_neighbor_count"].iloc[0]), "period_metrics": period_rows, "accounts": account_rows}
    (args.output / "SUMMARY.json").write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    report = "# Round 60 — DOT funding exit optimization\n\nSignal is fixed: long DOT 15 minutes after known funding <= -2 bps. Exits are selected only on 2024 and 2025H1; 2025H2 and 2026H1 are fixed tests.\n\n## Chosen exit\n\n```json\n" + json.dumps(asdict(chosen), indent=2) + "\n```\n\n## Period metrics\n\n" + period_frame.to_markdown(index=False, floatfmt=".3f") + "\n\n## Accounts\n\n" + accounts.to_markdown(index=False, floatfmt=".3f") + "\n"
    (args.output / "REPORT_RU.md").write_text(report, encoding="utf-8")
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
