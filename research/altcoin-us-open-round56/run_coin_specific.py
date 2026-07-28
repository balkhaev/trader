from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve()
BASE_PATH = HERE.parents[1] / "altcoin-us-open-round52" / "run_fixed.py"
spec = importlib.util.spec_from_file_location("us_open_fixed", BASE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("cannot load fixed US-open engine")
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)
engine = base.base

PERIODS = {
    "2024": (engine.START, engine.CUT1),
    "2025H1": (engine.CUT1, engine.CUT2),
    "2025H2": (engine.CUT2, engine.CUT3),
    "2026H1": (engine.CUT3, engine.END),
}


def coin_metrics(frame: pd.DataFrame) -> dict[str, float | int]:
    if frame.empty:
        return {"trades": 0, "avg_bps": np.nan, "pf": np.nan, "win_rate": np.nan, "avg_R": np.nan, "total_R": 0.0}
    values = frame.net20_bps.to_numpy(float)
    risk = frame.stop_distance_bps.to_numpy(float)
    r = values / risk
    gains = values[values > 0].sum()
    losses = -values[values < 0].sum()
    return {
        "trades": int(len(values)),
        "avg_bps": float(values.mean()),
        "pf": float(gains / losses) if losses else float("inf"),
        "win_rate": float(np.mean(values > 0)),
        "avg_R": float(r.mean()),
        "total_R": float(r.sum()),
    }


def account(frame: pd.DataFrame, risk_pct: float, start: pd.Timestamp, end: pd.Timestamp, initial: float = 10_000.0, max_positions: int = 4, gross_cap_x: float = 6.0) -> dict[str, float | int]:
    data = frame[(pd.to_datetime(frame.entry_time, utc=True) >= start) & (pd.to_datetime(frame.entry_time, utc=True) < end)].sort_values(["entry_time", "dev_score", "strength"], ascending=[True, False, False]).reset_index(drop=True)
    if data.empty:
        return {"risk_pct": risk_pct, "return_pct": 0.0, "cagr_pct": 0.0, "closed_dd_pct": 0.0, "accepted_trades": 0, "end_usd": initial}
    equity = initial
    open_positions: dict[int, dict[str, float | str]] = {}
    curve: list[float] = []
    accepted = 0
    for timestamp in sorted(set(data.entry_time) | set(data.exit_time)):
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
            stop_fraction = float(row.stop_distance_bps) / 1e4
            if not np.isfinite(stop_fraction) or stop_fraction <= 0:
                continue
            notional = min(equity * (risk_pct / 100.0) / stop_fraction, equity * 2.0)
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
    values = np.asarray(curve, dtype=float)
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
    parser.add_argument("--workers", type=int, default=32)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    args.cache.mkdir(parents=True, exist_ok=True)

    manifest = engine.download_all(args.cache, args.workers)
    pd.DataFrame(manifest).to_csv(args.output / "SOURCE_MANIFEST.csv", index=False)
    frames: dict[str, pd.DataFrame] = {}
    funding: dict[str, pd.DatetimeIndex] = {}
    coverage: list[dict[str, object]] = []
    for symbol in engine.SYMBOLS:
        frame, events = engine.load_symbol(symbol, manifest)
        coverage.append({"symbol": symbol, "rows": len(frame), "funding_events": len(events), "first": None if frame.empty else frame.open_time.iloc[0], "last": None if frame.empty else frame.open_time.iloc[-1]})
        if len(frame):
            frames[symbol] = frame
            funding[symbol] = events
    pd.DataFrame(coverage).to_csv(args.output / "COVERAGE.csv", index=False)
    panel = engine.build_panel(frames)

    trade_store: dict[tuple[str, str], pd.DataFrame] = {}
    rows: list[dict[str, object]] = []
    for index, cfg in enumerate(engine.CONFIGS, 1):
        candidates = engine.event_candidates(panel, cfg)
        for period, bounds in PERIODS.items():
            trades = engine.simulate(candidates, frames, funding, cfg, *bounds)
            trade_store[(cfg.name, period)] = trades
            for symbol in engine.SYMBOLS:
                part = trades[trades.symbol == symbol] if len(trades) else pd.DataFrame()
                rows.append({"config": cfg.name, "slot": cfg.slot, "mode": cfg.mode, "lookback": cfg.lookback, "z_threshold": cfg.z_threshold, "k": cfg.k, "hold": cfg.hold, "symbol": symbol, "period": period, **coin_metrics(part)})
        if index % 12 == 0:
            print(f"configs {index}/{len(engine.CONFIGS)}", flush=True)
    grid = pd.DataFrame(rows)
    grid.to_csv(args.output / "COIN_CONFIG_PERIOD_METRICS.csv", index=False)

    route_rows: list[dict[str, object]] = []
    selection_rows: list[dict[str, object]] = []
    for symbol in engine.SYMBOLS:
        candidates: list[dict[str, object]] = []
        for cfg in engine.CONFIGS:
            a = grid[(grid.config == cfg.name) & (grid.symbol == symbol) & (grid.period == "2024")].iloc[0]
            b = grid[(grid.config == cfg.name) & (grid.symbol == symbol) & (grid.period == "2025H1")].iloc[0]
            eligible = a.trades >= 8 and b.trades >= 4 and a.avg_bps > 0 and b.avg_bps > 0 and a.pf >= 1.15 and b.pf >= 1.15 and a.avg_R > 0 and b.avg_R > 0
            score = min(a.avg_R, b.avg_R) * math.sqrt(min(a.trades, b.trades) / 4) * min(a.pf, b.pf, 3) if eligible else -1e9
            candidates.append({"symbol": symbol, "config": cfg.name, "slot": cfg.slot, "mode": cfg.mode, "lookback": cfg.lookback, "z_threshold": cfg.z_threshold, "k": cfg.k, "hold": cfg.hold, "eligible": bool(eligible), "score": float(score), "2024_trades": int(a.trades), "2024_avg_bps": float(a.avg_bps) if pd.notna(a.avg_bps) else np.nan, "2024_pf": float(a.pf) if pd.notna(a.pf) else np.nan, "2024_avg_R": float(a.avg_R) if pd.notna(a.avg_R) else np.nan, "2025H1_trades": int(b.trades), "2025H1_avg_bps": float(b.avg_bps) if pd.notna(b.avg_bps) else np.nan, "2025H1_pf": float(b.pf) if pd.notna(b.pf) else np.nan, "2025H1_avg_R": float(b.avg_R) if pd.notna(b.avg_R) else np.nan})
        symbol_frame = pd.DataFrame(candidates)
        eligible_count = int(symbol_frame.eligible.sum())
        symbol_frame["eligible_count_for_symbol"] = eligible_count
        selection_rows += symbol_frame.to_dict(orient="records")
        if eligible_count >= 2:
            best = symbol_frame[symbol_frame.eligible].sort_values(["score", "2025H1_avg_R"], ascending=False).iloc[0]
            route_rows.append({"symbol": symbol, "config": str(best.config), "slot": str(best.slot), "mode": str(best.mode), "dev_score": float(best.score), "eligible_config_count": eligible_count})
    selection = pd.DataFrame(selection_rows)
    selection.to_csv(args.output / "ROUTE_SELECTION_BEFORE_TEST.csv", index=False)
    routes = pd.DataFrame(route_rows)
    routes.to_csv(args.output / "SELECTED_ROUTES.csv", index=False)

    fixed_parts: list[pd.DataFrame] = []
    result_rows: list[dict[str, object]] = []
    for route in route_rows:
        for period in PERIODS:
            trades = trade_store[(str(route["config"]), period)]
            part = trades[trades.symbol == route["symbol"]].copy() if len(trades) else pd.DataFrame()
            result_rows.append({"symbol": route["symbol"], "config": route["config"], "slot": route["slot"], "mode": route["mode"], "dev_score": route["dev_score"], "eligible_config_count": route["eligible_config_count"], "period": period, **coin_metrics(part)})
            if period in {"2025H2", "2026H1"} and len(part):
                part["period"] = period
                part["dev_score"] = route["dev_score"]
                part["selected_config"] = route["config"]
                fixed_parts.append(part)
    results = pd.DataFrame(result_rows)
    results.to_csv(args.output / "SELECTED_ROUTE_RESULTS.csv", index=False)
    if len(results):
        pivot = results[results.period.isin(["2025H2", "2026H1"])].pivot_table(index=["symbol", "config"], columns="period", values=["trades", "avg_bps", "pf", "avg_R"], aggfunc="first")
        pivot.columns = [f"{metric}_{period}" for metric, period in pivot.columns]
        pivot = pivot.reset_index()
        for column in ["trades_2025H2", "trades_2026H1", "avg_bps_2025H2", "avg_bps_2026H1", "pf_2025H2", "pf_2026H1", "avg_R_2025H2", "avg_R_2026H1"]:
            if column not in pivot:
                pivot[column] = np.nan
        pivot["passes_fixed_late_gate"] = (pivot.trades_2025H2 >= 4) & (pivot.trades_2026H1 >= 4) & (pivot.avg_bps_2025H2 > 0) & (pivot.avg_bps_2026H1 > 0) & (pivot.pf_2025H2 >= 1.10) & (pivot.pf_2026H1 >= 1.10) & (pivot.avg_R_2025H2 > 0) & (pivot.avg_R_2026H1 > 0)
        pivot.to_csv(args.output / "FIXED_LATE_DECISIONS.csv", index=False)
    portfolio = pd.concat(fixed_parts, ignore_index=True) if fixed_parts else pd.DataFrame()
    portfolio.to_csv(args.output / "SELECTED_ROUTE_TRADES_LATE.csv", index=False)

    account_rows: list[dict[str, object]] = []
    for label, bounds in {"2025H2": PERIODS["2025H2"], "2026H1": PERIODS["2026H1"], "FIXED_LATE_12M": (engine.CUT2, engine.END)}.items():
        for risk in [0.25, 0.5, 1.0, 2.0, 3.0]:
            account_rows.append({"period": label, **account(portfolio, risk, *bounds)})
    accounts = pd.DataFrame(account_rows)
    accounts.to_csv(args.output / "ACCOUNT_SCENARIOS.csv", index=False)

    summary = {"generated_at": datetime.now(UTC).isoformat(), "configs": len(engine.CONFIGS), "symbols": len(frames), "selected_routes_before_test": route_rows, "selected_route_results": result_rows, "accounts": account_rows}
    decision_path = args.output / "FIXED_LATE_DECISIONS.csv"
    if decision_path.exists():
        decisions = pd.read_csv(decision_path)
        summary["fixed_late_pass_count"] = int(decisions.passes_fixed_late_gate.sum())
        summary["fixed_late_pass_symbols"] = decisions.loc[decisions.passes_fixed_late_gate, "symbol"].tolist()
    (args.output / "SUMMARY.json").write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    report = "# Round 56 — coin-specific US-open\n\nRoutes are selected only on 2024 and 2025H1. 2025H2 and 2026H1 are fixed tests.\n\n## Selected routes\n\n" + (routes.to_markdown(index=False) if len(routes) else "No robust routes selected.") + "\n\n## Fixed late decisions\n\n" + (pd.read_csv(decision_path).to_markdown(index=False) if decision_path.exists() else "No decisions.") + "\n\n## Accounts\n\n" + accounts.to_markdown(index=False, floatfmt=".3f") + "\n"
    (args.output / "REPORT_RU.md").write_text(report, encoding="utf-8")
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
