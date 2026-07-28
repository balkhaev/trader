#!/usr/bin/env python3
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
PREMIUM_DIR = HERE.parents[1] / "altcoin-round27-premium"
BASE_PATH = HERE.parents[1] / "altcoin-round41-funding-carry" / "run.py"
sys.path.insert(0, str(PREMIUM_DIR))

import config as source_config  # noqa: E402
import data as data_mod  # noqa: E402

spec = importlib.util.spec_from_file_location("funding_base", BASE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("cannot load funding carry base")
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)

SYMBOLS = list(source_config.SYMBOLS)
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

CONFIGS = [
    base.Config(
        f"{mode.upper()}_K{k}_T{str(threshold).replace('.', 'p')}_{'PERSIST' if persistence else 'RAW'}",
        mode, k, threshold, persistence,
    )
    for mode in ("neutral", "short_positive", "long_negative")
    for k in (2, 3, 5)
    for threshold in (0.25, 0.5, 1.0, 2.0, 3.0)
    for persistence in (False, True)
]


def monthly_funding(symbol: str, manifest: list[dict[str, object]]) -> pd.DataFrame:
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


def account(events: pd.DataFrame, fraction_per_leg: float,
            start: pd.Timestamp, end: pd.Timestamp,
            capital: float = 10_000.0, gross_cap: float = 3.0) -> dict[str, float | int]:
    equity = capital
    peak = capital
    max_dd = 0.0
    for _, row in events.sort_values("event_time").iterrows():
        gross = min(float(row.legs) * fraction_per_leg, gross_cap)
        equity = max(0.0, equity * (1 + gross * float(row.event_bps) / 1e4))
        peak = max(peak, equity)
        max_dd = max(max_dd, 1 - equity / peak if peak else 1.0)
        if equity <= 0:
            break
    years = max((end - start).days / 365.25, 1 / 365.25)
    cagr = -100.0 if equity <= 0 else ((equity / capital) ** (1 / years) - 1) * 100
    return {
        "fraction_per_leg": fraction_per_leg,
        "end_usd": equity,
        "return_pct": (equity / capital - 1) * 100,
        "cagr_pct": cagr,
        "closed_dd_pct": max_dd * 100,
        "events": int(len(events)),
        "legs": int(events.legs.sum()) if len(events) else 0,
        "gross_cap_x": gross_cap,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--workers", type=int, default=32)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    args.cache.mkdir(parents=True, exist_ok=True)

    manifest = data_mod.download_all(SYMBOLS, args.cache, args.workers)
    pd.DataFrame(manifest).to_csv(args.output / "SOURCE_MANIFEST.csv", index=False)
    prices: dict[str, pd.DataFrame] = {}
    funding: dict[str, pd.DataFrame] = {}
    coverage = []
    for symbol in SYMBOLS:
        price = data_mod.load_series(symbol, manifest, premium=False)
        rate = monthly_funding(symbol, manifest)
        coverage.append({
            "symbol": symbol, "price_rows": len(price), "funding_events": len(rate),
            "first_price": None if price.empty else price.open_time.iloc[0],
            "last_price": None if price.empty else price.open_time.iloc[-1],
            "first_funding": None if rate.empty else rate.funding_time.iloc[0],
            "last_funding": None if rate.empty else rate.funding_time.iloc[-1],
        })
        if len(price) and len(rate):
            prices[symbol] = price
            funding[symbol] = rate
    pd.DataFrame(coverage).to_csv(args.output / "COVERAGE.csv", index=False)
    panel = base.build_event_panel(prices, funding)

    periods = {
        "2024": (START, CUT1),
        "2025H1": (CUT1, CUT2),
        "2025H2": (CUT2, CUT3),
        "2026H1": (CUT3, END),
    }
    stores: dict[str, dict[str, pd.DataFrame]] = {}
    grid = []
    for cfg in CONFIGS:
        stores[cfg.name] = {}
        for label, bounds in periods.items():
            trades = base.simulate(panel, prices, funding, cfg, *bounds)
            stores[cfg.name][label] = trades
            grid.append({"config": cfg.name, "period": label, **asdict(cfg), **base.metrics(trades)})
    grid_frame = pd.DataFrame(grid)
    grid_frame.to_csv(args.output / "CONFIG_RESULTS_ALL_PERIODS.csv", index=False)

    selection = []
    for cfg in CONFIGS:
        a = base.metrics(stores[cfg.name]["2024"])
        b = base.metrics(stores[cfg.name]["2025H1"])
        eligible = (
            a["events"] >= 30 and b["events"] >= 15
            and a["event_avg_bps"] > 0 and b["event_avg_bps"] > 0
            and a["event_pf"] >= 1.10 and b["event_pf"] >= 1.10
        )
        score = (
            min(a["event_avg_bps"], b["event_avg_bps"])
            * math.sqrt(min(a["events"], b["events"]) / 15)
            * min(a["event_pf"], b["event_pf"], 3)
            if eligible else -1e9
        )
        selection.append({
            "config": cfg.name, "eligible": eligible, "score": score,
            **{f"2024_{k}": v for k, v in a.items()},
            **{f"2025H1_{k}": v for k, v in b.items()},
        })
    selection_frame = pd.DataFrame(selection).sort_values("score", ascending=False)
    selection_frame.to_csv(args.output / "SELECTION_BEFORE_LATE_PERIODS.csv", index=False)
    chosen_name = str(selection_frame.iloc[0].config)
    chosen = next(cfg for cfg in CONFIGS if cfg.name == chosen_name)

    factual = []
    accounts = []
    late_parts = []
    for label in ("2025H2", "2026H1"):
        trades = stores[chosen.name][label]
        events = base.event_returns(trades)
        trades.to_csv(args.output / f"CHOSEN_TRADES_{label}.csv", index=False)
        events.to_csv(args.output / f"CHOSEN_EVENTS_{label}.csv", index=False)
        factual.append({"period": label, **base.metrics(trades)})
        late_parts.append(trades)
        start, end = periods[label]
        for fraction in (0.025, 0.05, 0.10, 0.20, 0.33, 0.50, 1.00):
            accounts.append({"period": label, **account(events, fraction, start, end)})
    late = pd.concat(late_parts, ignore_index=True) if any(len(frame) for frame in late_parts) else pd.DataFrame()
    late_events = base.event_returns(late)
    factual.append({"period": "LATE_12M", **base.metrics(late)})
    for fraction in (0.025, 0.05, 0.10, 0.20, 0.33, 0.50, 1.00):
        accounts.append({"period": "LATE_12M", **account(late_events, fraction, CUT2, END)})
    pd.DataFrame(factual).to_csv(args.output / "FACTUAL_LATE_RESULTS.csv", index=False)
    pd.DataFrame(accounts).to_csv(args.output / "ACCOUNT_SCENARIOS.csv", index=False)

    summary = {
        "generated_at": datetime.now(UTC).isoformat(),
        "configs": len(CONFIGS),
        "eligible_configs": int(selection_frame.eligible.sum()),
        "chosen": asdict(chosen),
        "factual": factual,
        "accounts": accounts,
        "selection": selection_frame.to_dict(orient="records"),
    }
    (args.output / "SUMMARY.json").write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    (args.output / "REPORT_RU.md").write_text(
        "# Round 50 — полный funding carry grid\n\n"
        "Все 90 конфигураций проверяются на 2024 и 2025H1; только затем читаются 2025H2 и 2026H1. "
        "Каждая нога включает 20 bps полного оборота.\n\n"
        + pd.DataFrame(factual).to_markdown(index=False, floatfmt=".3f")
        + "\n\n" + pd.DataFrame(accounts).to_markdown(index=False, floatfmt=".3f") + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
