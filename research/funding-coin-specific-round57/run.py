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

SYMBOLS = list(premium_config.SYMBOLS)
WARMUP_START = pd.Timestamp("2023-12-01", tz="UTC")
START = pd.Timestamp("2024-01-01", tz="UTC")
CUT1 = pd.Timestamp("2025-01-01", tz="UTC")
CUT2 = pd.Timestamp("2025-07-01", tz="UTC")
CUT3 = pd.Timestamp("2026-01-01", tz="UTC")
END = pd.Timestamp("2026-07-01", tz="UTC")
COST_BPS = 20.0

for module in (data_mod,):
    module.WARMUP_START = WARMUP_START
    module.PRE_JULY_END = END
    module.JULY_END = END
base.SYMBOLS = SYMBOLS
base.START = START
base.CUT = CUT1
base.PRE_JULY_END = END
base.JULY_END = END
base.COST_BPS = COST_BPS


@dataclass(frozen=True)
class Config:
    name: str
    side: int
    threshold_bps: float
    persistence: bool


CONFIGS = [
    Config(
        f"{'SHORT_POS' if side == -1 else 'LONG_NEG'}_T{str(threshold).replace('.', 'p')}_{'PERSIST' if persistence else 'RAW'}",
        side,
        threshold,
        persistence,
    )
    for side in (-1, 1)
    for threshold in (0.25, 0.50, 1.0, 2.0, 3.0, 5.0, 10.0)
    for persistence in (False, True)
]

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


def simulate_symbol(symbol: str, price: pd.DataFrame, funding: pd.DataFrame, config: Config, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    f = funding.sort_values("funding_time").copy()
    f["rate_bps"] = f.funding_rate * 1e4
    f["previous_bps"] = f.rate_bps.shift(1)
    subset = f[(f.funding_time >= start) & (f.funding_time < end)].copy()
    if config.side == -1:
        subset = subset[subset.rate_bps >= config.threshold_bps]
    else:
        subset = subset[subset.rate_bps <= -config.threshold_bps]
    if config.persistence:
        subset = subset[np.sign(subset.rate_bps) == np.sign(subset.previous_bps)]
    for _, event in subset.iterrows():
        event_time = pd.Timestamp(event.funding_time)
        entry_time = event_time + pd.Timedelta(minutes=15)
        exit_time = event_time + pd.Timedelta(hours=8, minutes=15)
        if exit_time >= end or entry_time.date() != exit_time.date():
            continue
        entry_price = base.price_at(price, entry_time)
        exit_price = base.price_at(price, exit_time)
        if entry_price is None or exit_price is None or entry_price <= 0:
            continue
        side = config.side
        price_bps = side * (exit_price / entry_price - 1) * 1e4
        next_funding_bps = base.actual_funding(funding, entry_time, exit_time, side)
        net_bps = price_bps + next_funding_bps - COST_BPS
        rows.append({
            "symbol": symbol,
            "config": config.name,
            "side": side,
            "threshold_bps": config.threshold_bps,
            "persistence": config.persistence,
            "event_time": event_time,
            "entry_time": entry_time,
            "exit_time": exit_time,
            "signal_funding_bps": float(event.rate_bps),
            "next_funding_bps": float(next_funding_bps),
            "price_bps": float(price_bps),
            "net20_bps": float(net_bps),
        })
    return pd.DataFrame(rows)


def metrics(frame: pd.DataFrame) -> dict[str, float | int]:
    if frame.empty:
        return {"trades": 0, "avg_bps": np.nan, "pf": np.nan, "win_rate": np.nan, "funding_avg_bps": np.nan, "price_avg_bps": np.nan}
    values = frame.net20_bps.to_numpy(float)
    gains = values[values > 0].sum()
    losses = -values[values < 0].sum()
    return {
        "trades": int(len(frame)),
        "avg_bps": float(values.mean()),
        "pf": float(gains / losses) if losses else float("inf"),
        "win_rate": float(np.mean(values > 0)),
        "funding_avg_bps": float(frame.next_funding_bps.mean()),
        "price_avg_bps": float(frame.price_bps.mean()),
    }


def account(frame: pd.DataFrame, fraction_per_position: float, start: pd.Timestamp, end: pd.Timestamp, initial: float = 10_000.0, max_positions: int = 5, gross_cap_x: float = 3.0) -> dict[str, float | int]:
    data = frame[(pd.to_datetime(frame.entry_time, utc=True) >= start) & (pd.to_datetime(frame.entry_time, utc=True) < end)].sort_values(["entry_time", "dev_score", "signal_funding_bps"], ascending=[True, False, False]).reset_index(drop=True)
    equity = initial
    open_positions: dict[int, dict[str, float | str]] = {}
    curve: list[float] = []
    accepted = 0
    for timestamp in sorted(set(data.entry_time) | set(data.exit_time)) if len(data) else []:
        for index, position in list(open_positions.items()):
            row = data.iloc[index]
            if row.exit_time == timestamp and row.entry_time < timestamp:
                equity *= max(0.0, 1 + float(position["fraction"]) * float(row.net20_bps) / 1e4)
                del open_positions[index]
                accepted += 1
        for index in data.index[data.entry_time == timestamp]:
            row = data.iloc[index]
            if len(open_positions) >= max_positions or any(str(position["symbol"]) == row.symbol for position in open_positions.values()):
                continue
            used = sum(float(position["fraction"]) for position in open_positions.values())
            fraction = min(fraction_per_position, max(0.0, gross_cap_x - used))
            if fraction > 0:
                open_positions[index] = {"symbol": row.symbol, "fraction": fraction}
        for index, position in list(open_positions.items()):
            row = data.iloc[index]
            if row.exit_time == timestamp and row.entry_time == timestamp:
                equity *= max(0.0, 1 + float(position["fraction"]) * float(row.net20_bps) / 1e4)
                del open_positions[index]
                accepted += 1
        curve.append(equity)
    values = np.asarray(curve, dtype=float) if curve else np.asarray([initial])
    drawdown = 1 - values / np.maximum.accumulate(values)
    years = max((end - start).days / 365.25, 1 / 365.25)
    return {
        "fraction_per_position": fraction_per_position,
        "gross_cap_x": gross_cap_x,
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
    parser.add_argument("--workers", type=int, default=24)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    args.cache.mkdir(parents=True, exist_ok=True)

    manifest = data_mod.download_all(SYMBOLS, args.cache, args.workers)
    pd.DataFrame(manifest).to_csv(args.output / "SOURCE_MANIFEST.csv", index=False)
    prices: dict[str, pd.DataFrame] = {}
    funding: dict[str, pd.DataFrame] = {}
    coverage: list[dict[str, object]] = []
    for symbol in SYMBOLS:
        price = data_mod.load_series(symbol, manifest, premium=False)
        rate = load_monthly_funding(symbol, manifest)
        coverage.append({"symbol": symbol, "price_rows": len(price), "funding_events": len(rate), "first_price": None if price.empty else price.open_time.iloc[0], "last_price": None if price.empty else price.open_time.iloc[-1], "first_funding": None if rate.empty else rate.funding_time.iloc[0], "last_funding": None if rate.empty else rate.funding_time.iloc[-1]})
        if len(price) and len(rate):
            prices[symbol] = price
            funding[symbol] = rate
    pd.DataFrame(coverage).to_csv(args.output / "COVERAGE.csv", index=False)

    stores: dict[tuple[str, str, str], pd.DataFrame] = {}
    metric_rows: list[dict[str, object]] = []
    for config in CONFIGS:
        for symbol in prices:
            for period, bounds in PERIODS.items():
                trades = simulate_symbol(symbol, prices[symbol], funding[symbol], config, *bounds)
                stores[(config.name, symbol, period)] = trades
                metric_rows.append({"symbol": symbol, "config": config.name, **asdict(config), "period": period, **metrics(trades)})
    grid = pd.DataFrame(metric_rows)
    grid.to_csv(args.output / "COIN_CONFIG_PERIOD_METRICS.csv", index=False)

    selection_rows: list[dict[str, object]] = []
    routes: list[dict[str, object]] = []
    for symbol in prices:
        candidates: list[dict[str, object]] = []
        for config in CONFIGS:
            a = grid[(grid.symbol == symbol) & (grid.config == config.name) & (grid.period == "2024")].iloc[0]
            b = grid[(grid.symbol == symbol) & (grid.config == config.name) & (grid.period == "2025H1")].iloc[0]
            eligible = a.trades >= 12 and b.trades >= 6 and a.avg_bps > 0 and b.avg_bps > 0 and a.pf >= 1.15 and b.pf >= 1.15
            score = min(a.avg_bps, b.avg_bps) * math.sqrt(min(a.trades, b.trades) / 6) * min(a.pf, b.pf, 3) if eligible else -1e9
            candidates.append({"symbol": symbol, "config": config.name, **asdict(config), "eligible": bool(eligible), "score": float(score), "2024_trades": int(a.trades), "2024_avg_bps": float(a.avg_bps) if pd.notna(a.avg_bps) else np.nan, "2024_pf": float(a.pf) if pd.notna(a.pf) else np.nan, "2025H1_trades": int(b.trades), "2025H1_avg_bps": float(b.avg_bps) if pd.notna(b.avg_bps) else np.nan, "2025H1_pf": float(b.pf) if pd.notna(b.pf) else np.nan})
        symbol_frame = pd.DataFrame(candidates)
        eligible_count = int(symbol_frame.eligible.sum())
        symbol_frame["eligible_count_for_symbol"] = eligible_count
        selection_rows += symbol_frame.to_dict(orient="records")
        if eligible_count >= 2:
            best = symbol_frame[symbol_frame.eligible].sort_values(["score", "2025H1_avg_bps"], ascending=False).iloc[0]
            routes.append({"symbol": symbol, "config": str(best.config), "side": int(best.side), "threshold_bps": float(best.threshold_bps), "persistence": bool(best.persistence), "dev_score": float(best.score), "eligible_config_count": eligible_count})
    selection = pd.DataFrame(selection_rows)
    selection.to_csv(args.output / "ROUTE_SELECTION_BEFORE_TEST.csv", index=False)
    route_frame = pd.DataFrame(routes)
    route_frame.to_csv(args.output / "SELECTED_ROUTES.csv", index=False)

    result_rows: list[dict[str, object]] = []
    fixed_parts: list[pd.DataFrame] = []
    for route in routes:
        for period in PERIODS:
            trades = stores[(str(route["config"]), str(route["symbol"]), period)].copy()
            result_rows.append({**route, "period": period, **metrics(trades)})
            if period in {"2025H2", "2026H1"} and len(trades):
                trades["period"] = period
                trades["dev_score"] = route["dev_score"]
                fixed_parts.append(trades)
    results = pd.DataFrame(result_rows)
    results.to_csv(args.output / "SELECTED_ROUTE_RESULTS.csv", index=False)
    if len(results):
        pivot = results[results.period.isin(["2025H2", "2026H1"])].pivot_table(index=["symbol", "config"], columns="period", values=["trades", "avg_bps", "pf"], aggfunc="first")
        pivot.columns = [f"{metric}_{period}" for metric, period in pivot.columns]
        pivot = pivot.reset_index()
        for column in ["trades_2025H2", "trades_2026H1", "avg_bps_2025H2", "avg_bps_2026H1", "pf_2025H2", "pf_2026H1"]:
            if column not in pivot:
                pivot[column] = np.nan
        pivot["passes_fixed_late_gate"] = (pivot.trades_2025H2 >= 6) & (pivot.trades_2026H1 >= 6) & (pivot.avg_bps_2025H2 > 0) & (pivot.avg_bps_2026H1 > 0) & (pivot.pf_2025H2 >= 1.10) & (pivot.pf_2026H1 >= 1.10)
        pivot.to_csv(args.output / "FIXED_LATE_DECISIONS.csv", index=False)
    portfolio = pd.concat(fixed_parts, ignore_index=True) if fixed_parts else pd.DataFrame()
    portfolio.to_csv(args.output / "SELECTED_ROUTE_TRADES_LATE.csv", index=False)

    account_rows: list[dict[str, object]] = []
    for label, bounds in {"2025H2": PERIODS["2025H2"], "2026H1": PERIODS["2026H1"], "FIXED_LATE_12M": (CUT2, END)}.items():
        for fraction in (0.05, 0.10, 0.20, 0.33, 0.50, 1.00):
            account_rows.append({"period": label, **account(portfolio, fraction, *bounds)})
    accounts = pd.DataFrame(account_rows)
    accounts.to_csv(args.output / "ACCOUNT_SCENARIOS.csv", index=False)

    summary = {"generated_at": datetime.now(UTC).isoformat(), "symbols": len(prices), "configs_per_symbol": len(CONFIGS), "selected_routes_before_test": routes, "selected_route_results": result_rows, "accounts": account_rows}
    decision_path = args.output / "FIXED_LATE_DECISIONS.csv"
    if decision_path.exists():
        decisions = pd.read_csv(decision_path)
        summary["fixed_late_pass_count"] = int(decisions.passes_fixed_late_gate.sum())
        summary["fixed_late_pass_symbols"] = decisions.loc[decisions.passes_fixed_late_gate, "symbol"].tolist()
    (args.output / "SUMMARY.json").write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    report = "# Round 57 — coin-specific post-funding drift\n\nEach coin route is selected only on 2024 and 2025H1, then tested unchanged on 2025H2 and 2026H1.\n\n## Routes before test\n\n" + (route_frame.to_markdown(index=False) if len(route_frame) else "No robust routes selected.") + "\n\n## Fixed late decisions\n\n" + (pd.read_csv(decision_path).to_markdown(index=False) if decision_path.exists() else "No decisions.") + "\n\n## Accounts\n\n" + accounts.to_markdown(index=False, floatfmt=".3f") + "\n"
    (args.output / "REPORT_RU.md").write_text(report, encoding="utf-8")
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
