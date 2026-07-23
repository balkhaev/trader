#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import pandas as pd

ROOT = Path(__file__).resolve().parent
GENERATED = ROOT / "generated"
sys.path.insert(0, str(GENERATED))

from config import Costs, ProcessSpec, ResearchConfig
from data import load_all
from metrics import equity_metrics
from strategy import MarketData, ProcessFactory, annual_turnover, build_family_experts, mean_frames, simulate

SELECTED = (
    ProcessSpec(kind="static", top_k=2, score_mode="equal", overlay="none", subset=("breadth", "dual")),
    ProcessSpec(kind="walkforward", train_days=730, selection_days=182, top_k=3, score_mode="robust", overlay="none"),
    ProcessSpec(kind="static", top_k=3, score_mode="equal", overlay="none", subset=("breadth", "dual", "donchian")),
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", type=Path, default=Path(".cache/binance_v4"))
    parser.add_argument("--output", type=Path, default=Path("artifacts/v4_signal"))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    config = ResearchConfig()
    daily, manifest, quality = load_all(config, args.cache, False)
    data = MarketData(daily)
    families, counts = build_family_experts(data)
    base = Costs("base", 10.0)
    stress = Costs("stress", 20.0)
    factory = ProcessFactory(data, families, base, stress, config)
    component_frames = [factory.frame(spec) for spec in SELECTED]
    ensemble = mean_frames(component_frames, next(iter(families.values())))
    ensemble.to_csv(args.output / "v4_frozen_signal.csv")

    rows = []
    for period, start, end in (
        ("development", config.evaluation_start, config.development_end),
        ("validation", config.development_end, config.validation_end),
        ("research_holdout", config.validation_end, config.end_exclusive),
        ("full", config.evaluation_start, config.end_exclusive),
    ):
        account = simulate(data, ensemble, stress, config, start, end)
        values = equity_metrics(account.equity)
        values["annual_turnover"] = annual_turnover(account)
        rows.append({"scenario": "stress", "period": period, **values})
        account.to_csv(args.output / f"v4_stress_{period}_equity.csv")

    pd.DataFrame(rows).to_csv(args.output / "v4_export_metrics.csv", index=False)
    pd.DataFrame(manifest).to_csv(args.output / "data_manifest.csv", index=False)
    pd.DataFrame(quality).to_csv(args.output / "data_quality.csv", index=False)
    (args.output / "selected_specs.json").write_text(
        json.dumps([spec.__dict__ for spec in SELECTED], indent=2), encoding="utf-8"
    )
    (args.output / "family_counts.json").write_text(json.dumps(counts, indent=2), encoding="utf-8")
    print(pd.DataFrame(rows).to_string(index=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
