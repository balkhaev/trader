#!/usr/bin/env python3
"""Independent-split driver for the AIMR intraday research backtest."""
from __future__ import annotations

import importlib.util
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path
from typing import Any

import pandas as pd

GENERATED_RUNNER = globals().get(
    "GENERATED_RUNNER", Path(__file__).with_name("_generated_run_backtest.py")
)


def load_core(path: Path):
    spec = importlib.util.spec_from_file_location("aimr_core", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load AIMR core from {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def slice_features(
    features: dict[str, pd.DataFrame], start: pd.Timestamp, end: pd.Timestamp
) -> dict[str, pd.DataFrame]:
    sliced: dict[str, pd.DataFrame] = {}
    for symbol, frame in features.items():
        period = frame[(frame.index >= start) & (frame.index < end)].copy()
        if period.empty:
            raise RuntimeError(f"No feature rows for {symbol} in {start}..{end}")
        sliced[symbol] = period
    return sliced


def main() -> int:
    core = load_core(Path(GENERATED_RUNNER))
    args = core.parse_args()
    if args.self_test:
        core.self_test()
        return 0

    config = core.StrategyConfig()
    if args.start:
        config = replace(config, start=args.start)
    if args.end_exclusive:
        config = replace(config, end_exclusive=args.end_exclusive)

    output_dir: Path = args.output
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "config.json").write_text(
        json.dumps(asdict(config), indent=2, ensure_ascii=False), encoding="utf-8"
    )

    raw_data: dict[str, pd.DataFrame] = {}
    quality: list[dict[str, Any]] = []
    manifest: list[Any] = []
    for symbol in config.symbols:
        frame, records = core.download_symbol(
            symbol, config, args.cache, refresh=args.refresh
        )
        raw_data[symbol] = frame
        quality.append(core.validate_data(frame, symbol))
        manifest.extend(records)

    pd.DataFrame([asdict(item) for item in manifest]).to_csv(
        output_dir / "data_manifest.csv", index=False
    )
    pd.DataFrame(quality).to_csv(output_dir / "data_quality.csv", index=False)

    print("Building features...")
    features = {
        symbol: core.build_features(frame, config)
        for symbol, frame in raw_data.items()
    }

    scenarios = [
        core.CostScenario("low_cost", fee_bps_per_side=3.0, slippage_bps_per_side=2.0),
        core.CostScenario("base", fee_bps_per_side=6.0, slippage_bps_per_side=4.0),
        core.CostScenario("stress", fee_bps_per_side=12.0, slippage_bps_per_side=8.0),
    ]
    run_plan = [
        (scenarios[0], "combined"),
        (scenarios[1], "combined"),
        (scenarios[2], "combined"),
        (scenarios[1], "momentum_only"),
        (scenarios[1], "mean_reversion_only"),
    ]
    periods = {name: (start, end) for name, start, end in core.metrics_periods(config)}

    metrics: list[dict[str, Any]] = []
    diagnostics: list[dict[str, Any]] = []
    base_equity: pd.DataFrame | None = None
    base_trades: pd.DataFrame | None = None
    base_test_equity: pd.DataFrame | None = None
    base_test_trades: pd.DataFrame | None = None

    for costs, variant in run_plan:
        print(f"Running full path: {variant} / {costs.name}...")
        full_equity, full_trades, full_diag = core.run_portfolio_backtest(
            features, config, costs, variant
        )
        full_equity = core.add_benchmark(full_equity, raw_data)
        full_diag["evaluation_period"] = "full_path"
        full_diag["scenario"]["all_in_bps_per_side"] = costs.all_in_bps_per_side
        diagnostics.append(full_diag)

        dev_start, dev_end = periods["development"]
        full_start, full_end = periods["full"]
        metrics.append(
            core.compute_metrics(
                full_equity,
                full_trades,
                start=dev_start,
                end=dev_end,
                scenario=costs.name,
                variant=variant,
                period="development",
            )
        )
        metrics.append(
            core.compute_metrics(
                full_equity,
                full_trades,
                start=full_start,
                end=full_end,
                scenario=costs.name,
                variant=variant,
                period="full",
            )
        )

        for period_name in ("validation", "test"):
            start, end = periods[period_name]
            print(f"Running independent {period_name}: {variant} / {costs.name}...")
            period_equity, period_trades, period_diag = core.run_portfolio_backtest(
                slice_features(features, start, end), config, costs, variant
            )
            period_equity = core.add_benchmark(period_equity, raw_data)
            period_diag["evaluation_period"] = period_name
            period_diag["scenario"]["all_in_bps_per_side"] = costs.all_in_bps_per_side
            diagnostics.append(period_diag)
            metrics.append(
                core.compute_metrics(
                    period_equity,
                    period_trades,
                    start=start,
                    end=end,
                    scenario=costs.name,
                    variant=variant,
                    period=period_name,
                )
            )
            if costs.name == "base" and variant == "combined" and period_name == "test":
                base_test_equity = period_equity
                base_test_trades = period_trades

        if costs.name == "base" and variant == "combined":
            base_equity = full_equity
            base_trades = full_trades

    metrics_df = pd.DataFrame([row for row in metrics if row])
    period_order = pd.CategoricalDtype(
        ["development", "validation", "test", "full"], ordered=True
    )
    metrics_df["period"] = metrics_df["period"].astype(period_order)
    metrics_df = metrics_df.sort_values(
        ["scenario", "variant", "period"], kind="stable"
    ).reset_index(drop=True)
    metrics_df["period"] = metrics_df["period"].astype(str)
    metrics_df.to_csv(output_dir / "metrics.csv", index=False)
    (output_dir / "diagnostics.json").write_text(
        json.dumps(diagnostics, indent=2, ensure_ascii=False, default=str),
        encoding="utf-8",
    )

    if base_equity is None or base_trades is None:
        raise RuntimeError("Base full-path run was not produced")
    if base_test_equity is None or base_test_trades is None:
        raise RuntimeError("Base independent test run was not produced")

    base_equity.to_csv(output_dir / "equity_base.csv")
    base_trades.to_csv(output_dir / "trades_base.csv", index=False)
    base_test_equity.to_csv(output_dir / "equity_base_test.csv")
    base_test_trades.to_csv(output_dir / "trades_base_test.csv", index=False)
    core.save_plots(base_equity, base_trades, output_dir)
    test_plot_dir = output_dir / "test"
    test_plot_dir.mkdir(exist_ok=True)
    core.save_plots(base_test_equity, base_test_trades, test_plot_dir)

    summary = core.write_report(output_dir, config, metrics_df, quality, diagnostics)
    summary["evaluation_note"] = (
        "Development and full are evaluated on the continuous live path. "
        "Validation and test are independently initialized at 10,000 USDT so a prior-period "
        "hard stop cannot suppress out-of-sample signals. Features retain only historical warm-up."
    )
    (output_dir / "summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False, default=str),
        encoding="utf-8",
    )

    print("\nBase combined metrics:")
    print(
        metrics_df[
            (metrics_df["scenario"] == "base")
            & (metrics_df["variant"] == "combined")
        ].to_string(index=False)
    )
    print(f"\nArtifacts written to {output_dir.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
