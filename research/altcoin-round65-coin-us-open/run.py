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
FIXED_PATH = HERE.parents[1] / "altcoin-us-open-round52" / "run_fixed.py"
spec = importlib.util.spec_from_file_location("round52_fixed", FIXED_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("cannot load round52 fixed engine")
fixed = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = fixed
spec.loader.exec_module(fixed)
base = fixed.base

SYMBOLS = list(base.SYMBOLS)
PERIODS = {
    "2024": (base.START, base.CUT1),
    "2025H1": (base.CUT1, base.CUT2),
    "2025H2": (base.CUT2, base.CUT3),
    "2026H1": (base.CUT3, base.END),
}
TEST_PERIODS = ("2025H2", "2026H1")
COST_BPS = float(base.COST_BPS)


def metrics(frame: pd.DataFrame) -> dict[str, float | int]:
    if frame.empty:
        return {
            "trades": 0,
            "avg_bps": np.nan,
            "pf": np.nan,
            "win_rate": np.nan,
            "avg_R": np.nan,
            "total_R": 0.0,
            "long_trades": 0,
            "short_trades": 0,
        }
    net = frame.net20_bps.to_numpy(float)
    risk = frame.stop_distance_bps.to_numpy(float)
    r = net / risk
    losses = -net[net < 0].sum()
    return {
        "trades": int(len(frame)),
        "avg_bps": float(net.mean()),
        "pf": float(net[net > 0].sum() / losses) if losses else float("inf"),
        "win_rate": float(np.mean(net > 0)),
        "avg_R": float(r.mean()),
        "total_R": float(r.sum()),
        "long_trades": int((frame.side == 1).sum()),
        "short_trades": int((frame.side == -1).sum()),
    }


def neighbor_count(config, eligible_names: set[str]) -> int:
    count = 0
    for other in base.CONFIGS:
        if other.name not in eligible_names:
            continue
        if other.slot != config.slot or other.mode != config.mode:
            continue
        distance = sum([
            other.lookback != config.lookback,
            other.z_threshold != config.z_threshold,
            other.k != config.k,
            other.hold != config.hold,
        ])
        close_z = abs(other.z_threshold - config.z_threshold) <= 0.50 + 1e-12
        close_hold = abs(other.hold - config.hold) <= 4
        if distance <= 1 and close_z and close_hold:
            count += 1
    return count


def account(
    trades: pd.DataFrame,
    risk_pct: float,
    start: pd.Timestamp,
    end: pd.Timestamp,
    capital: float = 10_000.0,
    max_positions: int = 4,
    gross_cap_x: float = 4.0,
) -> dict[str, float | int]:
    data = trades[
        (pd.to_datetime(trades.entry_time, utc=True) >= start)
        & (pd.to_datetime(trades.entry_time, utc=True) < end)
    ].sort_values(["entry_time", "strength"], ascending=[True, False]).reset_index(drop=True)
    if data.empty:
        return {
            "risk_pct": risk_pct,
            "return_pct": 0.0,
            "cagr_pct": 0.0,
            "closed_dd_pct": 0.0,
            "accepted_trades": 0,
            "end_usd": capital,
        }

    equity = capital
    peak = capital
    max_dd = 0.0
    open_positions: dict[int, dict[str, float | str]] = {}
    accepted = 0

    for timestamp in sorted(set(data.entry_time) | set(data.exit_time)):
        for index, position in list(open_positions.items()):
            row = data.iloc[index]
            if row.exit_time == timestamp and row.entry_time < timestamp:
                equity += float(position["notional"]) * float(row.net20_bps) / 1e4
                del open_positions[index]
                accepted += 1

        for index in data.index[data.entry_time == timestamp]:
            row = data.iloc[index]
            if len(open_positions) >= max_positions:
                continue
            if any(position["symbol"] == row.symbol for position in open_positions.values()):
                continue
            stop_fraction = float(row.stop_distance_bps) / 1e4
            desired = equity * (risk_pct / 100.0) / stop_fraction
            used = sum(float(position["notional"]) for position in open_positions.values())
            remaining = max(0.0, equity * gross_cap_x - used)
            notional = min(desired, equity * 2.0, remaining)
            if notional > 0:
                open_positions[index] = {"symbol": row.symbol, "notional": notional}

        for index, position in list(open_positions.items()):
            row = data.iloc[index]
            if row.exit_time == timestamp and row.entry_time == timestamp:
                equity += float(position["notional"]) * float(row.net20_bps) / 1e4
                del open_positions[index]
                accepted += 1

        peak = max(peak, equity)
        max_dd = max(max_dd, 1 - equity / peak)

    years = max((end - start).days / 365.25, 1 / 365.25)
    return {
        "risk_pct": risk_pct,
        "return_pct": (equity / capital - 1) * 100,
        "cagr_pct": ((equity / capital) ** (1 / years) - 1) * 100 if equity > 0 else -100.0,
        "closed_dd_pct": max_dd * 100,
        "accepted_trades": accepted,
        "end_usd": equity,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--workers", type=int, default=24)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    args.cache.mkdir(parents=True, exist_ok=True)

    manifest = base.download_all(args.cache, args.workers)
    pd.DataFrame(manifest).to_csv(args.output / "SOURCE_MANIFEST.csv", index=False)

    frames: dict[str, pd.DataFrame] = {}
    funding: dict[str, pd.DatetimeIndex] = {}
    coverage = []

    for symbol in SYMBOLS:
        frame, events = base.load_symbol(symbol, manifest)
        coverage.append({
            "symbol": symbol,
            "rows": len(frame),
            "funding_events": len(events),
        })
        if len(frame):
            frame = frame.copy()
            for column in ("open", "high", "low", "close", "volume", "quote_volume"):
                frame[column] = pd.to_numeric(frame[column], errors="coerce")
            frame["atr"] = base.atr(frame)
            frames[symbol] = frame
            funding[symbol] = events

    pd.DataFrame(coverage).to_csv(args.output / "COVERAGE.csv", index=False)
    panel = base.build_panel(frames)

    stores: dict[tuple[str, str], pd.DataFrame] = {}
    metric_rows: list[dict[str, object]] = []

    for config_index, config in enumerate(base.CONFIGS, 1):
        events = base.event_candidates(panel, config)
        for period, bounds in PERIODS.items():
            trades = base.simulate(events, frames, funding, config, *bounds)
            stores[(config.name, period)] = trades
            for symbol in SYMBOLS:
                part = trades[trades.symbol == symbol] if len(trades) else pd.DataFrame()
                metric_rows.append({
                    "symbol": symbol,
                    "config": config.name,
                    "period": period,
                    **asdict(config),
                    **metrics(part),
                })
        if config_index % 12 == 0:
            print(f"configs {config_index}/{len(base.CONFIGS)}", flush=True)

    metric_frame = pd.DataFrame(metric_rows)
    metric_frame.to_csv(args.output / "COIN_CONFIG_PERIOD_METRICS.csv", index=False)

    selection_rows: list[dict[str, object]] = []
    selected_rows: list[dict[str, object]] = []

    for symbol in SYMBOLS:
        preliminary: list[dict[str, object]] = []
        eligible_names: set[str] = set()

        for config in base.CONFIGS:
            first = metric_frame[
                (metric_frame.symbol == symbol)
                & (metric_frame.config == config.name)
                & (metric_frame.period == "2024")
            ].iloc[0]
            second = metric_frame[
                (metric_frame.symbol == symbol)
                & (metric_frame.config == config.name)
                & (metric_frame.period == "2025H1")
            ].iloc[0]
            eligible = (
                first.trades >= 15
                and second.trades >= 7
                and first.avg_bps > 0
                and second.avg_bps > 0
                and first.pf >= 1.10
                and second.pf >= 1.10
            )
            if eligible:
                eligible_names.add(config.name)
            score = (
                min(first.avg_bps, second.avg_bps)
                * math.sqrt(min(first.trades, second.trades) / 7)
                * min(first.pf, second.pf, 3.0)
                if eligible else -1e9
            )
            preliminary.append({
                "symbol": symbol,
                "config": config.name,
                "eligible": eligible,
                "score": score,
                "trades_2024": first.trades,
                "avg_bps_2024": first.avg_bps,
                "pf_2024": first.pf,
                "trades_2025H1": second.trades,
                "avg_bps_2025H1": second.avg_bps,
                "pf_2025H1": second.pf,
            })

        for item in preliminary:
            config = next(cfg for cfg in base.CONFIGS if cfg.name == item["config"])
            item["eligible_neighbor_count"] = neighbor_count(config, eligible_names)
            item["robust_eligible"] = bool(
                item["eligible"] and item["eligible_neighbor_count"] >= 2
            )
            if not item["robust_eligible"]:
                item["score"] = -1e9
            selection_rows.append(item)

        robust = [item for item in preliminary if item.get("robust_eligible")]
        if robust:
            best = sorted(robust, key=lambda item: item["score"], reverse=True)[0]
            config = next(cfg for cfg in base.CONFIGS if cfg.name == best["config"])
            selected_rows.append({
                "symbol": symbol,
                "config": config.name,
                "slot": config.slot,
                "mode": config.mode,
                "lookback": config.lookback,
                "z_threshold": config.z_threshold,
                "k": config.k,
                "hold": config.hold,
                "dev_score": best["score"],
                "eligible_neighbor_count": best["eligible_neighbor_count"],
            })

    selection = pd.DataFrame(selection_rows).sort_values(
        ["robust_eligible", "score"], ascending=[False, False]
    )
    selection.to_csv(args.output / "ROUTE_SELECTION_BEFORE_2025H2.csv", index=False)
    selected = pd.DataFrame(selected_rows)
    selected.to_csv(args.output / "SELECTED_ROUTES.csv", index=False)

    result_rows: list[dict[str, object]] = []
    trade_parts: list[pd.DataFrame] = []

    for route in selected_rows:
        symbol = route["symbol"]
        config_name = route["config"]
        for period in PERIODS:
            source = stores[(config_name, period)]
            part = source[source.symbol == symbol].copy()
            if len(part):
                part["period"] = period
                part["dev_score"] = route["dev_score"]
                part["eligible_neighbor_count"] = route["eligible_neighbor_count"]
                trade_parts.append(part)
            result_rows.append({
                **route,
                "period": period,
                **metrics(part),
            })

    results = pd.DataFrame(result_rows)
    results.to_csv(args.output / "SELECTED_ROUTE_RESULTS.csv", index=False)
    combined = pd.concat(trade_parts, ignore_index=True) if trade_parts else pd.DataFrame()
    combined.to_csv(args.output / "SELECTED_ROUTE_TRADES_ALL.csv", index=False)
    late = combined[combined.period.isin(TEST_PERIODS)].copy() if len(combined) else pd.DataFrame()
    late.to_csv(args.output / "SELECTED_ROUTE_TRADES_LATE.csv", index=False)

    decisions = []
    for route in selected_rows:
        symbol = route["symbol"]
        config_name = route["config"]
        first = results[
            (results.symbol == symbol)
            & (results.config == config_name)
            & (results.period == "2025H2")
        ].iloc[0]
        second = results[
            (results.symbol == symbol)
            & (results.config == config_name)
            & (results.period == "2026H1")
        ].iloc[0]
        passes = (
            first.trades >= 7
            and second.trades >= 7
            and first.avg_bps > 0
            and second.avg_bps > 0
            and first.pf >= 1.10
            and second.pf >= 1.10
        )
        decisions.append({
            "symbol": symbol,
            "config": config_name,
            "passes_fixed_late_gate": passes,
            "trades_2025H2": first.trades,
            "avg_bps_2025H2": first.avg_bps,
            "pf_2025H2": first.pf,
            "trades_2026H1": second.trades,
            "avg_bps_2026H1": second.avg_bps,
            "pf_2026H1": second.pf,
        })

    decision_frame = pd.DataFrame(decisions)
    decision_frame.to_csv(args.output / "FIXED_LATE_DECISIONS.csv", index=False)

    account_rows = []
    passed_symbols = set(
        decision_frame.loc[decision_frame.passes_fixed_late_gate, "symbol"]
    ) if len(decision_frame) else set()
    passed = late[late.symbol.isin(passed_symbols)] if len(late) else pd.DataFrame()

    for risk in (0.25, 0.50, 1.0, 2.0, 3.0, 5.0):
        account_rows.append({
            "sample": "late_all_selected",
            **account(late, risk, base.CUT2, base.END),
        })
        account_rows.append({
            "sample": "late_routes_passing_fixed_gate",
            **account(passed, risk, base.CUT2, base.END),
        })
    pd.DataFrame(account_rows).to_csv(args.output / "ACCOUNT_SCENARIOS.csv", index=False)

    summary = {
        "generated_at": datetime.now(UTC).isoformat(),
        "base_configs": len(base.CONFIGS),
        "symbols": len(SYMBOLS),
        "selected_routes": len(selected_rows),
        "routes_passing_fixed_late_gate": int(
            decision_frame.passes_fixed_late_gate.sum()
        ) if len(decision_frame) else 0,
        "selected": selected_rows,
        "decisions": decisions,
        "account_scenarios": account_rows,
    }
    (args.output / "SUMMARY.json").write_text(
        json.dumps(summary, indent=2, default=str), encoding="utf-8"
    )
    (args.output / "REPORT_RU.md").write_text(
        "# Coin-specific US-open routes\n\n"
        "Каждый coin × route выбран только на 2024 и 2025H1. Затем неизменённо "
        "проверен на 2025H2 и 2026H1 после 20 bps.\n\n"
        "## Selected routes\n\n"
        + selected.to_markdown(index=False, floatfmt=".3f")
        + "\n\n## Fixed decisions\n\n"
        + decision_frame.to_markdown(index=False, floatfmt=".3f")
        + "\n\n## Accounts\n\n"
        + pd.DataFrame(account_rows).to_markdown(index=False, floatfmt=".3f")
        + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
