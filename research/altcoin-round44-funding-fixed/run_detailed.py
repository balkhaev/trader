#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

BASE_PATH = Path(__file__).resolve().parents[1] / "altcoin-round41-funding-carry" / "run.py"
spec = importlib.util.spec_from_file_location("round41_base", BASE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("cannot load round41 base")
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)

CFG = base.Config("SHORT_POSITIVE_K3_T0p5_RAW", "short_positive", 3, 0.50, False)


def account(frame: pd.DataFrame, fraction_per_leg: float, capital: float = 10_000.0) -> tuple[dict, pd.DataFrame]:
    events = base.event_returns(frame, base.COST_BPS)
    equity = capital
    peak = capital
    max_drawdown = 0.0
    rows = []
    for _, event in events.sort_values("event_time").iterrows():
        gross_fraction = min(float(event.legs) * fraction_per_leg, 0.75)
        pnl = equity * gross_fraction * float(event.event_bps) / 1e4
        equity += pnl
        peak = max(peak, equity)
        max_drawdown = max(max_drawdown, 1 - equity / peak)
        rows.append({
            "event_time": event.event_time,
            "event_bps": event.event_bps,
            "legs": event.legs,
            "gross_fraction": gross_fraction,
            "pnl_usd": pnl,
            "equity": equity,
        })
    return {
        "fraction_per_leg": fraction_per_leg,
        "max_gross_pct": min(3 * fraction_per_leg, 0.75) * 100,
        "start_usd": capital,
        "end_usd": equity,
        "pnl_usd": equity - capital,
        "return_pct": (equity / capital - 1) * 100,
        "closed_dd_pct": max_drawdown * 100,
        "events": len(events),
        "legs": int(events.legs.sum()) if len(events) else 0,
    }, pd.DataFrame(rows)


def block_bootstrap(frame: pd.DataFrame, paths: int = 30_000) -> dict:
    events = base.event_returns(frame, base.COST_BPS)
    if events.empty:
        return {"lo": np.nan, "hi": np.nan, "p_positive": np.nan}
    events["day"] = pd.to_datetime(events.event_time, utc=True).dt.floor("D")
    groups = [group.event_bps.to_numpy(float) for _, group in events.groupby("day")]
    rng = np.random.default_rng(4401)
    values = np.empty(paths)
    for index in range(paths):
        values[index] = np.concatenate([groups[item] for item in rng.integers(0, len(groups), len(groups))]).mean()
    return {
        "lo": float(np.quantile(values, 0.025)),
        "hi": float(np.quantile(values, 0.975)),
        "p_positive": float(np.mean(values > 0)),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--workers", type=int, default=24)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    manifest = base.download_all(base.SYMBOLS, args.cache, args.workers)
    pd.DataFrame(manifest).to_csv(args.output / "SOURCE_MANIFEST.csv", index=False)
    prices = {}
    funding = {}
    coverage = []
    for symbol in base.SYMBOLS:
        price = base.load_series(symbol, manifest, premium=False)
        events = base.load_funding(symbol, manifest, args.output)
        coverage.append({
            "symbol": symbol,
            "price_rows": len(price),
            "funding_events": len(events),
            "first": None if price.empty else price.open_time.iloc[0],
            "last": None if price.empty else price.open_time.iloc[-1],
        })
        if len(price) and len(events):
            prices[symbol] = price
            funding[symbol] = events
    pd.DataFrame(coverage).to_csv(args.output / "COVERAGE.csv", index=False)
    panel = base.build_event_panel(prices, funding)

    periods = {
        "2025H2": (base.START, base.CUT),
        "2026H1": (base.CUT, base.PRE_JULY_END),
        "pre_july_year": (base.START, base.PRE_JULY_END),
        "july_2026": (base.PRE_JULY_END, base.JULY_END),
    }
    trades = {}
    metric_rows = []
    for label, bounds in periods.items():
        frame = base.simulate(panel, prices, funding, CFG, *bounds)
        trades[label] = frame
        frame.to_csv(args.output / f"TRADES_{label}.csv", index=False)
        base.event_returns(frame, base.COST_BPS).to_csv(args.output / f"EVENTS_{label}.csv", index=False)
        metric_rows.append({"period": label, **base.metrics(frame), **{f"bootstrap_{key}": value for key, value in block_bootstrap(frame).items()}})
    pd.DataFrame(metric_rows).to_csv(args.output / "PERIOD_METRICS.csv", index=False)

    account_rows = []
    for label in ("pre_july_year", "july_2026"):
        for fraction in (0.025, 0.05, 0.10, 0.20):
            result, curve = account(trades[label], fraction)
            days = 365 if label == "pre_july_year" else (base.JULY_END - base.PRE_JULY_END).days
            result["period"] = label
            result["mechanical_annualized_pct"] = ((result["end_usd"] / result["start_usd"]) ** (365 / days) - 1) * 100 if result["end_usd"] > 0 else -100.0
            account_rows.append(result)
            curve.to_csv(args.output / f"EQUITY_{label}_{int(fraction*1000)}bp_leg.csv", index=False)
    accounts = pd.DataFrame(account_rows)
    accounts.to_csv(args.output / "ACCOUNT_SCENARIOS.csv", index=False)

    summary = {
        "generated_at": datetime.now(UTC).isoformat(),
        "fixed_config": base.asdict(CFG),
        "metrics": metric_rows,
        "accounts": account_rows,
    }
    (args.output / "SUMMARY.json").write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    (args.output / "REPORT_RU.md").write_text(
        "# Round 44 — fixed short positive-funding carry\n\n"
        + pd.DataFrame(metric_rows).to_markdown(index=False, floatfmt=".3f")
        + "\n\n## Account scenarios\n\n"
        + accounts.to_markdown(index=False, floatfmt=".3f")
        + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, indent=2, default=str))

if __name__ == "__main__":
    main()
