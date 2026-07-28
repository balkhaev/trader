from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from dataclasses import asdict
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

SYMBOLS = [
    "SOLUSDT", "XRPUSDT", "DOGEUSDT", "BNBUSDT", "SUIUSDT",
    "ADAUSDT", "LINKUSDT", "AVAXUSDT", "LTCUSDT", "BCHUSDT",
    "AAVEUSDT", "OPUSDT", "ETCUSDT", "INJUSDT", "TIAUSDT",
    "NEARUSDT", "ONDOUSDT", "PENDLEUSDT", "TAOUSDT", "APTUSDT",
    "ENAUSDT", "FETUSDT", "RENDERUSDT", "TONUSDT", "HBARUSDT",
    "XLMUSDT", "JUPUSDT", "WIFUSDT", "ZECUSDT", "ALGOUSDT",
]
WARMUP_START = pd.Timestamp("2023-12-01", tz="UTC")
START = pd.Timestamp("2024-01-01", tz="UTC")
CUT1 = pd.Timestamp("2025-01-01", tz="UTC")
CUT2 = pd.Timestamp("2025-07-01", tz="UTC")
CUT3 = pd.Timestamp("2026-01-01", tz="UTC")
PRE_JULY_END = pd.Timestamp("2026-07-01", tz="UTC")
END = pd.Timestamp("2026-07-27", tz="UTC")
COST = 20.0
THRESHOLDS = [0.0, 3.5, 4.5, 5.5, 6.5]

base.SYMBOLS = SYMBOLS
base.WARMUP_START = WARMUP_START
base.START = START
base.CUT = CUT1
base.PRE_JULY_END = PRE_JULY_END
base.JULY_END = END
base.BASE_COST = 12.0
base.STRESS_COST = COST

PERIODS = {
    "2024": (START, CUT1),
    "2025H1": (CUT1, CUT2),
    "2025H2": (CUT2, CUT3),
    "2026H1": (CUT3, PRE_JULY_END),
    "JULY2026": (PRE_JULY_END, END),
}


def simulate(symbol: str, frame: pd.DataFrame, events: pd.DatetimeIndex, config: base.Config, threshold: float, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    mask = base.signal(frame, config)
    strength = (
        frame.move3.abs().fillna(0)
        + (-frame.oi_z).clip(lower=0).fillna(0) / 2
        + (-frame.premium_z).clip(lower=0).fillna(0) / 2
    ).to_numpy(float)
    if threshold > 0:
        mask &= strength >= threshold
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
    rows: list[dict[str, object]] = []
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
        stop = entry - config.stop * atrv[signal_index]
        risk = entry - stop
        if entry <= 0 or risk <= 0:
            continue
        target = None if config.target is None else entry + config.target * risk
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
        rows.append({
            "symbol": symbol,
            "config": config.name,
            "strength_threshold": threshold,
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
    return pd.DataFrame(rows)


def metrics(frame: pd.DataFrame) -> dict[str, float | int]:
    if frame.empty:
        return {"trades": 0, "avg_bps": np.nan, "pf": np.nan, "win_rate": np.nan, "avg_R": np.nan, "total_R": 0.0}
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
    }


def account(frame: pd.DataFrame, risk_pct: float, start: pd.Timestamp, end: pd.Timestamp, initial: float = 10_000.0, max_positions: int = 4, gross_cap_x: float = 3.0) -> dict[str, float | int]:
    data = frame[(pd.to_datetime(frame.entry_time, utc=True) >= start) & (pd.to_datetime(frame.entry_time, utc=True) < end)].sort_values(["entry_time", "dev_score", "strength"], ascending=[True, False, False]).reset_index(drop=True)
    equity = initial
    open_positions: dict[int, dict[str, float | str]] = {}
    curve: list[float] = []
    accepted = 0
    for timestamp in sorted(set(data.entry_time) | set(data.exit_time)) if len(data) else []:
        for index, position in list(open_positions.items()):
            row = data.iloc[index]
            if row.exit_time == timestamp and row.entry_time < timestamp:
                equity += float(position["notional"]) * float(row.net20_bps) / 1e4
                del open_positions[index]
                accepted += 1
        for index in data.index[data.entry_time == timestamp]:
            row = data.iloc[index]
            if len(open_positions) >= max_positions or any(str(position["symbol"]) == row.symbol for position in open_positions.values()):
                continue
            stop_fraction = (float(row.stop_distance_bps) + COST) / 1e4
            if not np.isfinite(stop_fraction) or stop_fraction <= 0:
                continue
            notional = min(equity * (risk_pct / 100) / stop_fraction, equity * 2.0)
            gross_now = sum(float(position["notional"]) for position in open_positions.values())
            notional = min(notional, max(0.0, equity * gross_cap_x - gross_now))
            if notional > 0:
                open_positions[index] = {"symbol": row.symbol, "notional": notional}
        for index, position in list(open_positions.items()):
            row = data.iloc[index]
            if row.exit_time == timestamp and row.entry_time == timestamp:
                equity += float(position["notional"]) * float(row.net20_bps) / 1e4
                del open_positions[index]
                accepted += 1
        curve.append(equity)
    values = np.asarray(curve, dtype=float) if curve else np.asarray([initial])
    drawdown = 1 - values / np.maximum.accumulate(values)
    years = max((end - start).days / 365.25, 1 / 365.25)
    return {
        "risk_pct": risk_pct,
        "return_pct": float((equity / initial - 1) * 100),
        "cagr_pct": float(((equity / initial) ** (1 / years) - 1) * 100) if equity > 0 else -100.0,
        "closed_dd_pct": float(drawdown.max() * 100),
        "accepted_trades": int(accepted),
        "end_usd": float(equity),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--workers", type=int, default=40)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    args.cache.mkdir(parents=True, exist_ok=True)

    manifest = base.download_all(args.cache, args.workers)
    pd.DataFrame(manifest).to_csv(args.output / "SOURCE_MANIFEST.csv", index=False)
    features: dict[str, pd.DataFrame] = {}
    funding: dict[str, pd.DatetimeIndex] = {}
    coverage: list[dict[str, object]] = []
    for symbol in SYMBOLS:
        kline = base.load_concat(symbol, manifest, {"kline_monthly", "kline_daily"}, base.read_kline)
        premium = base.load_concat(symbol, manifest, {"premium_monthly", "premium_daily"}, base.read_kline)
        positioning = base.load_concat(symbol, manifest, {"metrics_daily"}, base.read_metrics)
        events = base.load_funding(symbol, manifest)
        coverage.append({"symbol": symbol, "kline_rows": len(kline), "premium_rows": len(premium), "metric_rows": len(positioning), "funding_events": len(events), "first": None if kline.empty else kline.open_time.iloc[0], "last": None if kline.empty else kline.open_time.iloc[-1]})
        if not kline.empty and not premium.empty and not positioning.empty:
            features[symbol] = base.build_features(kline, premium, positioning)
            funding[symbol] = events
    pd.DataFrame(coverage).to_csv(args.output / "COVERAGE.csv", index=False)

    stores: dict[tuple[str, float, str, str], pd.DataFrame] = {}
    metric_rows: list[dict[str, object]] = []
    for config in base.CONFIGS:
        for threshold in THRESHOLDS:
            for symbol, feature in features.items():
                for period, bounds in PERIODS.items():
                    trades = simulate(symbol, feature, funding[symbol], config, threshold, *bounds)
                    stores[(config.name, threshold, symbol, period)] = trades
                    metric_rows.append({"symbol": symbol, "config": config.name, "strength_threshold": threshold, "period": period, **asdict(config), **metrics(trades)})
        print(config.name, flush=True)
    grid = pd.DataFrame(metric_rows)
    grid.to_csv(args.output / "COIN_CONFIG_THRESHOLD_PERIOD_METRICS.csv", index=False)

    selection_rows: list[dict[str, object]] = []
    routes: list[dict[str, object]] = []
    for symbol in features:
        candidates: list[dict[str, object]] = []
        for config in base.CONFIGS:
            for threshold in THRESHOLDS:
                a = grid[(grid.symbol == symbol) & (grid.config == config.name) & (grid.strength_threshold == threshold) & (grid.period == "2024")].iloc[0]
                b = grid[(grid.symbol == symbol) & (grid.config == config.name) & (grid.strength_threshold == threshold) & (grid.period == "2025H1")].iloc[0]
                eligible = a.trades >= 6 and b.trades >= 3 and a.avg_R > 0 and b.avg_R > 0 and a.pf >= 1.10 and b.pf >= 1.10
                score = min(a.avg_R, b.avg_R) * math.sqrt(min(a.trades, b.trades) / 3) * min(a.pf, b.pf, 3) if eligible else -1e9
                candidates.append({"symbol": symbol, "config": config.name, "strength_threshold": threshold, "eligible": bool(eligible), "score": float(score), "2024_trades": int(a.trades), "2024_avg_R": float(a.avg_R) if pd.notna(a.avg_R) else np.nan, "2024_pf": float(a.pf) if pd.notna(a.pf) else np.nan, "2025H1_trades": int(b.trades), "2025H1_avg_R": float(b.avg_R) if pd.notna(b.avg_R) else np.nan, "2025H1_pf": float(b.pf) if pd.notna(b.pf) else np.nan})
        symbol_frame = pd.DataFrame(candidates)
        symbol_frame["eligible_neighbor_count"] = 0
        for config_name in symbol_frame.config.unique():
            local = symbol_frame[symbol_frame.config == config_name]
            eligible_thresholds = set(local.loc[local.eligible, "strength_threshold"].astype(float))
            for index, row in local.iterrows():
                symbol_frame.loc[index, "eligible_neighbor_count"] = sum(abs(float(row.strength_threshold) - other) <= 1.000001 for other in eligible_thresholds)
        selection_rows += symbol_frame.to_dict(orient="records")
        robust = symbol_frame[(symbol_frame.eligible) & (symbol_frame.eligible_neighbor_count >= 2)]
        if not robust.empty:
            best = robust.sort_values(["score", "2025H1_avg_R"], ascending=False).iloc[0]
            routes.append({"symbol": symbol, "config": str(best.config), "strength_threshold": float(best.strength_threshold), "dev_score": float(best.score), "eligible_neighbor_count": int(best.eligible_neighbor_count)})
    selection = pd.DataFrame(selection_rows)
    selection.to_csv(args.output / "ROUTE_SELECTION_BEFORE_TEST.csv", index=False)
    route_frame = pd.DataFrame(routes)
    route_frame.to_csv(args.output / "SELECTED_ROUTES.csv", index=False)

    results: list[dict[str, object]] = []
    fixed_parts: list[pd.DataFrame] = []
    for route in routes:
        for period in PERIODS:
            trades = stores[(str(route["config"]), float(route["strength_threshold"]), str(route["symbol"]), period)].copy()
            results.append({**route, "period": period, **metrics(trades)})
            if period in {"2025H2", "2026H1", "JULY2026"} and len(trades):
                trades["period"] = period
                trades["dev_score"] = route["dev_score"]
                fixed_parts.append(trades)
    results_frame = pd.DataFrame(results)
    results_frame.to_csv(args.output / "SELECTED_ROUTE_RESULTS.csv", index=False)
    decision_path = args.output / "FIXED_LATE_DECISIONS.csv"
    if len(results_frame):
        pivot = results_frame[results_frame.period.isin(["2025H2", "2026H1"])].pivot_table(index=["symbol", "config", "strength_threshold"], columns="period", values=["trades", "avg_bps", "pf", "avg_R"], aggfunc="first")
        pivot.columns = [f"{metric}_{period}" for metric, period in pivot.columns]
        pivot = pivot.reset_index()
        for column in ["trades_2025H2", "trades_2026H1", "avg_bps_2025H2", "avg_bps_2026H1", "pf_2025H2", "pf_2026H1", "avg_R_2025H2", "avg_R_2026H1"]:
            if column not in pivot:
                pivot[column] = np.nan
        pivot["passes_fixed_late_gate"] = (pivot.trades_2025H2 >= 5) & (pivot.trades_2026H1 >= 5) & (pivot.avg_R_2025H2 > 0) & (pivot.avg_R_2026H1 > 0) & (pivot.pf_2025H2 >= 1.10) & (pivot.pf_2026H1 >= 1.10)
        pivot.to_csv(decision_path, index=False)
    portfolio = pd.concat(fixed_parts, ignore_index=True) if fixed_parts else pd.DataFrame()
    portfolio.to_csv(args.output / "SELECTED_ROUTE_TRADES_LATE.csv", index=False)

    account_rows: list[dict[str, object]] = []
    for label, bounds in {"2025H2": PERIODS["2025H2"], "2026H1": PERIODS["2026H1"], "FIXED_LATE_12M": (CUT2, PRE_JULY_END), "JULY2026": PERIODS["JULY2026"]}.items():
        for risk in (0.25, 0.5, 1.0, 2.0, 3.0, 5.0):
            account_rows.append({"period": label, **account(portfolio, risk, *bounds)})
    accounts = pd.DataFrame(account_rows)
    accounts.to_csv(args.output / "ACCOUNT_SCENARIOS.csv", index=False)

    summary = {"generated_at": datetime.now(UTC).isoformat(), "symbols": len(features), "base_configs": len(base.CONFIGS), "thresholds": THRESHOLDS, "selected_routes_before_test": routes, "selected_route_results": results, "accounts": account_rows}
    if decision_path.exists():
        decisions = pd.read_csv(decision_path)
        summary["fixed_late_pass_count"] = int(decisions.passes_fixed_late_gate.sum())
        summary["fixed_late_pass_symbols"] = decisions.loc[decisions.passes_fixed_late_gate, "symbol"].tolist()
    (args.output / "SUMMARY.json").write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    report = "# Round 59 — coin-specific confluence\n\nMechanism and strength threshold are selected only on 2024 and 2025H1; later periods are fixed tests.\n\n## Routes before test\n\n" + (route_frame.to_markdown(index=False) if len(route_frame) else "No robust routes selected.") + "\n\n## Fixed late decisions\n\n" + (pd.read_csv(decision_path).to_markdown(index=False) if decision_path.exists() else "No decisions.") + "\n\n## Accounts\n\n" + accounts.to_markdown(index=False, floatfmt=".3f") + "\n"
    (args.output / "REPORT_RU.md").write_text(report, encoding="utf-8")
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
