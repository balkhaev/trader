from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve()
BASE_PATH = HERE.parents[1] / "altcoin-round28-confluence" / "run.py"

spec = importlib.util.spec_from_file_location("round28_base", BASE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("cannot load round28 base")
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)

SYMBOLS = ["ETCUSDT", "SOLUSDT", "INJUSDT"]
WARMUP_START = pd.Timestamp("2023-12-01", tz="UTC")
START = pd.Timestamp("2024-01-01", tz="UTC")
CUT = pd.Timestamp("2025-01-01", tz="UTC")
END = pd.Timestamp("2025-07-01", tz="UTC")
BASE_COST = 12.0
STRESS_COST = 20.0

base.SYMBOLS = SYMBOLS
base.WARMUP_START = WARMUP_START
base.START = START
base.CUT = CUT
base.PRE_JULY_END = END
base.JULY_END = END
base.BASE_COST = BASE_COST
base.STRESS_COST = STRESS_COST

CFG = next(cfg for cfg in base.CONFIGS if cfg.name == "FLOW_OI_STRICT60")

PROFILES = {
    "probe": {"CORE": 0.25, "A": 0.50},
    "balanced": {"CORE": 0.50, "A": 1.00},
    "aggressive": {"CORE": 0.75, "A": 1.50},
    "max_sprint": {"CORE": 1.00, "A": 2.00},
}


def build_candidate(trades: pd.DataFrame) -> pd.DataFrame:
    if trades.empty:
        return trades
    etc = trades[trades.symbol == "ETCUSDT"].copy()
    a = trades[(trades.symbol.isin(SYMBOLS)) & (trades.strength >= 5.0)].copy()
    out = pd.concat([etc, a], ignore_index=True)
    out = (
        out.sort_values(["entry_time", "strength"], ascending=[True, False])
        .drop_duplicates(["symbol", "entry_time"])
        .reset_index(drop=True)
    )
    out["tier"] = np.where(out.strength >= 5.0, "A", "CORE")
    out["tier_rank"] = np.where(out.tier == "A", 0, 1)
    return out.sort_values(
        ["entry_time", "tier_rank", "strength"],
        ascending=[True, True, False],
    ).reset_index(drop=True)


def raw_metrics(frame: pd.DataFrame, cost: float) -> dict[str, float | int]:
    if frame.empty:
        return {
            "trades": 0, "avg_bps": np.nan, "pf": np.nan,
            "win_rate": np.nan, "avg_R": np.nan, "total_R": 0.0,
        }
    values = frame.gross_bps.to_numpy(float) - cost
    risk = frame.stop_distance_bps.to_numpy(float) + cost
    r = values / risk
    gains = values[values > 0]
    losses = -values[values < 0]
    return {
        "trades": int(len(values)),
        "avg_bps": float(values.mean()),
        "pf": float(gains.sum() / losses.sum()) if losses.sum() else float("inf"),
        "win_rate": float(np.mean(values > 0)),
        "avg_R": float(r.mean()),
        "total_R": float(r.sum()),
        "best_R": float(r.max()),
        "worst_R": float(r.min()),
    }


def account(
    frame: pd.DataFrame,
    profile: dict[str, float],
    cost: float,
    capital: float = 10_000.0,
    max_positions: int = 2,
) -> tuple[dict[str, float | int], pd.DataFrame]:
    if frame.empty:
        return {}, pd.DataFrame()
    data = frame.sort_values(
        ["entry_time", "tier_rank", "strength"],
        ascending=[True, True, False],
    ).reset_index(drop=True)
    equity = capital
    open_positions: dict[int, dict[str, float | str]] = {}
    accepted: list[dict[str, object]] = []
    curve: list[dict[str, object]] = []

    timestamps = sorted(set(data.entry_time) | set(data.exit_time))
    for ts in timestamps:
        for idx, pos in list(open_positions.items()):
            row = data.iloc[idx]
            if row.exit_time == ts and row.entry_time < ts:
                pnl = float(pos["notional"]) * (float(row.gross_bps) - cost) / 1e4
                equity += pnl
                accepted.append({
                    "symbol": row.symbol, "entry_time": row.entry_time,
                    "exit_time": row.exit_time, "tier": row.tier,
                    "strength": float(row.strength), "gross_bps": float(row.gross_bps),
                    "net_bps": float(row.gross_bps) - cost,
                    "notional": float(pos["notional"]), "pnl_usd": pnl,
                    "equity_after": equity,
                    "actual_risk_pct": float(pos["actual_risk_pct"]),
                })
                del open_positions[idx]

        entries = data.index[data.entry_time == ts].tolist()
        for idx in entries:
            row = data.iloc[idx]
            if len(open_positions) >= max_positions:
                continue
            if any(str(pos["symbol"]) == row.symbol for pos in open_positions.values()):
                continue
            target_risk = profile[row.tier] / 100.0
            distance = (float(row.stop_distance_bps) + cost) / 1e4
            notional = min(equity * target_risk / distance, equity)
            remaining = max(0.0, equity * 2.0 - sum(float(p["notional"]) for p in open_positions.values()))
            notional = min(notional, remaining)
            if notional <= 0:
                continue
            open_positions[idx] = {
                "symbol": row.symbol,
                "notional": notional,
                "actual_risk_pct": notional * distance / equity * 100,
            }

        for idx, pos in list(open_positions.items()):
            row = data.iloc[idx]
            if row.exit_time == ts and row.entry_time == ts:
                pnl = float(pos["notional"]) * (float(row.gross_bps) - cost) / 1e4
                equity += pnl
                accepted.append({
                    "symbol": row.symbol, "entry_time": row.entry_time,
                    "exit_time": row.exit_time, "tier": row.tier,
                    "strength": float(row.strength), "gross_bps": float(row.gross_bps),
                    "net_bps": float(row.gross_bps) - cost,
                    "notional": float(pos["notional"]), "pnl_usd": pnl,
                    "equity_after": equity,
                    "actual_risk_pct": float(pos["actual_risk_pct"]),
                })
                del open_positions[idx]

        curve.append({"time": ts, "equity": equity})

    accepted_frame = pd.DataFrame(accepted)
    curve_frame = pd.DataFrame(curve)
    dd = curve_frame.equity / curve_frame.equity.cummax() - 1
    return {
        "start_usd": capital,
        "end_usd": equity,
        "pnl_usd": equity - capital,
        "return_pct": (equity / capital - 1) * 100,
        "closed_dd_pct": -float(dd.min()) * 100,
        "accepted_trades": int(len(accepted_frame)),
        "avg_actual_risk_pct": (
            float(accepted_frame.actual_risk_pct.mean())
            if len(accepted_frame) else np.nan
        ),
        "cost_bps": cost,
    }, accepted_frame


def bootstrap(frame: pd.DataFrame, n: int = 30_000) -> dict[str, float]:
    if frame.empty:
        return {"lo_R": np.nan, "hi_R": np.nan, "p_positive": np.nan}
    x = frame.copy()
    x["day"] = pd.to_datetime(x.entry_time, utc=True).dt.floor("D")
    x["R"] = (x.gross_bps - STRESS_COST) / (x.stop_distance_bps + STRESS_COST)
    groups = [g.R.to_numpy(float) for _, g in x.groupby("day")]
    rng = np.random.default_rng(3001)
    result = np.empty(n)
    for i in range(n):
        result[i] = np.concatenate(
            [groups[j] for j in rng.integers(0, len(groups), len(groups))]
        ).mean()
    return {
        "lo_R": float(np.quantile(result, 0.025)),
        "hi_R": float(np.quantile(result, 0.975)),
        "p_positive": float(np.mean(result > 0)),
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

    manifest = base.download_all(cache, args.workers)
    pd.DataFrame(manifest).to_csv(output / "SOURCE_MANIFEST.csv", index=False)

    all_trades: list[dict[str, object]] = []
    coverage = []
    for symbol in SYMBOLS:
        kline = base.load_concat(
            symbol, manifest, {"kline_monthly", "kline_daily"}, base.read_kline
        )
        premium = base.load_concat(
            symbol, manifest, {"premium_monthly", "premium_daily"}, base.read_kline
        )
        metrics = base.load_concat(
            symbol, manifest, {"metrics_daily"}, base.read_metrics
        )
        funding = base.load_funding(symbol, manifest)
        coverage.append({
            "symbol": symbol, "kline_rows": len(kline),
            "premium_rows": len(premium), "metric_rows": len(metrics),
            "funding_events": len(funding),
            "first": None if kline.empty else kline.open_time.iloc[0],
            "last": None if kline.empty else kline.open_time.iloc[-1],
        })
        if kline.empty or premium.empty or metrics.empty:
            continue
        feature = base.build_features(kline, premium, metrics)
        all_trades += base.simulate(symbol, feature, funding, CFG, START, END)

    pd.DataFrame(coverage).to_csv(output / "COVERAGE.csv", index=False)
    raw = pd.DataFrame(all_trades)
    raw.to_csv(output / "RAW_FIXED_RULE_TRADES.csv", index=False)
    candidate = build_candidate(raw)
    candidate.to_csv(output / "CANDIDATE_TRADES.csv", index=False)

    rows = []
    account_rows = []
    accepted_frames = []
    periods = {
        "2024": (START, CUT),
        "2025H1": (CUT, END),
        "all_18m": (START, END),
    }
    for label, (start, end) in periods.items():
        entry_time = pd.to_datetime(candidate.entry_time, utc=True)
        part = candidate[(entry_time >= start) & (entry_time < end)].copy()
        rows.append({
            "period": label,
            **{f"base_{k}": v for k, v in raw_metrics(part, BASE_COST).items()},
            **{f"stress_{k}": v for k, v in raw_metrics(part, STRESS_COST).items()},
            **bootstrap(part),
        })
        for profile_name, profile in PROFILES.items():
            for cost in (BASE_COST, STRESS_COST):
                result, accepted = account(part, profile, cost)
                account_rows.append({
                    "period": label, "profile": profile_name, **result
                })
                if label == "all_18m" and cost == STRESS_COST:
                    accepted_frames.append(
                        accepted.assign(profile=profile_name, period=label)
                    )

    metrics_frame = pd.DataFrame(rows)
    accounts_frame = pd.DataFrame(account_rows)
    metrics_frame.to_csv(output / "FACTUAL_METRICS.csv", index=False)
    accounts_frame.to_csv(output / "ACCOUNT_SCENARIOS.csv", index=False)
    if accepted_frames:
        pd.concat(accepted_frames, ignore_index=True).to_csv(
            output / "ACCEPTED_ACCOUNT_TRADES.csv", index=False
        )

    summary = {
        "generated_at": datetime.now(UTC).isoformat(),
        "candidate": {
            "core": "all FLOW_OI_STRICT60 ETC signals",
            "A_tier": "strength>=5 on ETC, SOL, INJ",
            "max_positions": 2,
        },
        "coverage": coverage,
        "metrics": rows,
        "account_scenarios": account_rows,
    }
    (output / "SUMMARY.json").write_text(json.dumps(summary, indent=2, default=str))
    (output / "REPORT_RU.md").write_text(
        "# Round 30 — backward robustness 2024–2025 H1\n\n"
        "Правило заморожено после July 2026 и проверяется без изменения на более раннем календаре.\n\n"
        "## Метрики\n\n"
        + metrics_frame.to_markdown(index=False, floatfmt=".3f")
        + "\n\n## Счёт $10 000\n\n"
        + accounts_frame.to_markdown(index=False, floatfmt=".3f")
        + "\n"
    )
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
