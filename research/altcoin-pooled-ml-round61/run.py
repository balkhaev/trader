from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from datetime import UTC, datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

HERE = Path(__file__).resolve()
BASE_PATH = HERE.parents[1] / "altcoin-round34-trend" / "run.py"
spec = importlib.util.spec_from_file_location("trend_base", BASE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("cannot load trend base")
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)

SYMBOLS = list(base.SYMBOLS)
WARMUP_START = pd.Timestamp("2023-11-01", tz="UTC")
TRAIN_START = pd.Timestamp("2024-01-01", tz="UTC")
TRAIN_END = pd.Timestamp("2025-01-01", tz="UTC")
DEV_END = pd.Timestamp("2025-07-01", tz="UTC")
TEST1_END = pd.Timestamp("2026-01-01", tz="UTC")
TEST2_END = pd.Timestamp("2026-07-01", tz="UTC")
END = pd.Timestamp("2026-07-27", tz="UTC")
HOLD_BARS = 8
STOP_ATR = 3.0
COST_BPS = 20.0

base.WARMUP_START = WARMUP_START
base.START = TRAIN_START
base.CUT1 = TRAIN_END
base.CUT2 = DEV_END
base.CUT3 = TEST1_END
base.PRE_JULY_END = TEST2_END
base.END = END
base.STRESS_COST = COST_BPS

PERIODS = {
    "DEV_2025H1": (TRAIN_END, DEV_END),
    "TEST_2025H2": (DEV_END, TEST1_END),
    "TEST_2026H1": (TEST1_END, TEST2_END),
    "JULY2026": (TEST2_END, END),
}


def rolling_z(series: pd.Series, window: int, minimum: int) -> pd.Series:
    mean = series.rolling(window, min_periods=minimum).mean()
    std = series.rolling(window, min_periods=minimum).std().replace(0, np.nan)
    return (series - mean) / std


def symbol_features(symbol: str, raw: pd.DataFrame) -> pd.DataFrame:
    frame = raw.copy().sort_values("open_time").reset_index(drop=True)
    for column in (
        "open", "high", "low", "close", "volume", "quote_volume",
        "taker_buy_base",
    ):
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame["atr"] = base.atr(frame)
    frame["atr_pct"] = frame.atr / frame.close
    log_close = np.log(frame.close.clip(lower=1e-12))
    one_return = log_close.diff()
    for horizon in (1, 2, 4, 8, 16, 32):
        frame[f"ret{horizon}"] = log_close.diff(horizon)
    for window in (8, 32, 96, 384):
        frame[f"rv{window}"] = one_return.rolling(window, min_periods=max(4, window // 2)).std()
    for window in (16, 64, 256):
        ema = frame.close.ewm(span=window, adjust=False, min_periods=window).mean()
        frame[f"ema{window}_dist"] = frame.close / ema - 1
    for window in (32, 96):
        high = frame.high.rolling(window, min_periods=window).max()
        low = frame.low.rolling(window, min_periods=window).min()
        frame[f"range_pos{window}"] = (frame.close - low) / (high - low).replace(0, np.nan)
        frame[f"range_width{window}"] = (high - low) / frame.close
    log_volume = np.log1p(frame.quote_volume.clip(lower=0))
    frame["volz96"] = rolling_z(log_volume, 96, 48)
    frame["volz672"] = rolling_z(log_volume, 672, 336)
    frame["taker_imbalance"] = (
        2 * frame.taker_buy_base / frame.volume.replace(0, np.nan) - 1
    )
    candle_range = (frame.high - frame.low).replace(0, np.nan)
    body_high = frame[["open", "close"]].max(axis=1)
    body_low = frame[["open", "close"]].min(axis=1)
    frame["body_fraction"] = (frame.close - frame.open).abs() / candle_range
    frame["upper_wick"] = (frame.high - body_high) / candle_range
    frame["lower_wick"] = (body_low - frame.low) / candle_range
    frame["range_atr"] = candle_range / frame.atr.replace(0, np.nan)
    minutes = frame.open_time.dt.hour * 60 + frame.open_time.dt.minute
    frame["tod_sin"] = np.sin(2 * np.pi * minutes / 1440)
    frame["tod_cos"] = np.cos(2 * np.pi * minutes / 1440)
    frame["dow_sin"] = np.sin(2 * np.pi * frame.open_time.dt.dayofweek / 7)
    frame["dow_cos"] = np.cos(2 * np.pi * frame.open_time.dt.dayofweek / 7)
    frame["symbol"] = symbol
    frame["signal_index"] = np.arange(len(frame))
    frame["entry_time"] = frame.open_time.shift(-1)
    frame["target_exit_time"] = frame.open_time.shift(-(HOLD_BARS + 1))
    frame["target_bps"] = (
        frame.open.shift(-(HOLD_BARS + 1)) / frame.open.shift(-1) - 1
    ) * 1e4
    return frame[frame.open_time.dt.minute == 0].copy()


def make_panel(frames: dict[str, pd.DataFrame]) -> tuple[pd.DataFrame, list[str]]:
    pieces = [symbol_features(symbol, frame) for symbol, frame in frames.items()]
    panel = pd.concat(pieces, ignore_index=True)
    market = panel.groupby("open_time").agg(
        market_ret4=("ret4", "median"),
        market_ret16=("ret16", "median"),
        market_rv32=("rv32", "median"),
        market_breadth=("ret4", lambda values: float((values > 0).mean())),
        market_count=("symbol", "count"),
    ).reset_index()
    panel = panel.merge(market, on="open_time", how="left")
    panel["relative_ret4"] = panel.ret4 - panel.market_ret4
    panel["relative_ret16"] = panel.ret16 - panel.market_ret16
    panel["relative_rv32"] = panel.rv32 - panel.market_rv32
    symbol_dummies = pd.get_dummies(panel.symbol, prefix="symbol", dtype=float)
    panel = pd.concat([panel, symbol_dummies], axis=1)
    feature_columns = [
        column
        for column in panel.columns
        if column.startswith((
            "ret", "rv", "ema", "range_pos", "range_width", "volz",
            "taker_imbalance", "body_fraction", "upper_wick", "lower_wick",
            "range_atr", "tod_", "dow_", "market_", "relative_", "symbol_",
        ))
        and column not in {"target_bps", "target_exit_time"}
    ]
    panel[feature_columns] = panel[feature_columns].replace([np.inf, -np.inf], np.nan)
    return panel, feature_columns


def crosses(events_ns: np.ndarray, entry_ns: int, exit_ns: int) -> bool:
    if not len(events_ns):
        return False
    index = np.searchsorted(events_ns, entry_ns, side="left")
    return index < len(events_ns) and events_ns[index] <= exit_ns


def simulate_signals(
    predictions: pd.DataFrame,
    frames: dict[str, pd.DataFrame],
    funding: dict[str, pd.DatetimeIndex],
    threshold: float,
    mode: str,
    start: pd.Timestamp,
    end: pd.Timestamp,
) -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    last_exit: dict[str, int] = {symbol: -1 for symbol in frames}
    arrays = {
        symbol: {
            "open": frame.open.to_numpy(float),
            "high": frame.high.to_numpy(float),
            "low": frame.low.to_numpy(float),
            "atr": base.atr(frame).to_numpy(float),
            "time": list(frame.open_time),
            "time_ns": frame.open_time.astype("int64").to_numpy(),
            "funding_ns": funding[symbol].astype("int64").to_numpy(),
        }
        for symbol, frame in frames.items()
    }
    candidates = predictions[
        (predictions.open_time >= start)
        & (predictions.open_time < end)
    ].copy()
    if mode == "both":
        candidates = candidates[candidates.prediction_bps.abs() >= threshold]
    elif mode == "long":
        candidates = candidates[candidates.prediction_bps >= threshold]
    else:
        candidates = candidates[candidates.prediction_bps <= -threshold]
    candidates["strength"] = candidates.prediction_bps.abs()
    candidates = candidates.sort_values(["open_time", "strength"], ascending=[True, False])
    for _, signal in candidates.iterrows():
        symbol = str(signal.symbol)
        signal_index = int(signal.signal_index)
        if signal_index <= last_exit[symbol]:
            continue
        entry_index = signal_index + 1
        exit_index_planned = entry_index + HOLD_BARS
        data = arrays[symbol]
        if exit_index_planned >= len(data["time"]):
            continue
        entry_time = data["time"][entry_index]
        exit_time_planned = data["time"][exit_index_planned]
        if not (start <= entry_time < end) or exit_time_planned >= end:
            continue
        if entry_time.date() != exit_time_planned.date():
            continue
        if crosses(
            data["funding_ns"],
            int(data["time_ns"][entry_index]),
            int(data["time_ns"][exit_index_planned]),
        ):
            continue
        atr_value = data["atr"][signal_index]
        if not np.isfinite(atr_value) or atr_value <= 0:
            continue
        side = 1 if signal.prediction_bps > 0 else -1
        entry = data["open"][entry_index]
        stop = entry - side * STOP_ATR * atr_value
        exit_price = data["open"][exit_index_planned]
        exit_index = exit_index_planned
        reason = "time"
        mae = 0.0
        mfe = 0.0
        for index in range(entry_index, exit_index_planned):
            excursions = (
                side * (data["high"][index] / entry - 1) * 1e4,
                side * (data["low"][index] / entry - 1) * 1e4,
            )
            mae = min(mae, *excursions)
            mfe = max(mfe, *excursions)
            if side == 1 and data["open"][index] <= stop:
                exit_price, exit_index, reason = data["open"][index], index, "stop_gap"
                break
            if side == -1 and data["open"][index] >= stop:
                exit_price, exit_index, reason = data["open"][index], index, "stop_gap"
                break
            if side == 1 and data["low"][index] <= stop:
                exit_price, exit_index, reason = stop, index, "stop"
                break
            if side == -1 and data["high"][index] >= stop:
                exit_price, exit_index, reason = stop, index, "stop"
                break
        gross = side * (exit_price / entry - 1) * 1e4
        stop_distance = abs((stop / entry - 1) * 1e4)
        rows.append({
            "symbol": symbol,
            "mode": mode,
            "threshold_bps": threshold,
            "side": side,
            "signal_time": signal.open_time,
            "entry_time": entry_time,
            "exit_time": data["time"][exit_index],
            "prediction_bps": float(signal.prediction_bps),
            "gross_bps": float(gross),
            "net20_bps": float(gross - COST_BPS),
            "stop_distance_bps": float(stop_distance),
            "R20": float((gross - COST_BPS) / (stop_distance + COST_BPS)),
            "reason": reason,
            "mae_bps": mae,
            "mfe_bps": mfe,
        })
        last_exit[symbol] = exit_index
    return pd.DataFrame(rows)


def metrics(frame: pd.DataFrame) -> dict[str, float | int]:
    if frame.empty:
        return {"trades": 0, "avg_bps": np.nan, "pf": np.nan, "win_rate": np.nan, "avg_R": np.nan, "breadth": np.nan}
    values = frame.net20_bps.to_numpy(float)
    gains = values[values > 0].sum()
    losses = -values[values < 0].sum()
    symbol_stats = frame.groupby("symbol").agg(n=("net20_bps", "size"), mean=("net20_bps", "mean"))
    represented = symbol_stats[symbol_stats.n >= 10]
    breadth = float((represented["mean"] > 0).mean()) if len(represented) else np.nan
    return {
        "trades": int(len(frame)),
        "avg_bps": float(values.mean()),
        "pf": float(gains / losses) if losses else float("inf"),
        "win_rate": float(np.mean(values > 0)),
        "avg_R": float(frame.R20.mean()),
        "breadth": breadth,
    }


def account(frame: pd.DataFrame, risk_pct: float, start: pd.Timestamp, end: pd.Timestamp, initial: float = 10_000.0, max_positions: int = 5, gross_cap_x: float = 3.0) -> dict[str, float | int]:
    data = frame[(pd.to_datetime(frame.entry_time, utc=True) >= start) & (pd.to_datetime(frame.entry_time, utc=True) < end)].sort_values(["entry_time", "prediction_bps"], ascending=[True, False]).reset_index(drop=True)
    equity = initial
    open_positions: dict[int, dict[str, float | str]] = {}
    curve: list[float] = []
    accepted = 0
    for timestamp in sorted(set(data.entry_time) | set(data.exit_time)) if len(data) else []:
        for index, position in list(open_positions.items()):
            row = data.iloc[index]
            if row.exit_time == timestamp and row.entry_time < timestamp:
                equity += float(position["notional"]) * float(row.net20_bps) / 1e4
                del open_positions[index]
                accepted += 1
        for index in data.index[data.entry_time == timestamp]:
            row = data.iloc[index]
            if len(open_positions) >= max_positions or any(str(position["symbol"]) == row.symbol for position in open_positions.values()):
                continue
            stop_fraction = (float(row.stop_distance_bps) + COST_BPS) / 1e4
            notional = min(equity * (risk_pct / 100) / stop_fraction, equity * 2.0)
            used = sum(float(position["notional"]) for position in open_positions.values())
            notional = min(notional, max(0.0, equity * gross_cap_x - used))
            if notional > 0:
                open_positions[index] = {"symbol": row.symbol, "notional": notional}
        for index, position in list(open_positions.items()):
            row = data.iloc[index]
            if row.exit_time == timestamp and row.entry_time == timestamp:
                equity += float(position["notional"]) * float(row.net20_bps) / 1e4
                del open_positions[index]
                accepted += 1
        curve.append(equity)
    values = np.asarray(curve, dtype=float) if curve else np.asarray([initial])
    drawdown = 1 - values / np.maximum.accumulate(values)
    years = max((end - start).days / 365.25, 1 / 365.25)
    return {
        "risk_pct": risk_pct,
        "return_pct": float((equity / initial - 1) * 100),
        "cagr_pct": float(((equity / initial) ** (1 / years) - 1) * 100) if equity > 0 else -100.0,
        "closed_dd_pct": float(drawdown.max() * 100),
        "accepted_trades": int(accepted),
        "end_usd": float(equity),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--workers", type=int, default=32)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    args.cache.mkdir(parents=True, exist_ok=True)

    manifest = base.download_all(args.cache, args.workers)
    pd.DataFrame(manifest).to_csv(args.output / "SOURCE_MANIFEST.csv", index=False)
    frames: dict[str, pd.DataFrame] = {}
    funding: dict[str, pd.DatetimeIndex] = {}
    coverage: list[dict[str, object]] = []
    for symbol in SYMBOLS:
        raw = base.load_klines(symbol, manifest)
        events = base.load_funding(symbol, manifest)
        coverage.append({"symbol": symbol, "rows": len(raw), "funding_events": len(events), "first": None if raw.empty else raw.open_time.iloc[0], "last": None if raw.empty else raw.open_time.iloc[-1]})
        if len(raw):
            frames[symbol] = raw
            funding[symbol] = events
    pd.DataFrame(coverage).to_csv(args.output / "COVERAGE.csv", index=False)

    panel, feature_columns = make_panel(frames)
    usable = panel.dropna(subset=["target_bps", "entry_time", "target_exit_time"]).copy()
    train = usable[(usable.open_time >= TRAIN_START) & (usable.target_exit_time < TRAIN_END) & (usable.market_count >= 20)].copy()
    if len(train) < 50_000:
        raise RuntimeError(f"insufficient training rows: {len(train)}")
    model = HistGradientBoostingRegressor(
        loss="squared_error",
        learning_rate=0.05,
        max_iter=140,
        max_depth=3,
        min_samples_leaf=300,
        l2_regularization=5.0,
        max_bins=63,
        early_stopping=True,
        validation_fraction=0.10,
        random_state=6101,
    )
    model.fit(train[feature_columns].astype("float32"), train.target_bps.astype(float))
    joblib.dump(model, args.output / "MODEL.joblib")
    (args.output / "FEATURES.json").write_text(json.dumps(feature_columns, indent=2), encoding="utf-8")

    prediction_panel = usable[(usable.open_time >= TRAIN_END) & (usable.open_time < END) & (usable.market_count >= 20)].copy()
    prediction_panel["prediction_bps"] = model.predict(prediction_panel[feature_columns].astype("float32"))
    prediction_panel[["symbol", "open_time", "signal_index", "prediction_bps"]].to_csv(args.output / "PREDICTIONS.csv", index=False)

    thresholds = [10, 15, 20, 25, 30, 40, 50, 75]
    modes = ["both", "long", "short"]
    dev_rows: list[dict[str, object]] = []
    dev_store: dict[tuple[str, float], pd.DataFrame] = {}
    for mode in modes:
        for threshold in thresholds:
            trades = simulate_signals(prediction_panel, frames, funding, threshold, mode, TRAIN_END, DEV_END)
            dev_store[(mode, threshold)] = trades
            first = trades[pd.to_datetime(trades.entry_time, utc=True) < pd.Timestamp("2025-04-01", tz="UTC")] if len(trades) else pd.DataFrame()
            second = trades[pd.to_datetime(trades.entry_time, utc=True) >= pd.Timestamp("2025-04-01", tz="UTC")] if len(trades) else pd.DataFrame()
            result = metrics(trades)
            m1 = metrics(first)
            m2 = metrics(second)
            eligible = result["trades"] >= 300 and result["avg_bps"] > 0 and result["pf"] >= 1.10 and pd.notna(result["breadth"]) and result["breadth"] >= 0.50 and m1["avg_bps"] > 0 and m2["avg_bps"] > 0
            score = result["avg_bps"] * math.sqrt(result["trades"] / 300) * min(result["pf"], 3) * result["breadth"] if eligible else -1e9
            dev_rows.append({"mode": mode, "threshold_bps": threshold, "eligible": bool(eligible), "score": float(score), **{f"dev_{key}": value for key, value in result.items()}, "jan_mar_avg_bps": m1["avg_bps"], "apr_jun_avg_bps": m2["avg_bps"]})
    selection = pd.DataFrame(dev_rows).sort_values("score", ascending=False)
    selection.to_csv(args.output / "THRESHOLD_SELECTION_2025H1.csv", index=False)
    eligible = selection[selection.eligible]
    if eligible.empty:
        chosen = selection.iloc[0]
        status = "NO_ELIGIBLE_CONFIGURATION"
    else:
        chosen = eligible.iloc[0]
        status = "ELIGIBLE_CONFIGURATION_SELECTED"
    chosen_mode = str(chosen.mode)
    chosen_threshold = float(chosen.threshold_bps)

    period_rows: list[dict[str, object]] = []
    trade_parts: list[pd.DataFrame] = []
    for period, bounds in PERIODS.items():
        trades = simulate_signals(prediction_panel, frames, funding, chosen_threshold, chosen_mode, *bounds)
        period_rows.append({"period": period, **metrics(trades)})
        if len(trades):
            trades["period"] = period
            trade_parts.append(trades)
    chosen_trades = pd.concat(trade_parts, ignore_index=True) if trade_parts else pd.DataFrame()
    chosen_trades.to_csv(args.output / "CHOSEN_TRADES.csv", index=False)
    period_frame = pd.DataFrame(period_rows)
    period_frame.to_csv(args.output / "PERIOD_METRICS.csv", index=False)

    account_rows: list[dict[str, object]] = []
    for label, bounds in {"TEST_2025H2": PERIODS["TEST_2025H2"], "TEST_2026H1": PERIODS["TEST_2026H1"], "FIXED_LATE_12M": (DEV_END, TEST2_END), "JULY2026": PERIODS["JULY2026"]}.items():
        for risk in (0.25, 0.5, 1.0, 2.0, 3.0):
            account_rows.append({"period": label, **account(chosen_trades, risk, *bounds)})
    accounts = pd.DataFrame(account_rows)
    accounts.to_csv(args.output / "ACCOUNT_SCENARIOS.csv", index=False)

    model_spec = {"model": "HistGradientBoostingRegressor", "parameters": model.get_params(), "train_rows": int(len(train)), "train_start": str(TRAIN_START), "train_end_exclusive": str(TRAIN_END), "hold_bars": HOLD_BARS, "stop_atr": STOP_ATR, "cost_bps": COST_BPS}
    (args.output / "MODEL_SPEC.json").write_text(json.dumps(model_spec, indent=2, default=str), encoding="utf-8")
    summary = {"generated_at": datetime.now(UTC).isoformat(), "status": status, "chosen_mode": chosen_mode, "chosen_threshold_bps": chosen_threshold, "selection": selection.to_dict(orient="records"), "period_metrics": period_rows, "accounts": account_rows, "model_spec": model_spec}
    (args.output / "SUMMARY.json").write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    report = "# Round 61 — pooled 15m altcoin ML\n\nModel is trained once on 2024. Mode and prediction threshold are selected only on 2025H1. 2025H2 and 2026H1 are fixed tests.\n\n## Status\n\n" + status + "\n\n## Chosen\n\n- mode: " + chosen_mode + "\n- threshold: " + str(chosen_threshold) + " bps\n\n## Period metrics\n\n" + period_frame.to_markdown(index=False, floatfmt=".3f") + "\n\n## Accounts\n\n" + accounts.to_markdown(index=False, floatfmt=".3f") + "\n"
    (args.output / "REPORT_RU.md").write_text(report, encoding="utf-8")
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
