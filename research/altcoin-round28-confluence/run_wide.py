from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

import run as base

WIDE_SYMBOLS = [
    "SOLUSDT", "XRPUSDT", "DOGEUSDT", "BNBUSDT", "SUIUSDT",
    "ADAUSDT", "LINKUSDT", "AVAXUSDT", "LTCUSDT", "BCHUSDT",
    "AAVEUSDT", "OPUSDT", "ETCUSDT", "INJUSDT", "TIAUSDT",
    "ENAUSDT", "ONDOUSDT", "JUPUSDT", "WIFUSDT", "PENDLEUSDT",
    "TONUSDT", "TAOUSDT", "HBARUSDT", "XLMUSDT", "ALGOUSDT",
    "ZECUSDT", "FETUSDT", "RENDERUSDT", "NEARUSDT", "APTUSDT",
]


def pf(values: pd.Series) -> float:
    gains = values[values > 0].sum()
    losses = -values[values < 0].sum()
    return float(gains / losses) if losses else float("inf")


def coin_metrics(frame: pd.DataFrame, cost: float) -> pd.DataFrame:
    if frame.empty:
        return pd.DataFrame()
    x = frame.copy()
    x["adjusted"] = x.gross_bps - cost
    return x.groupby("symbol").agg(
        trades=("adjusted", "size"),
        avg_bps=("adjusted", "mean"),
        pf=("adjusted", pf),
        win_rate=("adjusted", lambda s: float((s > 0).mean())),
        strength_median=("strength", "median"),
    ).reset_index()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--cache", required=True)
    parser.add_argument("--workers", type=int, default=32)
    args = parser.parse_args()

    # Fixed mechanism: no config search in this wide-universe check.
    fixed = next(cfg for cfg in base.CONFIGS if cfg.name == "FLOW_OI_STRICT60")
    base.SYMBOLS = WIDE_SYMBOLS
    base.CONFIGS = [fixed]

    sys.argv = [sys.argv[0], "--output", args.output, "--cache", args.cache, "--workers", str(args.workers)]
    base.main()

    output = Path(args.output)
    pre = pd.read_csv(output / "CHOSEN_PRE_JULY_TRADES.csv")
    july = pd.read_csv(output / "JULY_TRADES.csv")
    for frame in (pre, july):
        if not frame.empty:
            frame["entry_time"] = pd.to_datetime(frame.entry_time, utc=True)
    pre["period"] = np.where(
        pre.entry_time < pd.Timestamp("2026-01-01", tz="UTC"),
        "2025H2",
        "2026H1",
    )

    rows = []
    for symbol, group in pre.groupby("symbol"):
        record = {"symbol": symbol}
        eligible = True
        for label in ("2025H2", "2026H1"):
            g = group[group.period == label]
            m12 = base.metrics(g, 12.0)
            m20 = base.metrics(g, 20.0)
            record |= {
                f"trades_{label}": m12["trades"],
                f"avg12_{label}": m12["avg_bps"],
                f"avg20_{label}": m20["avg_bps"],
                f"pf_{label}": m12["pf"],
            }
            eligible &= (
                m12["trades"] >= 8
                and m20["avg_bps"] > 0
                and m12["pf"] > 1.20
            )
        record["selected_before_july"] = bool(eligible)
        rows.append(record)
    selection = pd.DataFrame(rows).sort_values(
        ["selected_before_july", "avg20_2026H1"], ascending=[False, False]
    )
    selection.to_csv(output / "WIDE_COIN_SELECTION_BEFORE_JULY.csv", index=False)
    selected = selection.loc[selection.selected_before_july, "symbol"].tolist()

    tier_rows = []
    sprint_rows = []
    for threshold in (4.5, 5.0, 5.5, 6.0):
        pre_tier = pre[(pre.symbol.isin(selected)) & (pre.strength >= threshold)].copy()
        july_tier = july[(july.symbol.isin(selected)) & (july.strength >= threshold)].copy()
        tier_rows.append({
            "strength_threshold": threshold,
            "selected_symbols": len(selected),
            **{f"pre_{k}": v for k, v in base.metrics(pre_tier, 12.0).items()},
            **{f"july_{k}": v for k, v in base.metrics(july_tier, 12.0).items()},
            "july_avg20": base.metrics(july_tier, 20.0)["avg_bps"],
        })
        if threshold == 5.0:
            pre_tier.to_csv(output / "A_TIER_PRE_JULY_TRADES.csv", index=False)
            july_tier.to_csv(output / "A_TIER_JULY_TRADES.csv", index=False)
            coin_metrics(july_tier, 12.0).sort_values("avg_bps", ascending=False).to_csv(
                output / "A_TIER_JULY_COIN_RANKING.csv", index=False
            )
            for risk in (0.25, 0.5, 1.0, 1.5, 2.0, 3.0):
                sprint_rows.append({"sample": "pre_july", **base.capital_sprint(pre_tier, risk, max_positions=4, max_gross=3.0)})
                sprint_rows.append({"sample": "july", **base.capital_sprint(july_tier, risk, max_positions=4, max_gross=3.0)})
    tiers = pd.DataFrame(tier_rows)
    tiers.to_csv(output / "STRENGTH_TIER_RESULTS.csv", index=False)
    pd.DataFrame(sprint_rows).to_csv(output / "A_TIER_CAPITAL_SPRINT.csv", index=False)

    a_pre = pre[(pre.symbol.isin(selected)) & (pre.strength >= 5.0)].copy()
    a_july = july[(july.symbol.isin(selected)) & (july.strength >= 5.0)].copy()
    mc = [base.monte_carlo_sprint(a_pre, risk) for risk in (0.25, 0.5, 1.0, 1.5, 2.0, 3.0)]
    pd.DataFrame(mc).to_csv(output / "A_TIER_MONTE_CARLO.csv", index=False)

    summary = {
        "generated_at": datetime.now(UTC).isoformat(),
        "fixed_config": asdict(fixed),
        "symbols_requested": len(WIDE_SYMBOLS),
        "selected_before_july": selected,
        "strength_tiers": tier_rows,
        "a_tier_july_12bps": base.metrics(a_july, 12.0),
        "a_tier_july_20bps": base.metrics(a_july, 20.0),
        "a_tier_july_bootstrap": base.day_bootstrap(a_july),
        "a_tier_sprint": sprint_rows,
        "a_tier_monte_carlo": mc,
    }
    (output / "WIDE_SUMMARY.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    (output / "WIDE_REPORT_RU.md").write_text(
        "# Round 29 — широкий fixed OI-flush A-tier\n\n"
        "Конфигурация и strength>=5 зафиксированы до чтения итоговой таблицы.\n\n"
        "## Coin selection before July\n\n"
        + selection.to_markdown(index=False, floatfmt=".2f")
        + "\n\n## Strength tiers\n\n"
        + tiers.to_markdown(index=False, floatfmt=".2f")
        + "\n\n## A-tier July\n\n```json\n"
        + json.dumps({
            "selected": selected,
            "12bps": base.metrics(a_july, 12.0),
            "20bps": base.metrics(a_july, 20.0),
            "bootstrap": base.day_bootstrap(a_july),
        }, ensure_ascii=False, indent=2)
        + "\n```\n\n## Capital sprint\n\n"
        + pd.DataFrame(sprint_rows).to_markdown(index=False, floatfmt=".2f")
        + "\n"
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
