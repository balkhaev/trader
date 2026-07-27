from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

from config import SYMBOLS, PRE_JULY_END, JULY_END
from data import download_monthly, download_july, load_klines, load_funding
from strategy import VARIANTS, features, metrics, simulate

BASE_COST = 12.0
STRESS_COST = 20.0
SELECTED_VARIANT = "LONG60"

# Excluded from the clean cohort because their July outcomes were already viewed
# or they were assigned to another pre-registered July cohort before this run.
EXCLUDED = {
    "OPUSDT","TIAUSDT","ETCUSDT","LINKUSDT","INJUSDT","SUIUSDT",
    "SOLUSDT","1000FLOKIUSDT","AAVEUSDT","WIFUSDT","LDOUSDT",
    "PENDLEUSDT","TONUSDT","ZECUSDT","TRUMPUSDT","ATOMUSDT",
    "CFXUSDT","JUPUSDT","ORDIUSDT","WLDUSDT",
}

def bootstrap(df: pd.DataFrame, n: int = 30000) -> dict[str, float]:
    if df.empty:
        return {"lo": np.nan, "hi": np.nan, "p_positive": np.nan}
    days = pd.to_datetime(df.entry_time, utc=True).dt.floor("D")
    groups = [g.net_bps.to_numpy(float) for _, g in df.groupby(days)]
    rng = np.random.default_rng(1901)
    out = np.empty(n)
    for i in range(n):
        sampled = [groups[j] for j in rng.integers(0, len(groups), len(groups))]
        out[i] = np.concatenate(sampled).mean()
    return {
        "lo": float(np.quantile(out, 0.025)),
        "hi": float(np.quantile(out, 0.975)),
        "p_positive": float(np.mean(out > 0)),
    }

def portfolio(df: pd.DataFrame, cost: float, capital: float = 10_000.0) -> tuple[dict[str, float | int], pd.DataFrame]:
    if df.empty:
        return {}, pd.DataFrame()
    trades = df.copy()
    trades["net_adjusted"] = trades.gross_bps - cost
    entries = {t: list(g.index) for t, g in trades.groupby("entry_time")}
    exits = {t: list(g.index) for t, g in trades.groupby("exit_time")}
    equity = capital
    open_positions: dict[int, float] = {}
    accepted: list[dict[str, object]] = []
    max_positions = 10
    fraction = 0.05
    curve = []
    for timestamp in sorted(set(entries) | set(exits)):
        for idx in exits.get(timestamp, []):
            if idx in open_positions:
                notional = open_positions.pop(idx)
                pnl = notional * float(trades.loc[idx, "net_adjusted"]) / 1e4
                equity += pnl
                accepted.append(trades.loc[idx].to_dict() | {
                    "notional": notional,
                    "pnl_usd": pnl,
                    "equity_after": equity,
                })
        for idx in sorted(entries.get(timestamp, []), key=lambda i: float(trades.loc[i, "strength"]), reverse=True):
            if len(open_positions) >= max_positions:
                continue
            symbol = str(trades.loc[idx, "symbol"])
            if any(str(trades.loc[j, "symbol"]) == symbol for j in open_positions):
                continue
            open_positions[idx] = equity * fraction
        curve.append({"time": timestamp, "equity": equity, "open_positions": len(open_positions)})
    c = pd.DataFrame(curve)
    dd = c.equity / c.equity.cummax() - 1 if not c.empty else pd.Series(dtype=float)
    days = int((JULY_END - PRE_JULY_END).days)
    result = {
        "start_usd": capital,
        "end_usd": equity,
        "pnl_usd": equity - capital,
        "return_pct": (equity / capital - 1) * 100,
        "mechanical_annualized_pct": ((equity / capital) ** (365 / days) - 1) * 100,
        "closed_dd_pct": float(-dd.min() * 100) if len(dd) else np.nan,
        "trades": len(accepted),
        "trades_per_day": len(accepted) / days,
        "max_positions": max_positions,
        "notional_per_position_pct": fraction * 100,
        "cost_bps": cost,
    }
    return result, pd.DataFrame(accepted)

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

    manifest = download_monthly(SYMBOLS, cache, args.workers)
    manifest += download_july(SYMBOLS, cache, args.workers)
    pd.DataFrame(manifest).to_csv(output / "SOURCE_MANIFEST.csv", index=False)

    variant = next(v for v in VARIANTS if v.name == SELECTED_VARIANT)
    trades: list[dict[str, object]] = []
    coverage = []
    for symbol in SYMBOLS:
        raw = load_klines(symbol, manifest, include_july=True)
        funding = load_funding(symbol, manifest, include_july=True)
        coverage.append({
            "symbol": symbol,
            "rows": len(raw),
            "first": None if raw.empty else raw.open_time.iloc[0],
            "last": None if raw.empty else raw.open_time.iloc[-1],
            "clean_cohort": symbol not in EXCLUDED,
        })
        if raw.empty:
            continue
        trades += simulate(
            symbol,
            features(raw),
            variant,
            PRE_JULY_END,
            JULY_END,
            funding,
        )
    coverage_df = pd.DataFrame(coverage)
    coverage_df.to_csv(output / "COVERAGE.csv", index=False)
    all_df = pd.DataFrame(trades)
    all_df.to_csv(output / "ALL_JULY_TRADES.csv", index=False)
    clean_df = all_df[~all_df.symbol.isin(EXCLUDED)].copy() if not all_df.empty else pd.DataFrame()
    clean_df.to_csv(output / "CLEAN_COHORT_TRADES.csv", index=False)

    rows = []
    for symbol in SYMBOLS:
        sub = all_df[all_df.symbol == symbol] if not all_df.empty else pd.DataFrame()
        base = metrics(sub)
        stress = metrics(sub.assign(net_bps=sub.gross_bps - STRESS_COST)) if not sub.empty else metrics(sub)
        rows.append({
            "symbol": symbol,
            "clean_cohort": symbol not in EXCLUDED,
            **{f"base_{k}": v for k, v in base.items()},
            **{f"stress20_{k}": v for k, v in stress.items()},
        })
    ranking = pd.DataFrame(rows).sort_values(["clean_cohort", "base_avg_bps"], ascending=[False, False])
    ranking.to_csv(output / "COIN_RANKING.csv", index=False)

    full_base = metrics(all_df)
    full_stress = metrics(all_df.assign(net_bps=all_df.gross_bps-STRESS_COST)) if not all_df.empty else metrics(all_df)
    clean_base = metrics(clean_df)
    clean_stress = metrics(clean_df.assign(net_bps=clean_df.gross_bps-STRESS_COST)) if not clean_df.empty else metrics(clean_df)
    p12, pt12 = portfolio(clean_df, BASE_COST)
    p20, pt20 = portfolio(clean_df, STRESS_COST)
    pt12.to_csv(output / "PORTFOLIO_TRADES_12BPS.csv", index=False)
    pt20.to_csv(output / "PORTFOLIO_TRADES_20BPS.csv", index=False)

    summary = {
        "generated_at": datetime.now(UTC).isoformat(),
        "variant": SELECTED_VARIANT,
        "symbols_total": len(SYMBOLS),
        "symbols_clean": len([s for s in SYMBOLS if s not in EXCLUDED]),
        "full80_base12": full_base,
        "full80_stress20": full_stress,
        "clean_cohort_base12": clean_base,
        "clean_cohort_stress20": clean_stress,
        "clean_cohort_bootstrap": bootstrap(clean_df),
        "portfolio_base12": p12,
        "portfolio_stress20": p20,
    }
    (output / "SUMMARY.json").write_text(json.dumps(summary, indent=2))
    table = ranking[ranking.clean_cohort & (ranking.base_trades > 0)].head(30).to_markdown(index=False, floatfmt=".2f")
    report = f"""# Round 19 — common LONG60 across broad altcoin universe

`LONG60` was selected before July because it had the highest minimum aggregate expectancy across 2025 H2 and 2026 H1 among the common variants. No coin-specific parameters are used.

## Clean cohort

The clean cohort excludes every symbol whose July outcome had already been viewed or assigned to another July cohort before this run.

```json
{json.dumps(summary, indent=2)}
```

## Coin ranking in clean cohort

{table}

July spans only 26 days. Mechanical annualization is not a forecast.
"""
    (output / "REPORT_RU.md").write_text(report)
    print(json.dumps(summary, indent=2))

if __name__ == "__main__":
    main()
