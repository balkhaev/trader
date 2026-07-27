from __future__ import annotations

import argparse
import importlib.util
import json
import sys
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

SYMBOLS = [
    "INJUSDT", "ZECUSDT", "OPUSDT", "ETCUSDT", "JUPUSDT",
    "WIFUSDT", "SOLUSDT", "SUIUSDT", "TIAUSDT", "AAVEUSDT",
    "XRPUSDT",
]
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


def metrics(frame: pd.DataFrame, cost: float) -> dict[str, float | int]:
    if frame.empty:
        return {
            "trades": 0,
            "avg_bps": np.nan,
            "pf": np.nan,
            "win_rate": np.nan,
            "avg_R": np.nan,
            "total_R": 0.0,
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--cache", required=True)
    parser.add_argument("--workers", type=int, default=32)
    args = parser.parse_args()
    output = Path(args.output)
    cache = Path(args.cache)
    output.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)

    manifest = base.download_all(cache, args.workers)
    pd.DataFrame(manifest).to_csv(output / "SOURCE_MANIFEST.csv", index=False)

    all_trades: list[dict[str, object]] = []
    coverage: list[dict[str, object]] = []
    for symbol in SYMBOLS:
        kline = base.load_concat(
            symbol, manifest, {"kline_monthly", "kline_daily"}, base.read_kline
        )
        premium = base.load_concat(
            symbol, manifest, {"premium_monthly", "premium_daily"}, base.read_kline
        )
        positioning = base.load_concat(
            symbol, manifest, {"metrics_daily"}, base.read_metrics
        )
        funding = base.load_funding(symbol, manifest)
        coverage.append(
            {
                "symbol": symbol,
                "kline_rows": len(kline),
                "premium_rows": len(premium),
                "metric_rows": len(positioning),
                "funding_events": len(funding),
                "first": None if kline.empty else kline.open_time.iloc[0],
                "last": None if kline.empty else kline.open_time.iloc[-1],
            }
        )
        if kline.empty or premium.empty or positioning.empty:
            continue
        feature = base.build_features(kline, premium, positioning)
        all_trades += base.simulate(symbol, feature, funding, CFG, START, END)
        print(symbol, len(all_trades), flush=True)

    pd.DataFrame(coverage).to_csv(output / "COVERAGE.csv", index=False)
    trades = pd.DataFrame(all_trades)
    trades.to_csv(output / "RAW_WIDE_HISTORY_TRADES.csv", index=False)

    rows: list[dict[str, object]] = []
    entry_time = pd.to_datetime(trades.entry_time, utc=True)
    periods = {
        "2024": (START, CUT),
        "2025H1": (CUT, END),
        "all_18m": (START, END),
    }
    for label, (start, end) in periods.items():
        part = trades[(entry_time >= start) & (entry_time < end)].copy()
        for threshold in [0.0, 4.5, 5.0, 5.5, 6.0]:
            selected = part if threshold == 0 else part[part.strength >= threshold]
            row = {
                "period": label,
                "strength_threshold": threshold,
                "symbols": int(selected.symbol.nunique()) if len(selected) else 0,
            }
            row |= {f"base_{key}": value for key, value in metrics(selected, BASE_COST).items()}
            row |= {f"stress_{key}": value for key, value in metrics(selected, STRESS_COST).items()}
            rows.append(row)
    results = pd.DataFrame(rows)
    results.to_csv(output / "HISTORY_STRENGTH_RESULTS.csv", index=False)

    coin_rows: list[dict[str, object]] = []
    for symbol, group in trades.groupby("symbol"):
        group_time = pd.to_datetime(group.entry_time, utc=True)
        for label, (start, end) in periods.items():
            part = group[(group_time >= start) & (group_time < end)]
            for threshold in [0.0, 5.0]:
                selected = part if threshold == 0 else part[part.strength >= threshold]
                coin_rows.append(
                    {
                        "symbol": symbol,
                        "period": label,
                        "strength_threshold": threshold,
                        **{f"stress_{key}": value for key, value in metrics(selected, STRESS_COST).items()},
                    }
                )
    pd.DataFrame(coin_rows).to_csv(output / "HISTORY_COIN_RESULTS.csv", index=False)

    summary = {
        "generated_at": datetime.now(UTC).isoformat(),
        "symbols": SYMBOLS,
        "fixed_config": CFG.__dict__,
        "coverage": coverage,
        "results": rows,
    }
    (output / "SUMMARY.json").write_text(json.dumps(summary, indent=2, default=str))
    (output / "REPORT_RU.md").write_text(
        "# Round 33 — wide OI history 2024–2025 H1\n\n"
        "Правило и 11-контрактный universe заморожены до чтения этого периода.\n\n"
        + results.to_markdown(index=False, floatfmt=".3f")
        + "\n"
    )
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
