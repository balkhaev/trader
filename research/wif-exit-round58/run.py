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
BASE_PATH = HERE.parents[1] / "altcoin-round28-confluence" / "run.py"
spec = importlib.util.spec_from_file_location("round28_base", BASE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("cannot load round28 base")
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)

SYMBOL = "WIFUSDT"
WARMUP_START = pd.Timestamp("2023-12-01", tz="UTC")
START = pd.Timestamp("2024-01-01", tz="UTC")
CUT1 = pd.Timestamp("2025-01-01", tz="UTC")
CUT2 = pd.Timestamp("2025-07-01", tz="UTC")
CUT3 = pd.Timestamp("2026-01-01", tz="UTC")
PRE_JULY_END = pd.Timestamp("2026-07-01", tz="UTC")
END = pd.Timestamp("2026-07-27", tz="UTC")
COST = 20.0
STRENGTH_THRESHOLD = 3.5

base.SYMBOLS = [SYMBOL]
base.WARMUP_START = WARMUP_START
base.START = START
base.CUT = CUT1
base.PRE_JULY_END = PRE_JULY_END
base.JULY_END = END
base.BASE_COST = 12.0
base.STRESS_COST = COST

SIGNAL_CONFIG = base.Config(
    "WIF_FIXED_SIGNAL", 2.0, 1.0, 0.50, 0.60,
    -1.0, None, None, None, 4, 1.25, 3.0,
)


@dataclass(frozen=True)
class ExitConfig:
    name: str
    hold: int
    stop_atr: float
    target_r: float | None


HOLDS = [4, 8, 12, 16]
STOPS = [0.75, 1.0, 1.25, 1.5, 2.0]
TARGETS = [2.0, 3.0, 4.0, 5.0, None]
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
]

PERIODS = {
    "2024": (START, CUT1),
    "2025H1": (CUT1, CUT2),
    "2025H2": (CUT2, CUT3),
    "2026H1": (CUT3, PRE_JULY_END),
    "JULY2026": (PRE_JULY_END, END),
}


def simulate(frame: pd.DataFrame, events: pd.DatetimeIndex, config: ExitConfig, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    mask = base.signal(frame, SIGNAL_CONFIG)
    strength = (
        frame.move3.abs().fillna(0)
        + (-frame.oi_z).clip(lower=0).fillna(0) / 2
        + (-frame.premium_z).clip(lower=0).fillna(0) / 2
    ).to_numpy(float)
    mask &= strength >= STRENGTH_THRESHOLD
    times = list(frame.open_time)
    time_ns = frame.open_time.astype("int64").to_numpy()
    open_ = frame.open.to_numpy(float)
    high = frame.high.to_numpy(float)
    low = frame.low.to_numpy(float)
    atrv = frame.atr.to_numpy(float)
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
        scheduled = entry_index + config.hold
        if scheduled >= final or not np.isfinite(atrv[signal_index]):
            continue
        if times[entry_index].date() != times[scheduled].date():
            continue
        if base.crosses(event_ns, int(time_ns[entry_index]), int(time_ns[scheduled])):
            continue
        entry = open_[entry_index]
        stop = entry - config.stop_atr * atrv[signal_index]
        risk = entry - stop
        if entry <= 0 or risk <= 0:
            continue
        target = None if config.target_r is None else entry + config.target_r * risk
        exit_price = open_[scheduled]
        exit_index = scheduled
        reason = "time"
        mae = 0.0
        mfe = 0.0
        for index in range(entry_index, scheduled):
            mae = min(mae, (low[index] / entry - 1) * 1e4)
            mfe = max(mfe, (high[index] / entry - 1) * 1e4)
            if open_[index] <= stop:
                exit_price, exit_index, reason = open_[index], index, "stop_gap"
                break
            if low[index] <= stop:
                exit_price, exit_index, reason = stop, index, "stop"
                break
            if target is not None and high[index] >= target:
                exit_price, exit_index, reason = target, index, "target"
                break
        gross = (exit_price / entry - 1) * 1e4
        stop_distance = abs((stop / entry - 1) * 1e4)
        trades.append({
            "config": config.name,
            "symbol": SYMBOL,
            "signal_time": times[signal_index],
            "entry_time": times[entry_index],
            "exit_time": times[exit_index],
            "gross_bps": gross,
            "net20_bps": gross - COST,
            "stop_distance_bps": stop_distance,
            "R20": (gross - COST) / (stop_distance + COST),
            "strength": strength[signal_index],
            "reason": reason,
            "mae_bps": mae,
            "mfe_bps": mfe,
        })
        last_exit = exit_index
    return pd.DataFrame(trades)


def metrics(frame: pd.DataFrame) -> dict[str, float | int]:
    if frame.empty:
        return {"trades": 0, "avg_bps": np.nan, "pf": np.nan, "win_rate": np.nan, "avg_R": np.nan, "total_R": 0.0, "best_R": np.nan, "worst_R": np.nan}
    values = frame.net20_bps.to_numpy(float)
    r = frame.R20.to_numpy(float)
    gains = values[values > 0].sum()
    losses = -values[values < 0].sum()
    return {
        "trades": int(len(frame)),
        "avg_bps": float(values.mean()),
        "pf": float(gains / losses) if losses else float("inf"),
        "win_rate": float(np.mean(values > 0)),
        "avg_R": float(r.mean()),
        "total_R": float(r.sum()),
        "best_R": float(r.max()),
        "worst_R": float(r.min()),
    }


def account(frame: pd.DataFrame, risk_pct: float, start: pd.Timestamp, end: pd.Timestamp, gross_cap_x: float = 3.0, initial: float = 10_000.0) -> dict[str, float | int]:
    data = frame[(pd.to_datetime(frame.entry_time, utc=True) >= start) & (pd.to_datetime(frame.entry_time, utc=True) < end)].sort_values("entry_time")
    equity = initial
    peak = initial
    max_dd = 0.0
    actual_risks: list[float] = []
    for _, trade in data.iterrows():
        stop_fraction = (float(trade.stop_distance_bps) + COST) / 1e4
        target_risk = risk_pct / 100.0
        notional = min(equity * target_risk / stop_fraction, equity * gross_cap_x)
        actual_risk = notional * stop_fraction / equity
        equity += notional * float(trade.net20_bps) / 1e4
        equity = max(0.0, equity)
        peak = max(peak, equity)
        max_dd = max(max_dd, 1 - equity / peak if peak else 1.0)
        actual_risks.append(actual_risk * 100)
        if equity <= 0:
            break
    years = max((end - start).days / 365.25, 1 / 365.25)
    return {
        "target_risk_pct": risk_pct,
        "gross_cap_x": gross_cap_x,
        "average_actual_risk_pct": float(np.mean(actual_risks)) if actual_risks else 0.0,
        "return_pct": float((equity / initial - 1) * 100),
        "cagr_pct": float(((equity / initial) ** (1 / years) - 1) * 100) if equity > 0 else -100.0,
        "closed_dd_pct": float(max_dd * 100),
        "trades": int(len(data)),
        "end_usd": float(equity),
    }


def parameter_distance(a: ExitConfig, b: ExitConfig) -> int:
    hold_distance = abs(HOLDS.index(a.hold) - HOLDS.index(b.hold))
    stop_distance = abs(STOPS.index(a.stop_atr) - STOPS.index(b.stop_atr))
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

    manifest = base.download_all(args.cache, args.workers)
    pd.DataFrame(manifest).to_csv(args.output / "SOURCE_MANIFEST.csv", index=False)
    kline = base.load_concat(SYMBOL, manifest, {"kline_monthly", "kline_daily"}, base.read_kline)
    premium = base.load_concat(SYMBOL, manifest, {"premium_monthly", "premium_daily"}, base.read_kline)
    positioning = base.load_concat(SYMBOL, manifest, {"metrics_daily"}, base.read_metrics)
    funding = base.load_funding(SYMBOL, manifest)
    if kline.empty or premium.empty or positioning.empty:
        raise RuntimeError("incomplete WIF data")
    feature = base.build_features(kline, premium, positioning)
    pd.DataFrame([{"symbol": SYMBOL, "kline_rows": len(kline), "premium_rows": len(premium), "metric_rows": len(positioning), "funding_events": len(funding), "first": kline.open_time.iloc[0], "last": kline.open_time.iloc[-1]}]).to_csv(args.output / "COVERAGE.csv", index=False)

    stores: dict[tuple[str, str], pd.DataFrame] = {}
    rows: list[dict[str, object]] = []
    for config in CONFIGS:
        for period, bounds in PERIODS.items():
            trades = simulate(feature, funding, config, *bounds)
            stores[(config.name, period)] = trades
            rows.append({**asdict(config), "period": period, **metrics(trades)})
    grid = pd.DataFrame(rows)
    grid.to_csv(args.output / "EXIT_CONFIG_PERIOD_METRICS.csv", index=False)

    selection_rows: list[dict[str, object]] = []
    eligible_names: set[str] = set()
    config_map = {config.name: config for config in CONFIGS}
    for config in CONFIGS:
        a = grid[(grid.name == config.name) & (grid.period == "2024")].iloc[0]
        b = grid[(grid.name == config.name) & (grid.period == "2025H1")].iloc[0]
        eligible = a.trades >= 6 and b.trades >= 3 and a.avg_R > 0 and b.avg_R > 0 and a.pf >= 1.10 and b.pf >= 1.10
        if eligible:
            eligible_names.add(config.name)
        score = min(a.avg_R, b.avg_R) * math.sqrt(min(a.trades, b.trades) / 3) * min(a.pf, b.pf, 3) if eligible else -1e9
        selection_rows.append({**asdict(config), "eligible_early": bool(eligible), "score": float(score), "2024_trades": int(a.trades), "2024_avg_R": float(a.avg_R) if pd.notna(a.avg_R) else np.nan, "2024_pf": float(a.pf) if pd.notna(a.pf) else np.nan, "2025H1_trades": int(b.trades), "2025H1_avg_R": float(b.avg_R) if pd.notna(b.avg_R) else np.nan, "2025H1_pf": float(b.pf) if pd.notna(b.pf) else np.nan})
    selection = pd.DataFrame(selection_rows)
    selection["eligible_neighbor_count"] = selection.name.apply(lambda name: sum(parameter_distance(config_map[name], config_map[other]) <= 1 for other in eligible_names))
    selection.to_csv(args.output / "EXIT_SELECTION_BEFORE_TEST.csv", index=False)
    robust = selection[(selection.eligible_early) & (selection.eligible_neighbor_count >= 3)].sort_values(["score", "2025H1_avg_R"], ascending=False)
    if robust.empty:
        robust = selection[selection.eligible_early].sort_values(["score", "2025H1_avg_R"], ascending=False)
    if robust.empty:
        raise RuntimeError("no early-positive exit configuration")
    chosen_name = str(robust.iloc[0]["name"])
    chosen = config_map[chosen_name]

    chosen_parts: list[pd.DataFrame] = []
    factual_rows: list[dict[str, object]] = []
    for period in PERIODS:
        trades = stores[(chosen_name, period)].copy()
        factual_rows.append({"period": period, **metrics(trades)})
        if len(trades):
            trades["period"] = period
            chosen_parts.append(trades)
    chosen_trades = pd.concat(chosen_parts, ignore_index=True) if chosen_parts else pd.DataFrame()
    chosen_trades.to_csv(args.output / "CHOSEN_TRADES.csv", index=False)
    factual = pd.DataFrame(factual_rows)
    factual.to_csv(args.output / "CHOSEN_PERIOD_METRICS.csv", index=False)

    account_rows: list[dict[str, object]] = []
    for label, bounds in {"2025H2": PERIODS["2025H2"], "2026H1": PERIODS["2026H1"], "FIXED_LATE_12M": (CUT2, PRE_JULY_END), "FULL_30M": (START, PRE_JULY_END), "JULY2026": PERIODS["JULY2026"]}.items():
        for cap in (1.0, 2.0, 3.0):
            for risk in (0.5, 1.0, 2.0, 3.0, 5.0, 10.0):
                account_rows.append({"period": label, **account(chosen_trades, risk, *bounds, gross_cap_x=cap)})
    accounts = pd.DataFrame(account_rows)
    accounts.to_csv(args.output / "ACCOUNT_SCENARIOS.csv", index=False)

    summary = {"generated_at": datetime.now(UTC).isoformat(), "fixed_signal": asdict(SIGNAL_CONFIG), "strength_threshold": STRENGTH_THRESHOLD, "exit_configs": len(CONFIGS), "chosen_exit": asdict(chosen), "chosen_neighbor_count": int(selection.loc[selection.name == chosen_name, "eligible_neighbor_count"].iloc[0]), "period_metrics": factual_rows, "accounts": account_rows}
    (args.output / "SUMMARY.json").write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    report = "# Round 58 — WIF exit optimization\n\nSignal and strength threshold are frozen. Exit parameters are selected only on 2024 and 2025H1; 2025H2, 2026H1 and July 2026 are fixed tests.\n\n## Chosen exit\n\n```json\n" + json.dumps(asdict(chosen), indent=2) + "\n```\n\n## Period metrics\n\n" + factual.to_markdown(index=False, floatfmt=".3f") + "\n\n## Account scenarios\n\n" + accounts.to_markdown(index=False, floatfmt=".3f") + "\n"
    (args.output / "REPORT_RU.md").write_text(report, encoding="utf-8")
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
