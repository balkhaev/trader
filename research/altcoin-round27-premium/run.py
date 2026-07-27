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
from data import download_all, load_funding, load_series
from strategy import CONFIGS, build_features, metrics, select_events, simulate_symbol


def breadth(data: pd.DataFrame, minimum: int = 4) -> dict[str, float | int]:
    if data.empty:
        return {"eligible_symbols": 0, "positive_symbols": 0, "breadth": 0.0}
    values = []
    for _, group in data.groupby("symbol"):
        if len(group) >= minimum:
            values.append(group.net_bps.mean() > 0)
    return {
        "eligible_symbols": len(values),
        "positive_symbols": int(sum(values)),
        "breadth": float(np.mean(values)) if values else 0.0,
    }


def bootstrap(data: pd.DataFrame, n: int = 30000) -> dict[str, float]:
    if data.empty:
        return {"lo": np.nan, "hi": np.nan, "p_positive": np.nan}
    day = pd.to_datetime(data.entry_time, utc=True).dt.floor("D")
    groups = [group.net_bps.to_numpy(float) for _, group in data.groupby(day)]
    rng = np.random.default_rng(2701)
    values = np.empty(n)
    for index in range(n):
        values[index] = np.concatenate(
            [groups[i] for i in rng.integers(0, len(groups), len(groups))]
        ).mean()
    return {
        "lo": float(np.quantile(values, 0.025)),
        "hi": float(np.quantile(values, 0.975)),
        "p_positive": float(np.mean(values > 0)),
    }


def portfolio(data: pd.DataFrame, cost: float, capital: float = 10_000.0) -> dict[str, float | int]:
    if data.empty:
        return {}
    trades = data.copy()
    trades["adjusted"] = trades.gross_bps - cost
    entries = {time: list(group.index) for time, group in trades.groupby("entry_time")}
    exits = {time: list(group.index) for time, group in trades.groupby("exit_time")}
    open_positions: dict[int, float] = {}
    equity = capital
    accepted = 0
    max_positions = 8
    fraction = 0.05
    peak = capital
    maximum_drawdown = 0.0
    for timestamp in sorted(set(entries) | set(exits)):
        for trade_index in exits.get(timestamp, []):
            if trade_index in open_positions:
                notional = open_positions.pop(trade_index)
                equity += notional * float(trades.loc[trade_index, "adjusted"]) / 1e4
                accepted += 1
                peak = max(peak, equity)
                maximum_drawdown = max(maximum_drawdown, 1 - equity / peak)
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
    days = int((JULY_END - PRE_JULY_END).days)
    return {
        "start_usd": capital,
        "end_usd": equity,
        "pnl_usd": equity - capital,
        "return_pct": (equity / capital - 1) * 100,
        "mechanical_annualized_pct": ((equity / capital) ** (365 / days) - 1) * 100,
        "closed_dd_pct": maximum_drawdown * 100,
        "trades": accepted,
        "trades_per_day": accepted / days,
        "max_positions": max_positions,
        "notional_per_position_pct": fraction * 100,
        "cost_bps": cost,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--cache", required=True)
    parser.add_argument("--workers", type=int, default=24)
    args = parser.parse_args()
    output = Path(args.output)
    cache = Path(args.cache)
    output.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)

    manifest = download_all(SYMBOLS, cache, args.workers)
    pd.DataFrame(manifest).to_csv(output / "SOURCE_MANIFEST.csv", index=False)

    frames = {}
    funding = {}
    coverage = []
    for symbol in SYMBOLS:
        klines = load_series(symbol, manifest, premium=False)
        premium = load_series(symbol, manifest, premium=True)
        events = load_funding(symbol, manifest, output)
        coverage.append({
            "symbol": symbol,
            "kline_rows": len(klines),
            "premium_rows": len(premium),
            "funding_events": len(events),
            "first": None if klines.empty else klines.open_time.iloc[0],
            "last": None if klines.empty else klines.open_time.iloc[-1],
        })
        if klines.empty or premium.empty or events.empty:
            continue
        frames[symbol] = build_features(klines, premium, events)
        funding[symbol] = events
        print(symbol, len(klines), len(premium), len(events), flush=True)
    pd.DataFrame(coverage).to_csv(output / "COVERAGE.csv", index=False)

    stores = {}
    grid_rows = []
    for config in CONFIGS:
        stores[config.name] = {}
        for label, bounds in {
            "2025H2": (START, CUT),
            "2026H1": (CUT, PRE_JULY_END),
        }.items():
            trades = []
            for symbol, frame in frames.items():
                trades += simulate_symbol(
                    symbol,
                    frame,
                    config,
                    *bounds,
                    funding[symbol],
                )
            selected = select_events(pd.DataFrame(trades), topn=5)
            stores[config.name][label] = selected
            base = metrics(selected, BASE_COST_BPS)
            stress = metrics(selected, STRESS_COST_BPS)
            grid_rows.append({
                "config": config.name,
                "period": label,
                **asdict(config),
                **{f"base_{key}": value for key, value in base.items()},
                **{f"stress20_{key}": value for key, value in stress.items()},
                **breadth(selected),
            })
    pd.DataFrame(grid_rows).to_csv(output / "CONFIG_RESULTS_PRE_JULY.csv", index=False)

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
            a["trades"] >= 60
            and b["trades"] >= 60
            and a20["avg_bps"] > 0
            and b20["avg_bps"] > 0
            and a["pf"] > 1.05
            and b["pf"] > 1.05
            and ba["eligible_symbols"] >= 6
            and bb["eligible_symbols"] >= 6
            and ba["breadth"] >= 0.50
            and bb["breadth"] >= 0.50
        )
        score = (
            min(a20["avg_bps"], b20["avg_bps"])
            * math.sqrt(min(a["trades"], b["trades"]) / 100)
            * min(a["pf"], b["pf"], 3)
            * min(ba["breadth"], bb["breadth"])
            if eligible else -1e9
        )
        selection_rows.append({
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
        })
    selection = pd.DataFrame(selection_rows).sort_values("score", ascending=False)
    selection.to_csv(output / "SELECTION_BEFORE_JULY.csv", index=False)
    chosen = next(config for config in CONFIGS if config.name == str(selection.iloc[0].config))

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
    july = select_events(pd.DataFrame(july_trades), topn=5)
    july.to_csv(output / "JULY_TRADES.csv", index=False)
    ranking = []
    for symbol in SYMBOLS:
        subset = july[july.symbol == symbol] if not july.empty else pd.DataFrame()
        ranking.append({
            "symbol": symbol,
            **{f"base_{key}": value for key, value in metrics(subset, BASE_COST_BPS).items()},
            **{f"stress20_{key}": value for key, value in metrics(subset, STRESS_COST_BPS).items()},
        })
    pd.DataFrame(ranking).sort_values("base_avg_bps", ascending=False).to_csv(
        output / "JULY_COIN_RANKING.csv", index=False
    )

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
        "portfolio_12bps": portfolio(july, BASE_COST_BPS),
        "portfolio_20bps": portfolio(july, STRESS_COST_BPS),
    }
    (output / "SUMMARY.json").write_text(json.dumps(summary, indent=2))
    (output / "REPORT_RU.md").write_text(
        "# Round 27 — premium and funding\n\n"
        "## Selection before July\n\n"
        + selection.to_markdown(index=False, floatfmt=".2f")
        + "\n\n## July\n\n```json\n"
        + json.dumps(summary, indent=2)
        + "\n```\n"
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
