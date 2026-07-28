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
BASE_PATH = HERE.parents[1] / "altcoin-round45-breakout-resolution" / "run.py"
spec = importlib.util.spec_from_file_location("round45_base", BASE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("cannot load round45 base")
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)

SYMBOLS = base.SYMBOLS
CONFIGS = base.CONFIGS
START = base.START
CUT1 = base.CUT1
CUT2 = base.CUT2
CUT3 = base.CUT3
PRE_JULY_END = base.PRE_JULY_END
END = base.END
COST = base.STRESS_COST

PERIODS = {
    "2024": (START, CUT1),
    "2025H1": (CUT1, CUT2),
    "2025H2": (CUT2, CUT3),
    "2026H1": (CUT3, PRE_JULY_END),
    "JULY2026": (PRE_JULY_END, END),
}


def metrics(frame: pd.DataFrame) -> dict[str, float | int]:
    if frame.empty:
        return {"trades": 0, "avg_bps": np.nan, "pf": np.nan, "win_rate": np.nan, "avg_R": np.nan, "total_R": 0.0}
    values = frame.gross_bps.to_numpy(float) - COST
    risk = frame.stop_distance_bps.to_numpy(float) + COST
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


def account(frame: pd.DataFrame, risk_pct: float, start: pd.Timestamp, end: pd.Timestamp, initial: float = 10_000.0, max_positions: int = 6, gross_cap_x: float = 6.0) -> dict[str, float | int]:
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
                equity += float(position["notional"]) * (float(row.gross_bps) - COST) / 1e4
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
                equity += float(position["notional"]) * (float(row.gross_bps) - COST) / 1e4
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
    parser.add_argument("--output", required=True)
    parser.add_argument("--cache", required=True)
    parser.add_argument("--workers", type=int, default=32)
    args = parser.parse_args()
    output = Path(args.output)
    cache = Path(args.cache)
    output.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)

    manifest = base.base.download_all(cache, args.workers)
    pd.DataFrame(manifest).to_csv(output / "SOURCE_MANIFEST.csv", index=False)

    features: dict[str, pd.DataFrame] = {}
    funding: dict[str, pd.DatetimeIndex] = {}
    coverage: list[dict[str, object]] = []
    for symbol in SYMBOLS:
        raw = base.base.load_klines(symbol, manifest)
        events = base.base.load_funding(symbol, manifest)
        coverage.append({"symbol": symbol, "rows": len(raw), "first": None if raw.empty else raw.open_time.iloc[0], "last": None if raw.empty else raw.open_time.iloc[-1], "funding_events": len(events)})
        if not raw.empty:
            features[symbol] = base.base.build_features(raw)
            funding[symbol] = events
    pd.DataFrame(coverage).to_csv(output / "COVERAGE.csv", index=False)

    trade_store: dict[tuple[str, str, str], pd.DataFrame] = {}
    metric_rows: list[dict[str, object]] = []
    total_jobs = len(CONFIGS) * len(features)
    done = 0
    for cfg in CONFIGS:
        for symbol, feature in features.items():
            for period, bounds in PERIODS.items():
                trades = pd.DataFrame(base.simulate(symbol, feature, funding[symbol], cfg, *bounds))
                trade_store[(cfg.name, symbol, period)] = trades
                metric_rows.append({"config": cfg.name, "family": cfg.family, "lookback": cfg.lookback, "volume_z": cfg.volume_z, "confirm_bars": cfg.confirm_bars, "hold": cfg.hold, "stop_atr": cfg.stop_atr, "symbol": symbol, "period": period, **metrics(trades)})
            done += 1
            if done % 200 == 0:
                print(f"symbol-config jobs {done}/{total_jobs}", flush=True)
    grid = pd.DataFrame(metric_rows)
    grid.to_csv(output / "COIN_CONFIG_PERIOD_METRICS.csv", index=False)

    selection_rows: list[dict[str, object]] = []
    selected_routes: list[dict[str, object]] = []
    for symbol in sorted(features):
        symbol_rows: list[dict[str, object]] = []
        for cfg in CONFIGS:
            a = grid[(grid.config == cfg.name) & (grid.symbol == symbol) & (grid.period == "2024")].iloc[0]
            b = grid[(grid.config == cfg.name) & (grid.symbol == symbol) & (grid.period == "2025H1")].iloc[0]
            eligible = a.trades >= 20 and b.trades >= 10 and a.avg_bps > 0 and b.avg_bps > 0 and a.pf >= 1.15 and b.pf >= 1.15 and a.avg_R > 0 and b.avg_R > 0
            score = min(a.avg_R, b.avg_R) * math.sqrt(min(a.trades, b.trades) / 10) * min(a.pf, b.pf, 3) if eligible else -1e9
            symbol_rows.append({"symbol": symbol, "config": cfg.name, "family": cfg.family, "eligible": bool(eligible), "score": float(score), "trades_2024": int(a.trades), "avg_bps_2024": float(a.avg_bps) if pd.notna(a.avg_bps) else np.nan, "pf_2024": float(a.pf) if pd.notna(a.pf) else np.nan, "avg_R_2024": float(a.avg_R) if pd.notna(a.avg_R) else np.nan, "trades_2025H1": int(b.trades), "avg_bps_2025H1": float(b.avg_bps) if pd.notna(b.avg_bps) else np.nan, "pf_2025H1": float(b.pf) if pd.notna(b.pf) else np.nan, "avg_R_2025H1": float(b.avg_R) if pd.notna(b.avg_R) else np.nan})
        symbol_frame = pd.DataFrame(symbol_rows)
        eligible_count = int(symbol_frame.eligible.sum())
        symbol_frame["eligible_count_for_symbol"] = eligible_count
        selection_rows.extend(symbol_frame.to_dict(orient="records"))
        if eligible_count >= 3:
            best = symbol_frame[symbol_frame.eligible].sort_values(["score", "avg_R_2025H1"], ascending=False).iloc[0]
            selected_routes.append({"symbol": symbol, "config": str(best.config), "family": str(best.family), "dev_score": float(best.score), "eligible_neighbor_count": eligible_count})
    selection = pd.DataFrame(selection_rows)
    selection.to_csv(output / "ROUTE_SELECTION_BEFORE_2025H2.csv", index=False)
    routes = pd.DataFrame(selected_routes)
    routes.to_csv(output / "SELECTED_ROUTES.csv", index=False)

    route_results: list[dict[str, object]] = []
    portfolio_parts: list[pd.DataFrame] = []
    for route in selected_routes:
        symbol = str(route["symbol"])
        config = str(route["config"])
        for period in PERIODS:
            trades = trade_store[(config, symbol, period)].copy()
            route_results.append({"symbol": symbol, "config": config, "family": route["family"], "dev_score": route["dev_score"], "eligible_neighbor_count": route["eligible_neighbor_count"], "period": period, **metrics(trades)})
            if period in {"2025H2", "2026H1", "JULY2026"} and not trades.empty:
                trades["period"] = period
                trades["dev_score"] = route["dev_score"]
                trades["selected_config"] = config
                portfolio_parts.append(trades)
    route_results_frame = pd.DataFrame(route_results)
    if not route_results_frame.empty:
        late = route_results_frame[route_results_frame.period.isin(["2025H2", "2026H1"])]
        pass_table = late.pivot_table(index=["symbol", "config"], columns="period", values=["trades", "avg_bps", "pf"], aggfunc="first")
        pass_table.columns = [f"{metric}_{period}" for metric, period in pass_table.columns]
        pass_table = pass_table.reset_index()
        for column in ["trades_2025H2", "trades_2026H1", "avg_bps_2025H2", "avg_bps_2026H1", "pf_2025H2", "pf_2026H1"]:
            if column not in pass_table:
                pass_table[column] = np.nan
        pass_table["passes_late_gate"] = (pass_table.trades_2025H2 >= 10) & (pass_table.trades_2026H1 >= 10) & (pass_table.avg_bps_2025H2 > 0) & (pass_table.avg_bps_2026H1 > 0) & (pass_table.pf_2025H2 >= 1.10) & (pass_table.pf_2026H1 >= 1.10)
        pass_table.to_csv(output / "LATE_ROUTE_DECISIONS.csv", index=False)
    route_results_frame.to_csv(output / "SELECTED_ROUTE_RESULTS.csv", index=False)

    portfolio = pd.concat(portfolio_parts, ignore_index=True) if portfolio_parts else pd.DataFrame()
    portfolio.to_csv(output / "SELECTED_ROUTE_TRADES_LATE.csv", index=False)
    account_rows: list[dict[str, object]] = []
    for period, bounds in {"2025H2": PERIODS["2025H2"], "2026H1": PERIODS["2026H1"], "LATE_12M": (CUT2, PRE_JULY_END), "JULY2026": PERIODS["JULY2026"]}.items():
        for risk in [0.25, 0.5, 1.0, 2.0, 3.0]:
            account_rows.append({"period": period, **account(portfolio, risk, *bounds)})
    accounts = pd.DataFrame(account_rows)
    accounts.to_csv(output / "ACCOUNT_SCENARIOS.csv", index=False)

    summary = {"generated_at": datetime.now(UTC).isoformat(), "symbols": len(features), "configs": len(CONFIGS), "selected_routes_before_test": int(len(routes)), "selected_routes": selected_routes, "late_route_results": route_results, "accounts": account_rows}
    if (output / "LATE_ROUTE_DECISIONS.csv").exists():
        decisions = pd.read_csv(output / "LATE_ROUTE_DECISIONS.csv")
        summary["late_gate_passes"] = int(decisions.passes_late_gate.sum())
        summary["late_gate_symbols"] = decisions.loc[decisions.passes_late_gate, "symbol"].tolist()
    (output / "SUMMARY.json").write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    report = "# Round 54 — coin-specific breakout resolution\n\nEach coin route is selected only on 2024 and 2025H1. 2025H2, 2026H1 and July 2026 are never used in route selection.\n\n## Selected routes before test\n\n" + (routes.to_markdown(index=False) if len(routes) else "No routes selected.") + "\n\n## Late decisions\n\n" + ((pd.read_csv(output / "LATE_ROUTE_DECISIONS.csv").to_markdown(index=False)) if (output / "LATE_ROUTE_DECISIONS.csv").exists() else "No late decisions.") + "\n\n## Account scenarios\n\n" + accounts.to_markdown(index=False, floatfmt=".3f") + "\n"
    (output / "REPORT_RU.md").write_text(report, encoding="utf-8")
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
