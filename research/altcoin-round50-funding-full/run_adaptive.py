#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from dataclasses import dataclass, asdict
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve()
BASE_PATH = HERE.parent / "run.py"
spec = importlib.util.spec_from_file_location("funding_full_base", BASE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("cannot load funding full base")
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)


@dataclass(frozen=True)
class MetaConfig:
    name: str
    lookback_days: int
    min_events: int
    mean_min_bps: float
    pf_min: float


META_CONFIGS = [
    MetaConfig(
        f"ADAPT_L{lookback}_N{minimum}_M{int(mean_min)}_PF{int(pf*100)}",
        lookback, minimum, mean_min, pf,
    )
    for lookback in (30, 60, 120, 180)
    for minimum in (5, 10, 20)
    for mean_min in (0.0, 5.0, 10.0)
    for pf in (1.0, 1.10, 1.25)
]


def all_event_records(panel, prices, funding) -> pd.DataFrame:
    rows: list[pd.DataFrame] = []
    for index, cfg in enumerate(base.CONFIGS, 1):
        trades = base.base.simulate(
            panel, prices, funding, cfg, base.START, base.END
        )
        if trades.empty:
            continue
        trades = trades.copy()
        trades["event_time"] = pd.to_datetime(trades.event_time, utc=True)
        trades["exit_time"] = pd.to_datetime(trades.exit_time, utc=True)
        event = trades.groupby("event_time").agg(
            event_bps=("net20_bps", "mean"),
            legs=("net20_bps", "size"),
            completion_time=("exit_time", "max"),
        ).reset_index()
        event["config"] = cfg.name
        event["mode"] = cfg.mode
        event["k"] = cfg.k
        event["threshold_bps"] = cfg.threshold_bps
        event["persistence"] = cfg.persistence
        rows.append(event)
        if index % 15 == 0:
            print(f"base configs {index}/{len(base.CONFIGS)}", flush=True)
    if not rows:
        return pd.DataFrame()
    return pd.concat(rows, ignore_index=True).sort_values(
        ["event_time", "config"]
    ).reset_index(drop=True)


def attach_trailing_stats(records: pd.DataFrame, lookback_days: int) -> pd.DataFrame:
    output: list[pd.DataFrame] = []
    window_ns = int(pd.Timedelta(days=lookback_days).value)
    for config, current in records.groupby("config", sort=False):
        current = current.sort_values("event_time").copy()
        completed = current.sort_values("completion_time")
        completed_ns = completed.completion_time.astype("int64").to_numpy()
        returns = completed.event_bps.to_numpy(float)
        csum = np.concatenate([[0.0], np.cumsum(returns)])
        cgain = np.concatenate([[0.0], np.cumsum(np.maximum(returns, 0.0))])
        closs = np.concatenate([[0.0], np.cumsum(np.maximum(-returns, 0.0))])
        event_ns = current.event_time.astype("int64").to_numpy()
        high = np.searchsorted(completed_ns, event_ns, side="left")
        low = np.searchsorted(completed_ns, event_ns - window_ns, side="left")
        count = high - low
        total = csum[high] - csum[low]
        gain = cgain[high] - cgain[low]
        loss = closs[high] - closs[low]
        mean = np.divide(total, count, out=np.full(len(count), np.nan), where=count > 0)
        pf = np.divide(gain, loss, out=np.full(len(count), np.inf), where=loss > 0)
        current["trail_count"] = count
        current["trail_mean_bps"] = mean
        current["trail_pf"] = pf
        current["lookback_days"] = lookback_days
        output.append(current)
    return pd.concat(output, ignore_index=True) if output else pd.DataFrame()


def select_events(stats: pd.DataFrame, cfg: MetaConfig) -> pd.DataFrame:
    x = stats[
        (stats.lookback_days == cfg.lookback_days)
        & (stats.trail_count >= cfg.min_events)
        & (stats.trail_mean_bps >= cfg.mean_min_bps)
        & (stats.trail_pf >= cfg.pf_min)
    ].copy()
    if x.empty:
        return pd.DataFrame()
    x["score"] = (
        x.trail_mean_bps
        * np.sqrt(x.trail_count)
        * np.minimum(x.trail_pf.replace(np.inf, 3.0), 3.0)
    )
    selected = (
        x.sort_values(["event_time", "score"], ascending=[True, False])
        .drop_duplicates("event_time")
        .reset_index(drop=True)
    )
    selected["meta_config"] = cfg.name
    return selected


def metrics(events: pd.DataFrame) -> dict[str, float | int]:
    if events.empty:
        return {
            "events": 0, "legs": 0, "avg_bps": np.nan, "pf": np.nan,
            "win_rate": np.nan, "configs_used": 0,
        }
    values = events.event_bps.to_numpy(float)
    loss = -values[values < 0].sum()
    return {
        "events": int(len(values)),
        "legs": int(events.legs.sum()),
        "avg_bps": float(values.mean()),
        "pf": float(values[values > 0].sum() / loss) if loss else float("inf"),
        "win_rate": float(np.mean(values > 0)),
        "configs_used": int(events.config.nunique()),
    }


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

    manifest = base.data_mod.download_all(base.SYMBOLS, args.cache, args.workers)
    pd.DataFrame(manifest).to_csv(args.output / "SOURCE_MANIFEST.csv", index=False)
    prices = {}
    funding = {}
    coverage = []
    for symbol in base.SYMBOLS:
        price = base.data_mod.load_series(symbol, manifest, premium=False)
        rate = base.monthly_funding(symbol, manifest)
        coverage.append({
            "symbol": symbol, "price_rows": len(price), "funding_events": len(rate),
        })
        if len(price) and len(rate):
            prices[symbol] = price
            funding[symbol] = rate
    pd.DataFrame(coverage).to_csv(args.output / "COVERAGE.csv", index=False)
    panel = base.base.build_event_panel(prices, funding)

    records = all_event_records(panel, prices, funding)
    records.to_csv(args.output / "ALL_BASE_EVENT_RETURNS.csv", index=False)
    stats = pd.concat(
        [attach_trailing_stats(records, lookback) for lookback in (30, 60, 120, 180)],
        ignore_index=True,
    )

    periods = {
        "2024": (base.START, base.CUT1),
        "2025H1": (base.CUT1, base.CUT2),
        "2025H2": (base.CUT2, base.CUT3),
        "2026H1": (base.CUT3, base.END),
    }
    stores: dict[str, pd.DataFrame] = {}
    grid = []
    for cfg in META_CONFIGS:
        selected = select_events(stats, cfg)
        stores[cfg.name] = selected
        for label, (start, end) in periods.items():
            part = selected[(selected.event_time >= start) & (selected.event_time < end)]
            grid.append({"meta_config": cfg.name, "period": label, **asdict(cfg), **metrics(part)})
    grid_frame = pd.DataFrame(grid)
    grid_frame.to_csv(args.output / "META_CONFIG_RESULTS_ALL_PERIODS.csv", index=False)

    selection = []
    for cfg in META_CONFIGS:
        a = metrics(stores[cfg.name][
            (stores[cfg.name].event_time >= base.START)
            & (stores[cfg.name].event_time < base.CUT1)
        ])
        b = metrics(stores[cfg.name][
            (stores[cfg.name].event_time >= base.CUT1)
            & (stores[cfg.name].event_time < base.CUT2)
        ])
        eligible = (
            a["events"] >= 30 and b["events"] >= 15
            and a["avg_bps"] > 0 and b["avg_bps"] > 0
            and a["pf"] >= 1.10 and b["pf"] >= 1.10
        )
        score = (
            min(a["avg_bps"], b["avg_bps"])
            * math.sqrt(min(a["events"], b["events"]) / 15)
            * min(a["pf"], b["pf"], 3)
            if eligible else -1e9
        )
        selection.append({
            "meta_config": cfg.name, "eligible": eligible, "score": score,
            **{f"2024_{k}": v for k, v in a.items()},
            **{f"2025H1_{k}": v for k, v in b.items()},
        })
    selection_frame = pd.DataFrame(selection).sort_values("score", ascending=False)
    selection_frame.to_csv(args.output / "META_SELECTION_BEFORE_LATE_PERIODS.csv", index=False)
    chosen_name = str(selection_frame.iloc[0].meta_config)
    chosen_cfg = next(cfg for cfg in META_CONFIGS if cfg.name == chosen_name)
    chosen_events = stores[chosen_name]

    factual = []
    accounts = []
    late_parts = []
    for label in ("2025H2", "2026H1"):
        start, end = periods[label]
        part = chosen_events[(chosen_events.event_time >= start) & (chosen_events.event_time < end)].copy()
        part.to_csv(args.output / f"CHOSEN_EVENTS_{label}.csv", index=False)
        factual.append({"period": label, **metrics(part)})
        late_parts.append(part)
        for fraction in (0.025, 0.05, 0.10, 0.20, 0.33, 0.50, 1.00):
            accounts.append({"period": label, **account(part, fraction, start, end)})
    late = pd.concat(late_parts, ignore_index=True) if any(len(frame) for frame in late_parts) else pd.DataFrame()
    factual.append({"period": "LATE_12M", **metrics(late)})
    for fraction in (0.025, 0.05, 0.10, 0.20, 0.33, 0.50, 1.00):
        accounts.append({"period": "LATE_12M", **account(late, fraction, base.CUT2, base.END)})
    pd.DataFrame(factual).to_csv(args.output / "FACTUAL_LATE_RESULTS.csv", index=False)
    pd.DataFrame(accounts).to_csv(args.output / "ACCOUNT_SCENARIOS.csv", index=False)

    summary = {
        "generated_at": datetime.now(UTC).isoformat(),
        "base_configs": len(base.CONFIGS),
        "meta_configs": len(META_CONFIGS),
        "eligible_meta_configs": int(selection_frame.eligible.sum()),
        "chosen": asdict(chosen_cfg),
        "factual": factual,
        "accounts": accounts,
        "selection": selection_frame.to_dict(orient="records"),
    }
    (args.output / "SUMMARY.json").write_text(
        json.dumps(summary, indent=2, default=str), encoding="utf-8"
    )
    (args.output / "REPORT_RU.md").write_text(
        "# Round 51 — каузальный adaptive funding selector\n\n"
        "На каждом funding-событии конфигурация выбирается только по shadow-результатам, "
        "закрытым до момента нового решения. Meta-параметры выбираются на 2024 и 2025H1, "
        "затем проверяются на 2025H2 и 2026H1. Все event returns уже включают 20 bps на ногу.\n\n"
        + pd.DataFrame(factual).to_markdown(index=False, floatfmt=".3f")
        + "\n\n" + pd.DataFrame(accounts).to_markdown(index=False, floatfmt=".3f") + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
