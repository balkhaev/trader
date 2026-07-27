from __future__ import annotations

import argparse
import json
import math
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

from config import (
    BASE_COST_BPS,
    CUT,
    JULY_END,
    PRE_JULY_END,
    START,
    STRESS_COST_BPS,
    SYMBOLS,
)
from data import download_all, load_funding, load_klines, load_metrics
from strategy import (
    CONFIGS,
    build_features,
    metrics,
    select_portfolio_events,
    simulate_symbol,
)


def breadth(data: pd.DataFrame, minimum: int = 5) -> dict[str, float | int]:
    if data.empty:
        return {"eligible_symbols": 0, "positive_symbols": 0, "breadth": 0.0}
    rows = []
    for symbol, group in data.groupby("symbol"):
        if len(group) >= minimum:
            rows.append(float(group.net_bps.mean()) > 0)
    return {
        "eligible_symbols": len(rows),
        "positive_symbols": int(sum(rows)),
        "breadth": float(np.mean(rows)) if rows else 0.0,
    }


def bootstrap(data: pd.DataFrame, n: int = 30000) -> dict[str, float]:
    if data.empty:
        return {"lo": np.nan, "hi": np.nan, "p_positive": np.nan}
    day = pd.to_datetime(data.entry_time, utc=True).dt.floor("D")
    groups = [g.net_bps.to_numpy(float) for _, g in data.groupby(day)]
    rng = np.random.default_rng(2601)
    output = np.empty(n)
    for index in range(n):
        sampled = [groups[i] for i in rng.integers(0, len(groups), len(groups))]
        output[index] = np.concatenate(sampled).mean()
    return {
        "lo": float(np.quantile(output, 0.025)),
        "hi": float(np.quantile(output, 0.975)),
        "p_positive": float(np.mean(output > 0)),
    }


def portfolio(
    data: pd.DataFrame,
    cost: float,
    capital: float = 10_000.0,
) -> tuple[dict[str, float | int], pd.DataFrame, pd.DataFrame]:
    if data.empty:
        return {}, pd.DataFrame(), pd.DataFrame()
    trades = data.copy()
    trades["net_adjusted"] = trades.gross_bps - cost
    entries = {time: list(group.index) for time, group in trades.groupby("entry_time")}
    exits = {time: list(group.index) for time, group in trades.groupby("exit_time")}
    equity = capital
    max_positions = 8
    fraction = 0.05
    open_positions: dict[int, float] = {}
    accepted: list[dict[str, object]] = []
    curve: list[dict[str, object]] = []
    for timestamp in sorted(set(entries) | set(exits)):
        for trade_index in exits.get(timestamp, []):
            if trade_index in open_positions:
                notional = open_positions.pop(trade_index)
                pnl = notional * float(trades.loc[trade_index, "net_adjusted"]) / 1e4
                equity += pnl
                accepted.append(
                    trades.loc[trade_index].to_dict()
                    | {
                        "notional": notional,
                        "pnl_usd": pnl,
                        "equity_after": equity,
                    }
                )
        for trade_index in sorted(
            entries.get(timestamp, []),
            key=lambda index: float(trades.loc[index, "strength"]),
            reverse=True,
        ):
            if len(open_positions) >= max_positions:
                continue
            symbol = str(trades.loc[trade_index, "symbol"])
            if any(str(trades.loc[index, "symbol"]) == symbol for index in open_positions):
                continue
            open_positions[trade_index] = equity * fraction
        curve.append({"time": timestamp, "equity": equity, "open_positions": len(open_positions)})
    curve_frame = pd.DataFrame(curve)
    accepted_frame = pd.DataFrame(accepted)
    drawdown = (
        curve_frame.equity / curve_frame.equity.cummax() - 1
        if not curve_frame.empty
        else pd.Series(dtype=float)
    )
    days = int((JULY_END - PRE_JULY_END).days)
    result = {
        "start_usd": capital,
        "end_usd": equity,
        "pnl_usd": equity - capital,
        "return_pct": (equity / capital - 1) * 100,
        "mechanical_annualized_pct": ((equity / capital) ** (365 / days) - 1) * 100,
        "closed_dd_pct": float(-drawdown.min() * 100) if len(drawdown) else np.nan,
        "trades": int(len(accepted_frame)),
        "trades_per_day": float(len(accepted_frame) / days),
        "max_positions": max_positions,
        "notional_per_position_pct": fraction * 100,
        "cost_bps": cost,
    }
    return result, accepted_frame, curve_frame


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

    manifest = download_all(SYMBOLS, cache, args.workers)
    pd.DataFrame(manifest).to_csv(output / "SOURCE_MANIFEST.csv", index=False)

    frames: dict[str, pd.DataFrame] = {}
    funding: dict[str, pd.DatetimeIndex] = {}
    coverage = []
    for symbol in SYMBOLS:
        klines = load_klines(symbol, manifest)
        position_metrics = load_metrics(symbol, manifest)
        events = load_funding(symbol, manifest)
        coverage.append(
            {
                "symbol": symbol,
                "kline_rows": len(klines),
                "metric_rows": len(position_metrics),
                "first_kline": None if klines.empty else klines.open_time.iloc[0],
                "last_kline": None if klines.empty else klines.open_time.iloc[-1],
                "first_metric": None if position_metrics.empty else position_metrics.create_time.iloc[0],
                "last_metric": None if position_metrics.empty else position_metrics.create_time.iloc[-1],
                "funding_events": len(events),
            }
        )
        if klines.empty or position_metrics.empty:
            continue
        frames[symbol] = build_features(klines, position_metrics)
        funding[symbol] = events
        print(symbol, len(klines), len(position_metrics), flush=True)
    pd.DataFrame(coverage).to_csv(output / "COVERAGE.csv", index=False)

    stores: dict[str, dict[str, pd.DataFrame]] = {}
    grid_rows = []
    period_bounds = {
        "2025H2": (START, CUT),
        "2026H1": (CUT, PRE_JULY_END),
    }
    for config in CONFIGS:
        stores[config.name] = {}
        for label, bounds in period_bounds.items():
            trades = []
            for symbol, frame in frames.items():
                trades += simulate_symbol(
                    symbol,
                    frame,
                    config,
                    *bounds,
                    funding[symbol],
                )
            selected = select_portfolio_events(pd.DataFrame(trades), topn=4)
            stores[config.name][label] = selected
            base = metrics(selected, BASE_COST_BPS)
            stress = metrics(selected, STRESS_COST_BPS)
            grid_rows.append(
                {
                    "config": config.name,
                    "period": label,
                    **asdict(config),
                    **{f"base_{key}": value for key, value in base.items()},
                    **{f"stress20_{key}": value for key, value in stress.items()},
                    **breadth(selected),
                }
            )
    grid = pd.DataFrame(grid_rows)
    grid.to_csv(output / "CONFIG_RESULTS_PRE_JULY.csv", index=False)

    selection_rows = []
    for config in CONFIGS:
        first = stores[config.name]["2025H2"]
        second = stores[config.name]["2026H1"]
        a = metrics(first, BASE_COST_BPS)
        b = metrics(second, BASE_COST_BPS)
        a20 = metrics(first, STRESS_COST_BPS)
        b20 = metrics(second, STRESS_COST_BPS)
        ba = breadth(first)
        bb = breadth(second)
        eligible = (
            a["trades"] >= 80
            and b["trades"] >= 80
            and a["avg_bps"] > 0
            and b["avg_bps"] > 0
            and a20["avg_bps"] > 0
            and b20["avg_bps"] > 0
            and a["pf"] > 1.05
            and b["pf"] > 1.05
            and ba["eligible_symbols"] >= 8
            and bb["eligible_symbols"] >= 8
            and ba["breadth"] >= 0.50
            and bb["breadth"] >= 0.50
        )
        score = (
            min(a20["avg_bps"], b20["avg_bps"])
            * math.sqrt(min(a["trades"], b["trades"]) / 100)
            * min(a["pf"], b["pf"], 3)
            * min(ba["breadth"], bb["breadth"])
            if eligible
            else -1e9
        )
        selection_rows.append(
            {
                "config": config.name,
                "eligible": eligible,
                "score": score,
                "trades_2025H2": a["trades"],
                "avg_2025H2": a["avg_bps"],
                "avg20_2025H2": a20["avg_bps"],
                "pf_2025H2": a["pf"],
                "breadth_2025H2": ba["breadth"],
                "trades_2026H1": b["trades"],
                "avg_2026H1": b["avg_bps"],
                "avg20_2026H1": b20["avg_bps"],
                "pf_2026H1": b["pf"],
                "breadth_2026H1": bb["breadth"],
            }
        )
    selection = pd.DataFrame(selection_rows).sort_values("score", ascending=False)
    selection.to_csv(output / "SELECTION_BEFORE_JULY.csv", index=False)
    chosen_name = str(selection.iloc[0].config)
    chosen = next(config for config in CONFIGS if config.name == chosen_name)

    july_trades = []
    for symbol, frame in frames.items():
        july_trades += simulate_symbol(
            symbol,
            frame,
            chosen,
            PRE_JULY_END,
            JULY_END,
            funding[symbol],
        )
    july = select_portfolio_events(pd.DataFrame(july_trades), topn=4)
    july.to_csv(output / "JULY_TRADES.csv", index=False)
    july_ranking = []
    for symbol in SYMBOLS:
        subset = july[july.symbol == symbol] if not july.empty else pd.DataFrame()
        july_ranking.append(
            {
                "symbol": symbol,
                **{f"base_{key}": value for key, value in metrics(subset, BASE_COST_BPS).items()},
                **{f"stress20_{key}": value for key, value in metrics(subset, STRESS_COST_BPS).items()},
            }
        )
    pd.DataFrame(july_ranking).sort_values("base_avg_bps", ascending=False).to_csv(
        output / "JULY_COIN_RANKING.csv", index=False
    )

    base_portfolio, base_trades, base_curve = portfolio(july, BASE_COST_BPS)
    stress_portfolio, stress_trades, stress_curve = portfolio(july, STRESS_COST_BPS)
    base_trades.to_csv(output / "PORTFOLIO_TRADES_12BPS.csv", index=False)
    base_curve.to_csv(output / "PORTFOLIO_EQUITY_12BPS.csv", index=False)
    stress_trades.to_csv(output / "PORTFOLIO_TRADES_20BPS.csv", index=False)
    stress_curve.to_csv(output / "PORTFOLIO_EQUITY_20BPS.csv", index=False)

    summary = {
        "generated_at": datetime.now(UTC).isoformat(),
        "symbols_requested": len(SYMBOLS),
        "symbols_with_complete_inputs": len(frames),
        "configs": len(CONFIGS),
        "eligible_configs": int(selection.eligible.sum()),
        "chosen": asdict(chosen),
        "selection": selection.to_dict(orient="records"),
        "july_12bps": metrics(july, BASE_COST_BPS),
        "july_20bps": metrics(july, STRESS_COST_BPS),
        "july_bootstrap": bootstrap(july),
        "portfolio_12bps": base_portfolio,
        "portfolio_20bps": stress_portfolio,
    }
    (output / "SUMMARY.json").write_text(json.dumps(summary, indent=2))
    (output / "REPORT_RU.md").write_text(
        "# Round 26 — open interest and positioning\n\n"
        "## Selection before July\n\n"
        + selection.to_markdown(index=False, floatfmt=".2f")
        + "\n\n## July\n\n```json\n"
        + json.dumps(summary, indent=2)
        + "\n```\n"
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
