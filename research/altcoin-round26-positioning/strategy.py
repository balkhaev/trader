from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import pandas as pd

from config import BASE_COST_BPS


@dataclass(frozen=True)
class Config:
    name: str
    mechanism: str
    side: int
    move: float
    oi_threshold: float
    secondary: float
    hold: int


CONFIGS = [
    Config("OI_FLUSH_LONG_LOOSE45", "oi_flush", 1, 1.5, -1.0, 0.40, 3),
    Config("OI_FLUSH_LONG_STRICT60", "oi_flush", 1, 2.0, -1.5, 0.50, 4),
    Config("OI_FLUSH_SHORT_LOOSE45", "oi_flush", -1, 1.5, -1.0, 0.40, 3),
    Config("OI_FLUSH_SHORT_STRICT60", "oi_flush", -1, 2.0, -1.5, 0.50, 4),
    Config("OI_BUILD_LONG45", "oi_build", 1, 1.0, 1.0, 0.10, 3),
    Config("OI_BUILD_LONG60", "oi_build", 1, 1.5, 1.5, 0.15, 4),
    Config("OI_BUILD_SHORT45", "oi_build", -1, 1.0, 1.0, 0.10, 3),
    Config("OI_BUILD_SHORT60", "oi_build", -1, 1.5, 1.5, 0.15, 4),
    Config("NEW_SHORTS_REBOUND45", "oi_divergence", 1, 1.0, 1.0, 0.00, 3),
    Config("NEW_LONGS_FADE45", "oi_divergence", -1, 1.0, 1.0, 0.00, 3),
    Config("RETAIL_CROWD_LONG45", "crowd_fade", 1, 0.5, -1.5, 0.50, 3),
    Config("RETAIL_CROWD_SHORT45", "crowd_fade", -1, 0.5, 1.5, -0.50, 3),
]


def atr(frame: pd.DataFrame, periods: int = 14) -> pd.Series:
    previous = frame.close.shift()
    tr = pd.concat(
        [
            frame.high - frame.low,
            (frame.high - previous).abs(),
            (frame.low - previous).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return tr.ewm(alpha=1 / periods, adjust=False, min_periods=periods).mean()


def zscore(series: pd.Series, window: int = 96, minimum: int = 48) -> pd.Series:
    mean = series.rolling(window, min_periods=minimum).mean()
    std = series.rolling(window, min_periods=minimum).std().replace(0, np.nan)
    return (series - mean) / std


def build_features(klines: pd.DataFrame, metrics: pd.DataFrame) -> pd.DataFrame:
    frame = klines.copy().sort_values("open_time").reset_index(drop=True)
    for column in ["open", "high", "low", "close", "volume", "quote_volume", "taker_buy_base"]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame["close_time_key"] = frame.open_time + pd.Timedelta(minutes=15)
    frame["atr"] = atr(frame)
    frame["atr_pct"] = frame.atr / frame.close
    for periods in (1, 2, 3):
        frame[f"move{periods}"] = frame.close.pct_change(periods) / frame.atr_pct.replace(0, np.nan)
    candle_range = (frame.high - frame.low).replace(0, np.nan)
    body_high = frame[["open", "close"]].max(axis=1)
    body_low = frame[["open", "close"]].min(axis=1)
    frame["uwick"] = (frame.high - body_high) / candle_range
    frame["lwick"] = (body_low - frame.low) / candle_range
    frame["cpos"] = (frame.close - frame.low) / candle_range
    gap = frame.open_time.diff().eq(pd.Timedelta(minutes=15))
    frame["contig4"] = gap.rolling(4, min_periods=4).sum().eq(4)

    m = metrics.copy().sort_values("create_time")
    if m.empty:
        for column in [
            "oi_value", "oi_ret1", "oi_ret2", "oi_ret3", "oi_z3",
            "taker_log", "taker3", "retail_log", "retail_z",
            "top_position_log", "top_position_z", "top_account_log",
            "top_account_z", "top_retail_spread", "spread_z",
        ]:
            frame[column] = np.nan
        return frame

    m = m.set_index("create_time")
    aggregate = m.resample("15min", label="right", closed="right").agg(
        oi_value=("sum_open_interest_value", "last"),
        taker_ratio=("sum_taker_long_short_vol_ratio", "mean"),
        retail_ratio=("count_long_short_ratio", "last"),
        top_position_ratio=("sum_toptrader_long_short_ratio", "last"),
        top_account_ratio=("count_toptrader_long_short_ratio", "last"),
    ).dropna(subset=["oi_value"])
    aggregate = aggregate.reset_index().rename(columns={"create_time": "metric_time"})
    aggregate["oi_log"] = np.log(aggregate.oi_value.clip(lower=1))
    for periods in (1, 2, 3):
        aggregate[f"oi_ret{periods}"] = aggregate.oi_log.diff(periods)
    aggregate["oi_z3"] = zscore(aggregate.oi_ret3)
    aggregate["taker_log"] = np.log(aggregate.taker_ratio.clip(lower=1e-6))
    aggregate["taker3"] = aggregate.taker_log.rolling(3, min_periods=1).mean()
    aggregate["retail_log"] = np.log(aggregate.retail_ratio.clip(lower=1e-6))
    aggregate["retail_z"] = zscore(aggregate.retail_log)
    aggregate["top_position_log"] = np.log(aggregate.top_position_ratio.clip(lower=1e-6))
    aggregate["top_position_z"] = zscore(aggregate.top_position_log)
    aggregate["top_account_log"] = np.log(aggregate.top_account_ratio.clip(lower=1e-6))
    aggregate["top_account_z"] = zscore(aggregate.top_account_log)
    aggregate["top_retail_spread"] = aggregate.top_position_log - aggregate.retail_log
    aggregate["spread_z"] = zscore(aggregate.top_retail_spread)

    frame = pd.merge_asof(
        frame.sort_values("close_time_key"),
        aggregate.sort_values("metric_time"),
        left_on="close_time_key",
        right_on="metric_time",
        direction="backward",
        tolerance=pd.Timedelta(minutes=10),
    )
    return frame.sort_values("open_time").reset_index(drop=True)


def signal(frame: pd.DataFrame, config: Config) -> tuple[pd.Series, pd.Series]:
    side = config.side
    if config.mechanism == "oi_flush":
        if side == 1:
            mask = (
                frame.contig4
                & (frame.move3 <= -config.move)
                & (frame.oi_z3 <= config.oi_threshold)
                & (frame.lwick >= config.secondary)
                & (frame.cpos >= 0.55)
                & (frame.taker_log >= math.log(0.85))
            )
            strength = -frame.move3 - frame.oi_z3 + frame.lwick + frame.taker_log.clip(lower=0)
        else:
            mask = (
                frame.contig4
                & (frame.move3 >= config.move)
                & (frame.oi_z3 <= config.oi_threshold)
                & (frame.uwick >= config.secondary)
                & (frame.cpos <= 0.45)
                & (frame.taker_log <= math.log(1.15))
            )
            strength = frame.move3 - frame.oi_z3 + frame.uwick + (-frame.taker_log).clip(lower=0)
    elif config.mechanism == "oi_build":
        if side == 1:
            mask = (
                frame.contig4
                & (frame.move2 >= config.move)
                & (frame.oi_z3 >= config.oi_threshold)
                & (frame.taker3 >= config.secondary)
                & (frame.cpos >= 0.65)
                & (frame.retail_z <= 1.5)
            )
            strength = frame.move2 + frame.oi_z3 + frame.taker3.clip(lower=0)
        else:
            mask = (
                frame.contig4
                & (frame.move2 <= -config.move)
                & (frame.oi_z3 >= config.oi_threshold)
                & (frame.taker3 <= -config.secondary)
                & (frame.cpos <= 0.35)
                & (frame.retail_z >= -1.5)
            )
            strength = -frame.move2 + frame.oi_z3 + (-frame.taker3).clip(lower=0)
    elif config.mechanism == "oi_divergence":
        if side == 1:
            mask = (
                frame.contig4
                & (frame.move2 <= -config.move)
                & (frame.oi_z3 >= config.oi_threshold)
                & (frame.lwick >= 0.35)
                & (frame.cpos >= 0.55)
                & (frame.taker_log >= config.secondary)
            )
            strength = -frame.move2 + frame.oi_z3 + frame.lwick + frame.taker_log.clip(lower=0)
        else:
            mask = (
                frame.contig4
                & (frame.move2 >= config.move)
                & (frame.oi_z3 >= config.oi_threshold)
                & (frame.uwick >= 0.35)
                & (frame.cpos <= 0.45)
                & (frame.taker_log <= config.secondary)
            )
            strength = frame.move2 + frame.oi_z3 + frame.uwick + (-frame.taker_log).clip(lower=0)
    elif config.mechanism == "crowd_fade":
        if side == 1:
            mask = (
                frame.contig4
                & (frame.move1 <= -config.move)
                & (frame.retail_z <= config.oi_threshold)
                & (frame.spread_z >= config.secondary)
                & (frame.lwick >= 0.35)
                & (frame.cpos >= 0.55)
            )
            strength = -frame.move1 - frame.retail_z + frame.spread_z + frame.lwick
        else:
            mask = (
                frame.contig4
                & (frame.move1 >= config.move)
                & (frame.retail_z >= config.oi_threshold)
                & (frame.spread_z <= config.secondary)
                & (frame.uwick >= 0.35)
                & (frame.cpos <= 0.45)
            )
            strength = frame.move1 + frame.retail_z - frame.spread_z + frame.uwick
    else:
        raise ValueError(config.mechanism)
    return mask.fillna(False), strength.replace([np.inf, -np.inf], np.nan).fillna(0)


def crosses_funding(events_ns: np.ndarray, entry_ns: int, exit_ns: int) -> bool:
    if not len(events_ns):
        return False
    index = np.searchsorted(events_ns, entry_ns, side="left")
    return index < len(events_ns) and events_ns[index] <= exit_ns


def simulate_symbol(
    symbol: str,
    frame: pd.DataFrame,
    config: Config,
    start: pd.Timestamp,
    end: pd.Timestamp,
    funding: pd.DatetimeIndex,
) -> list[dict[str, object]]:
    mask, strength = signal(frame, config)
    timestamp_ns = frame.open_time.astype("int64").to_numpy()
    first = np.searchsorted(timestamp_ns, start.value)
    final = np.searchsorted(timestamp_ns, end.value)
    candidates = np.flatnonzero(
        mask.to_numpy()
        & (np.arange(len(frame)) >= first)
        & (np.arange(len(frame)) < final)
    )
    open_price = frame.open.to_numpy(float)
    high = frame.high.to_numpy(float)
    low = frame.low.to_numpy(float)
    atr_value = frame.atr.to_numpy(float)
    times = list(frame.open_time)
    events_ns = funding.astype("int64").to_numpy()
    output: list[dict[str, object]] = []
    last_exit = -1
    for signal_index in candidates:
        if signal_index <= last_exit or signal_index + 1 >= final:
            continue
        entry_index = signal_index + 1
        scheduled_exit = entry_index + config.hold
        if scheduled_exit >= final:
            continue
        if times[entry_index].date() != times[scheduled_exit].date():
            continue
        if crosses_funding(
            events_ns,
            int(timestamp_ns[entry_index]),
            int(timestamp_ns[scheduled_exit]),
        ):
            continue
        side = config.side
        entry = open_price[entry_index]
        atr_signal = atr_value[signal_index]
        if not np.isfinite(atr_signal):
            continue
        stop = entry - side * 1.5 * atr_signal
        target = entry + side * 3.0 * atr_signal
        exit_price = open_price[scheduled_exit]
        exit_index = scheduled_exit
        reason = "time"
        mae_bps = 0.0
        mfe_bps = 0.0
        for bar_index in range(entry_index, scheduled_exit):
            excursions = [
                side * (high[bar_index] / entry - 1) * 1e4,
                side * (low[bar_index] / entry - 1) * 1e4,
            ]
            mae_bps = min(mae_bps, *excursions)
            mfe_bps = max(mfe_bps, *excursions)
            if side == 1 and open_price[bar_index] <= stop:
                exit_price, exit_index, reason = open_price[bar_index], bar_index, "stop_gap"
                break
            if side == -1 and open_price[bar_index] >= stop:
                exit_price, exit_index, reason = open_price[bar_index], bar_index, "stop_gap"
                break
            if side == 1 and low[bar_index] <= stop:
                exit_price, exit_index, reason = stop, bar_index, "stop"
                break
            if side == -1 and high[bar_index] >= stop:
                exit_price, exit_index, reason = stop, bar_index, "stop"
                break
            if side == 1 and high[bar_index] >= target:
                exit_price, exit_index, reason = target, bar_index, "target"
                break
            if side == -1 and low[bar_index] <= target:
                exit_price, exit_index, reason = target, bar_index, "target"
                break
        gross_bps = side * (exit_price / entry - 1) * 1e4
        output.append({
            "config": config.name,
            "mechanism": config.mechanism,
            "symbol": symbol,
            "side": side,
            "signal_time": times[signal_index],
            "entry_time": times[entry_index],
            "exit_time": times[exit_index],
            "gross_bps": gross_bps,
            "net_bps": gross_bps - BASE_COST_BPS,
            "strength": float(strength.iloc[signal_index]),
            "reason": reason,
            "mae_bps": mae_bps,
            "mfe_bps": mfe_bps,
        })
        last_exit = exit_index
    return output


def select_portfolio_events(data: pd.DataFrame, topn: int = 4) -> pd.DataFrame:
    if data.empty:
        return data.copy()
    return (
        data.sort_values(["entry_time", "strength"], ascending=[True, False])
        .groupby("entry_time", group_keys=False)
        .head(topn)
        .sort_values("entry_time")
        .reset_index(drop=True)
    )


def metrics(data: pd.DataFrame, cost: float = BASE_COST_BPS) -> dict[str, float | int]:
    if data.empty:
        return {
            "trades": 0,
            "avg_bps": np.nan,
            "pf": np.nan,
            "win_rate": np.nan,
            "total_bps": 0.0,
            "symbols": 0,
        }
    values = data.gross_bps.to_numpy(float) - cost
    gains = values[values > 0]
    losses = -values[values < 0]
    return {
        "trades": int(len(values)),
        "avg_bps": float(values.mean()),
        "pf": float(gains.sum() / losses.sum()) if losses.sum() else float("inf"),
        "win_rate": float(np.mean(values > 0)),
        "total_bps": float(values.sum()),
        "symbols": int(data.symbol.nunique()),
        "best_bps": float(values.max()),
        "worst_bps": float(values.min()),
    }
