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
THRESHOLDS = [2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0]

base.SYMBOLS = SYMBOLS
base.WARMUP_START = WARMUP_START
base.START = START
base.CUT = CUT1
base.PRE_JULY_END = PRE_JULY_END
base.JULY_END = END
base.BASE_COST = 12.0
base.STRESS_COST = COST
CFG = next(cfg for cfg in base.CONFIGS if cfg.name == "FLOW_OI_STRICT60")

PERIODS = {
    "2024": (START, CUT1),
    "2025H1": (CUT1, CUT2),
    "2025H2": (CUT2, CUT3),
    "2026H1": (CUT3, PRE_JULY_END),
    "JULY2026": (PRE_JULY_END, END),
}


def metrics(frame: pd.DataFrame) -> dict[str, float | int]:
    if frame.empty:
        return {"trades": 0, "avg_bps": np.nan, "pf": np.nan, "win_rate": np.nan, "avg_R": np.nan, "total_R": 0.0, "best_R": np.nan, "worst_R": np.nan}
    net = frame.gross_bps.to_numpy(float) - COST
    risk = frame.stop_distance_bps.to_numpy(float) + COST
    r = net / risk
    gains = net[net > 0].sum()
    losses = -net[net < 0].sum()
    return {
        "trades": int(len(frame)),
        "avg_bps": float(net.mean()),
        "pf": float(gains / losses) if losses else float("inf"),
        "win_rate": float(np.mean(net > 0)),
        "avg_R": float(r.mean()),
        "total_R": float(r.sum()),
        "best_R": float(r.max()),
        "worst_R": float(r.min()),
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
            notional = min(equity * (risk_pct / 100.0) / stop_fraction, equity * 2.0)
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
    parser.add_argument("--workers", type=int, default=40)
    args = parser.parse_args()
    output = Path(args.output)
    cache = Path(args.cache)
    output.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)

    manifest = base.download_all(cache, args.workers)
    pd.DataFrame(manifest).to_csv(output / "SOURCE_MANIFEST.csv", index=False)

    all_trades: list[dict[str, object]] = []
    coverage: list[dict[str, object]] = []
    for symbol in SYMBOLS:
        kline = base.load_concat(symbol, manifest, {"kline_monthly", "kline_daily"}, base.read_kline)
        premium = base.load_concat(symbol, manifest, {"premium_monthly", "premium_daily"}, base.read_kline)
        positioning = base.load_concat(symbol, manifest, {"metrics_daily"}, base.read_metrics)
        funding = base.load_funding(symbol, manifest)
        coverage.append({"symbol": symbol, "kline_rows": len(kline), "premium_rows": len(premium), "metric_rows": len(positioning), "funding_events": len(funding), "first": None if kline.empty else kline.open_time.iloc[0], "last": None if kline.empty else kline.open_time.iloc[-1]})
        if kline.empty or premium.empty or positioning.empty:
            continue
        feature = base.build_features(kline, premium, positioning)
        all_trades += base.simulate(symbol, feature, funding, CFG, START, END)
        print(symbol, len(all_trades), flush=True)

    pd.DataFrame(coverage).to_csv(output / "COVERAGE.csv", index=False)
    trades = pd.DataFrame(all_trades)
    trades.to_csv(output / "RAW_ALL_TRADES.csv", index=False)
    if trades.empty:
        raise RuntimeError("no trades")
    trades["entry_time"] = pd.to_datetime(trades.entry_time, utc=True)
    trades["exit_time"] = pd.to_datetime(trades.exit_time, utc=True)

    threshold_rows: list[dict[str, object]] = []
    route_rows: list[dict[str, object]] = []
    for symbol, group in trades.groupby("symbol"):
        symbol_thresholds: list[dict[str, object]] = []
        for threshold in THRESHOLDS:
            row: dict[str, object] = {"symbol": symbol, "strength_threshold": threshold}
            for period, (start, end) in PERIODS.items():
                part = group[(group.entry_time >= start) & (group.entry_time < end) & (group.strength >= threshold)]
                row |= {f"{period}_{key}": value for key, value in metrics(part).items()}
            eligible = row["2024_trades"] >= 6 and row["2025H1_trades"] >= 3 and row["2024_avg_R"] > 0 and row["2025H1_avg_R"] > 0 and row["2024_pf"] >= 1.10 and row["2025H1_pf"] >= 1.10
            score = min(row["2024_avg_R"], row["2025H1_avg_R"]) * math.sqrt(min(row["2024_trades"], row["2025H1_trades"]) / 3) * min(row["2024_pf"], row["2025H1_pf"], 3) if eligible else -1e9
            row["eligible_early"] = bool(eligible)
            row["score"] = float(score)
            symbol_thresholds.append(row)
        symbol_frame = pd.DataFrame(symbol_thresholds).sort_values("strength_threshold")
        eligible_values = set(symbol_frame.loc[symbol_frame.eligible_early, "strength_threshold"].astype(float))
        symbol_frame["eligible_neighbor_count"] = symbol_frame.strength_threshold.apply(lambda t: sum(abs(float(t) - other) <= 0.5000001 for other in eligible_values))
        threshold_rows += symbol_frame.to_dict(orient="records")
        robust = symbol_frame[(symbol_frame.eligible_early) & (symbol_frame.eligible_neighbor_count >= 2)]
        if not robust.empty:
            best = robust.sort_values(["score", "2025H1_avg_R"], ascending=False).iloc[0]
            route_rows.append({"symbol": symbol, "strength_threshold": float(best.strength_threshold), "dev_score": float(best.score), "eligible_neighbor_count": int(best.eligible_neighbor_count)})

    threshold_grid = pd.DataFrame(threshold_rows)
    threshold_grid.to_csv(output / "THRESHOLD_SELECTION_BEFORE_TEST.csv", index=False)
    routes = pd.DataFrame(route_rows)
    routes.to_csv(output / "SELECTED_ROUTES_BEFORE_TEST.csv", index=False)

    selected_parts: list[pd.DataFrame] = []
    decision_rows: list[dict[str, object]] = []
    for route in route_rows:
        symbol = str(route["symbol"])
        threshold = float(route["strength_threshold"])
        group = trades[(trades.symbol == symbol) & (trades.strength >= threshold)].copy()
        for period, (start, end) in PERIODS.items():
            part = group[(group.entry_time >= start) & (group.entry_time < end)].copy()
            decision_rows.append({"symbol": symbol, "strength_threshold": threshold, "dev_score": route["dev_score"], "eligible_neighbor_count": route["eligible_neighbor_count"], "period": period, **metrics(part)})
            if period in {"2025H2", "2026H1", "JULY2026"} and not part.empty:
                part["period"] = period
                part["dev_score"] = route["dev_score"]
                part["selected_strength_threshold"] = threshold
                selected_parts.append(part)
    decisions = pd.DataFrame(decision_rows)
    decisions.to_csv(output / "SELECTED_ROUTE_PERIOD_RESULTS.csv", index=False)
    if not decisions.empty:
        pivot = decisions[decisions.period.isin(["2025H2", "2026H1"])].pivot_table(index=["symbol", "strength_threshold"], columns="period", values=["trades", "avg_bps", "pf", "avg_R"], aggfunc="first")
        pivot.columns = [f"{metric}_{period}" for metric, period in pivot.columns]
        pivot = pivot.reset_index()
        for col in ["trades_2025H2", "trades_2026H1", "avg_bps_2025H2", "avg_bps_2026H1", "pf_2025H2", "pf_2026H1", "avg_R_2025H2", "avg_R_2026H1"]:
            if col not in pivot:
                pivot[col] = np.nan
        pivot["passes_fixed_late_gate"] = (pivot.trades_2025H2 >= 5) & (pivot.trades_2026H1 >= 5) & (pivot.avg_R_2025H2 > 0) & (pivot.avg_R_2026H1 > 0) & (pivot.pf_2025H2 >= 1.10) & (pivot.pf_2026H1 >= 1.10)
        pivot.to_csv(output / "FIXED_LATE_ROUTE_DECISIONS.csv", index=False)
    portfolio = pd.concat(selected_parts, ignore_index=True) if selected_parts else pd.DataFrame()
    portfolio.to_csv(output / "SELECTED_ROUTE_TRADES_LATE.csv", index=False)

    account_rows: list[dict[str, object]] = []
    for label, bounds in {"2025H2": PERIODS["2025H2"], "2026H1": PERIODS["2026H1"], "FIXED_LATE_12M": (CUT2, PRE_JULY_END), "JULY2026": PERIODS["JULY2026"]}.items():
        for risk in [0.25, 0.5, 1.0, 2.0, 3.0, 5.0]:
            account_rows.append({"period": label, **account(portfolio, risk, *bounds)})
    accounts = pd.DataFrame(account_rows)
    accounts.to_csv(output / "ACCOUNT_SCENARIOS.csv", index=False)

    summary = {"generated_at": datetime.now(UTC).isoformat(), "fixed_config": CFG.__dict__, "symbols_requested": SYMBOLS, "coverage": coverage, "selected_routes_before_test": route_rows, "selected_route_results": decision_rows, "accounts": account_rows}
    decision_path = output / "FIXED_LATE_ROUTE_DECISIONS.csv"
    if decision_path.exists():
        fixed = pd.read_csv(decision_path)
        summary["fixed_late_pass_count"] = int(fixed.passes_fixed_late_gate.sum())
        summary["fixed_late_pass_symbols"] = fixed.loc[fixed.passes_fixed_late_gate, "symbol"].tolist()
    (output / "SUMMARY.json").write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    report = "# Round 55 — full-history coin-specific OI Flush\n\nFixed FLOW_OI_STRICT60. Strength threshold for each coin is selected only on 2024 and 2025H1 with neighboring-threshold robustness. 2025H2, 2026H1 and July 2026 are untouched tests.\n\n## Routes before test\n\n" + (routes.to_markdown(index=False) if len(routes) else "No robust routes selected.") + "\n\n## Fixed late decisions\n\n" + (pd.read_csv(decision_path).to_markdown(index=False) if decision_path.exists() else "No decisions.") + "\n\n## Accounts\n\n" + accounts.to_markdown(index=False, floatfmt=".3f") + "\n"
    (output / "REPORT_RU.md").write_text(report, encoding="utf-8")
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
