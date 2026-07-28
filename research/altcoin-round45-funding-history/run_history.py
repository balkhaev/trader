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

import config as premium_config  # noqa: E402
import data as data_mod  # noqa: E402

spec = importlib.util.spec_from_file_location("funding_round41_base", BASE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("cannot load funding carry base")
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)

SYMBOLS = list(premium_config.SYMBOLS)
WARMUP_START = pd.Timestamp("2023-12-01", tz="UTC")
START = pd.Timestamp("2024-01-01", tz="UTC")
CUT = pd.Timestamp("2025-01-01", tz="UTC")
END = pd.Timestamp("2025-07-01", tz="UTC")
COST_BPS = 20.0

# Fixed before reading the historical replay. Every candidate was positive in
# both 2025H2 and 2026H1 in Round 42; no parameter is fitted on 2024/2025H1.
CONFIGS = [
    base.Config("LONG_NEGATIVE_K3_T0p5_PERSIST", "long_negative", 3, 0.5, True),
    base.Config("LONG_NEGATIVE_K2_T1p0_PERSIST", "long_negative", 2, 1.0, True),
    base.Config("SHORT_POSITIVE_K3_T0p5_RAW", "short_positive", 3, 0.5, False),
    base.Config("SHORT_POSITIVE_K5_T1p0_RAW", "short_positive", 5, 1.0, False),
    base.Config("NEUTRAL_K3_T0p5_PERSIST", "neutral", 3, 0.5, True),
]

# Override imported module globals so data and signal construction use only the
# fixed backward-check calendar. No daily edge-period funding API is needed.
for module in (data_mod,):
    module.WARMUP_START = WARMUP_START
    module.PRE_JULY_END = END
    module.JULY_END = END
base.SYMBOLS = SYMBOLS
base.START = START
base.CUT = CUT
base.PRE_JULY_END = END
base.JULY_END = END
base.COST_BPS = COST_BPS


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


def account(events: pd.DataFrame, fraction_per_leg: float, start: pd.Timestamp, end: pd.Timestamp,
            capital: float = 10_000.0, gross_cap: float = 3.0) -> dict[str, float | int]:
    equity = capital
    peak = capital
    max_dd = 0.0
    if events.empty:
        return {
            "fraction_per_leg": fraction_per_leg,
            "gross_cap_x": gross_cap,
            "end_usd": equity,
            "return_pct": 0.0,
            "cagr_pct": 0.0,
            "closed_dd_pct": 0.0,
            "events": 0,
            "legs": 0,
        }
    for _, row in events.sort_values("event_time").iterrows():
        gross = min(float(row.legs) * fraction_per_leg, gross_cap)
        factor = 1.0 + gross * float(row.event_bps) / 1e4
        equity = max(0.0, equity * factor)
        peak = max(peak, equity)
        max_dd = max(max_dd, 1.0 - equity / peak if peak else 1.0)
        if equity <= 0:
            break
    years = max((end - start).days / 365.25, 1 / 365.25)
    cagr = -100.0 if equity <= 0 else ((equity / capital) ** (1 / years) - 1) * 100
    return {
        "fraction_per_leg": fraction_per_leg,
        "gross_cap_x": gross_cap,
        "end_usd": equity,
        "return_pct": (equity / capital - 1) * 100,
        "cagr_pct": cagr,
        "closed_dd_pct": max_dd * 100,
        "events": int(len(events)),
        "legs": int(events.legs.sum()),
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
        coverage.append({
            "symbol": symbol,
            "price_rows": len(price),
            "funding_events": len(rate),
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
        "2024": (START, CUT),
        "2025H1": (CUT, END),
        "ALL_18M": (START, END),
    }
    metric_rows: list[dict[str, object]] = []
    account_rows: list[dict[str, object]] = []
    decision_rows: list[dict[str, object]] = []

    for cfg in CONFIGS:
        period_metrics: dict[str, dict[str, object]] = {}
        all_trades: list[pd.DataFrame] = []
        for label, (start, end) in periods.items():
            trades = base.simulate(panel, prices, funding, cfg, start, end)
            events = base.event_returns(trades)
            trades.to_csv(args.output / f"TRADES_{cfg.name}_{label}.csv", index=False)
            events.to_csv(args.output / f"EVENTS_{cfg.name}_{label}.csv", index=False)
            metrics = base.metrics(trades)
            period_metrics[label] = metrics
            metric_rows.append({"config": cfg.name, "period": label, **asdict(cfg), **metrics})
            if label != "ALL_18M":
                all_trades.append(trades)
            for fraction in (0.025, 0.05, 0.10, 0.20, 0.33, 0.50, 1.00):
                account_rows.append({
                    "config": cfg.name,
                    "period": label,
                    **account(events, fraction, start, end),
                })
        m24 = period_metrics["2024"]
        m25 = period_metrics["2025H1"]
        robust = (
            m24["events"] >= 20 and m25["events"] >= 10
            and m24["event_avg_bps"] > 0 and m25["event_avg_bps"] > 0
            and m24["event_pf"] >= 1.10 and m25["event_pf"] >= 1.10
        )
        decision_rows.append({
            "config": cfg.name,
            "robust_earlier_history": robust,
            **{f"2024_{k}": v for k, v in m24.items()},
            **{f"2025H1_{k}": v for k, v in m25.items()},
        })

    metrics_frame = pd.DataFrame(metric_rows)
    accounts_frame = pd.DataFrame(account_rows)
    decisions_frame = pd.DataFrame(decision_rows)
    metrics_frame.to_csv(args.output / "FACTUAL_METRICS.csv", index=False)
    accounts_frame.to_csv(args.output / "ACCOUNT_SCENARIOS.csv", index=False)
    decisions_frame.to_csv(args.output / "ROBUSTNESS_DECISIONS.csv", index=False)

    summary = {
        "generated_at": datetime.now(UTC).isoformat(),
        "calendar": {"start": str(START), "cut": str(CUT), "end": str(END)},
        "cost_bps_per_leg": COST_BPS,
        "configs": [asdict(cfg) for cfg in CONFIGS],
        "robust_configs": decisions_frame.loc[
            decisions_frame.robust_earlier_history, "config"
        ].tolist(),
        "metrics": metric_rows,
        "accounts": account_rows,
    }
    (args.output / "SUMMARY.json").write_text(
        json.dumps(summary, indent=2, default=str), encoding="utf-8"
    )
    (args.output / "REPORT_RU.md").write_text(
        "# Round 45 — историческая проверка funding carry\n\n"
        "Кандидаты зафиксированы по 2025H2 и 2026H1 и без изменения проверены "
        "на 2024 и 2025H1. Все результаты включают 20 bps на каждую ногу.\n\n"
        "## Решения\n\n"
        + decisions_frame.to_markdown(index=False, floatfmt=".3f")
        + "\n\n## Сценарии счёта $10 000\n\n"
        + accounts_frame.to_markdown(index=False, floatfmt=".3f")
        + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
