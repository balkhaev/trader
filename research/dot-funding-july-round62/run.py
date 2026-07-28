from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve()
PREMIUM_DIR = HERE.parents[1] / "altcoin-round27-premium"
sys.path.insert(0, str(PREMIUM_DIR))

import config as premium_config  # noqa: E402
import data as data_mod  # noqa: E402

SYMBOL = "DOTUSDT"
WARMUP_START = pd.Timestamp("2026-06-01", tz="UTC")
START = pd.Timestamp("2026-07-01", tz="UTC")
END = pd.Timestamp("2026-07-28", tz="UTC")
THRESHOLD_BPS = -2.0
HOLD_BARS = 32
STOP_ATR = 6.0
TARGET_R = 2.0
COST_BPS = 20.0

for module in (premium_config, data_mod):
    module.WARMUP_START = WARMUP_START
    module.PRE_JULY_END = START
    module.JULY_END = END


def atr(frame: pd.DataFrame, periods: int = 14) -> pd.Series:
    previous = frame.close.shift()
    true_range = pd.concat(
        [
            frame.high - frame.low,
            (frame.high - previous).abs(),
            (frame.low - previous).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return true_range.ewm(
        alpha=1 / periods,
        adjust=False,
        min_periods=periods,
    ).mean()


def actual_funding(
    funding: pd.DataFrame,
    entry: pd.Timestamp,
    exit_time: pd.Timestamp,
) -> float:
    events = funding[
        (funding.funding_time > entry)
        & (funding.funding_time <= exit_time)
    ]
    # Long receives negative funding and pays positive funding.
    return float((-events.funding_rate * 1e4).sum())


def metrics(frame: pd.DataFrame) -> dict[str, float | int]:
    if frame.empty:
        return {
            "trades": 0,
            "avg_bps": np.nan,
            "pf": np.nan,
            "win_rate": np.nan,
            "total_bps": 0.0,
            "avg_R": np.nan,
            "total_R": 0.0,
        }
    values = frame.net20_bps.to_numpy(float)
    gains = values[values > 0].sum()
    losses = -values[values < 0].sum()
    r = frame.R20.to_numpy(float)
    return {
        "trades": int(len(frame)),
        "avg_bps": float(values.mean()),
        "pf": float(gains / losses) if losses else float("inf"),
        "win_rate": float(np.mean(values > 0)),
        "total_bps": float(values.sum()),
        "avg_R": float(r.mean()),
        "total_R": float(r.sum()),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    args.cache.mkdir(parents=True, exist_ok=True)

    manifest = data_mod.download_all([SYMBOL], args.cache, args.workers)
    pd.DataFrame(manifest).to_csv(
        args.output / "SOURCE_MANIFEST.csv",
        index=False,
    )
    price = data_mod.load_series(SYMBOL, manifest, premium=False)
    funding = data_mod.load_funding(SYMBOL, manifest, args.output)
    if price.empty or funding.empty:
        raise RuntimeError("incomplete DOT July data")

    price = price.sort_values("open_time").reset_index(drop=True)
    for column in ("open", "high", "low", "close"):
        price[column] = pd.to_numeric(price[column], errors="coerce")
    price["atr"] = atr(price)
    index_map = {
        timestamp: index
        for index, timestamp in enumerate(price.open_time)
    }
    open_values = price.open.to_numpy(float)
    high_values = price.high.to_numpy(float)
    low_values = price.low.to_numpy(float)
    atr_values = price.atr.to_numpy(float)
    times = list(price.open_time)

    events = funding.copy().sort_values("funding_time")
    events["rate_bps"] = events.funding_rate * 1e4
    events = events[
        (events.funding_time >= START)
        & (events.funding_time < END)
        & (events.rate_bps <= THRESHOLD_BPS)
    ]

    rows: list[dict[str, object]] = []
    last_exit = -1
    for _, event in events.iterrows():
        event_time = pd.Timestamp(event.funding_time)
        signal_index = index_map.get(event_time)
        entry_time = event_time + pd.Timedelta(minutes=15)
        entry_index = index_map.get(entry_time)
        if signal_index is None or entry_index is None:
            continue
        if signal_index <= last_exit:
            continue
        planned_exit = entry_index + HOLD_BARS
        if planned_exit >= len(price):
            continue
        planned_exit_time = times[planned_exit]
        if planned_exit_time >= END:
            continue
        if entry_time.date() != planned_exit_time.date():
            continue
        signal_atr = atr_values[signal_index]
        if not np.isfinite(signal_atr) or signal_atr <= 0:
            continue
        entry = open_values[entry_index]
        stop = entry - STOP_ATR * signal_atr
        risk = entry - stop
        target = entry + TARGET_R * risk
        exit_price = open_values[planned_exit]
        exit_index = planned_exit
        reason = "time"
        mae_bps = 0.0
        mfe_bps = 0.0
        for index in range(entry_index, planned_exit):
            mae_bps = min(
                mae_bps,
                (low_values[index] / entry - 1) * 1e4,
            )
            mfe_bps = max(
                mfe_bps,
                (high_values[index] / entry - 1) * 1e4,
            )
            if open_values[index] <= stop:
                exit_price = open_values[index]
                exit_index = index
                reason = "stop_gap"
                break
            if low_values[index] <= stop:
                exit_price = stop
                exit_index = index
                reason = "stop"
                break
            if high_values[index] >= target:
                exit_price = target
                exit_index = index
                reason = "target"
                break
        exit_time = times[exit_index]
        price_bps = (exit_price / entry - 1) * 1e4
        funding_bps = actual_funding(funding, entry_time, exit_time)
        net20_bps = price_bps + funding_bps - COST_BPS
        stop_distance_bps = abs((stop / entry - 1) * 1e4)
        rows.append(
            {
                "symbol": SYMBOL,
                "event_time": event_time,
                "entry_time": entry_time,
                "exit_time": exit_time,
                "signal_funding_bps": float(event.rate_bps),
                "realized_funding_bps": funding_bps,
                "price_bps": price_bps,
                "net20_bps": net20_bps,
                "stop_distance_bps": stop_distance_bps,
                "R20": net20_bps / (stop_distance_bps + COST_BPS),
                "reason": reason,
                "mae_bps": mae_bps,
                "mfe_bps": mfe_bps,
            }
        )
        last_exit = exit_index

    trades = pd.DataFrame(rows)
    trades.to_csv(args.output / "JULY_TRADES.csv", index=False)
    result = metrics(trades)

    account_rows: list[dict[str, float]] = []
    for fraction in (0.10, 0.20, 0.33, 0.50, 1.0, 2.0, 3.0):
        equity = 10_000.0
        peak = equity
        max_dd = 0.0
        for _, trade in trades.sort_values("exit_time").iterrows():
            equity *= max(
                0.0,
                1 + fraction * float(trade.net20_bps) / 1e4,
            )
            peak = max(peak, equity)
            max_dd = max(max_dd, 1 - equity / peak)
        account_rows.append(
            {
                "notional_fraction": fraction,
                "end_usd": equity,
                "return_pct": (equity / 10_000 - 1) * 100,
                "closed_dd_pct": max_dd * 100,
                "trades": len(trades),
            }
        )
    accounts = pd.DataFrame(account_rows)
    accounts.to_csv(args.output / "ACCOUNT_SCENARIOS.csv", index=False)

    summary = {
        "generated_at": datetime.now(UTC).isoformat(),
        "fixed_rule": {
            "symbol": SYMBOL,
            "known_funding_threshold_bps": THRESHOLD_BPS,
            "entry_delay_minutes": 15,
            "hold_bars_15m": HOLD_BARS,
            "stop_atr": STOP_ATR,
            "target_R": TARGET_R,
            "round_turn_cost_bps": COST_BPS,
        },
        "coverage": {
            "price_rows": len(price),
            "funding_events": len(funding),
            "first_price": str(price.open_time.iloc[0]),
            "last_price": str(price.open_time.iloc[-1]),
        },
        "metrics": result,
        "accounts": account_rows,
    }
    (args.output / "SUMMARY.json").write_text(
        json.dumps(summary, indent=2, default=str),
        encoding="utf-8",
    )
    (args.output / "REPORT_RU.md").write_text(
        "# DOT July 2026 fixed forward check\n\n"
        "The rule was frozen before July was read.\n\n"
        + "## Metrics\n\n"
        + pd.DataFrame([result]).to_markdown(index=False, floatfmt=".3f")
        + "\n\n## Account scenarios\n\n"
        + accounts.to_markdown(index=False, floatfmt=".3f")
        + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
