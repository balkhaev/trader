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
    threshold: float
    hold: int
    strict: bool


CONFIGS = [
    Config("PREMIUM_FADE_LONG45", "premium_fade", 1, 1.5, 3, False),
    Config("PREMIUM_FADE_LONG60_STRICT", "premium_fade", 1, 2.0, 4, True),
    Config("PREMIUM_FADE_SHORT45", "premium_fade", -1, 1.5, 3, False),
    Config("PREMIUM_FADE_SHORT60_STRICT", "premium_fade", -1, 2.0, 4, True),
    Config("PREMIUM_MOM_LONG45", "premium_momentum", 1, 1.0, 3, False),
    Config("PREMIUM_MOM_LONG60_STRICT", "premium_momentum", 1, 1.5, 4, True),
    Config("PREMIUM_MOM_SHORT45", "premium_momentum", -1, 1.0, 3, False),
    Config("PREMIUM_MOM_SHORT60_STRICT", "premium_momentum", -1, 1.5, 4, True),
    Config("POST_FUND_FADE_LONG45", "post_funding", 1, 1.25, 3, False),
    Config("POST_FUND_FADE_LONG60_STRICT", "post_funding", 1, 1.75, 4, True),
    Config("POST_FUND_FADE_SHORT45", "post_funding", -1, 1.25, 3, False),
    Config("POST_FUND_FADE_SHORT60_STRICT", "post_funding", -1, 1.75, 4, True),
    Config("FUND_PREMIUM_DIV_LONG45", "funding_divergence", 1, 1.25, 3, False),
    Config("FUND_PREMIUM_DIV_SHORT45", "funding_divergence", -1, 1.25, 3, False),
]


def atr(frame: pd.DataFrame, periods: int = 14) -> pd.Series:
    previous = frame.close.shift()
    tr = pd.concat(
        [
            frame.high - frame.low,
            (frame.high - previous).abs(),
            (frame.low - previous).abs(),
        ], axis=1,
    ).max(axis=1)
    return tr.ewm(alpha=1 / periods, adjust=False, min_periods=periods).mean()


def zscore(series: pd.Series, window: int, minimum: int) -> pd.Series:
    mean = series.rolling(window, min_periods=minimum).mean()
    std = series.rolling(window, min_periods=minimum).std().replace(0, np.nan)
    return (series - mean) / std


def build_features(
    klines: pd.DataFrame,
    premium: pd.DataFrame,
    funding: pd.DataFrame,
) -> pd.DataFrame:
    frame = klines.copy().sort_values("open_time").reset_index(drop=True)
    for column in ["open", "high", "low", "close", "volume", "quote_volume", "taker_buy_base"]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
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
    frame["imbalance"] = (
        2 * frame.taker_buy_base / frame.volume.replace(0, np.nan) - 1
    ).clip(-1, 1).fillna(0)
    gap = frame.open_time.diff().eq(pd.Timedelta(minutes=15))
    frame["contig4"] = gap.rolling(4, min_periods=4).sum().eq(4)

    premium_frame = premium[["open_time", "close"]].copy().rename(columns={"close": "premium"})
    premium_frame.premium = pd.to_numeric(premium_frame.premium, errors="coerce")
    frame = frame.merge(premium_frame, on="open_time", how="left")
    frame["premium_z"] = zscore(frame.premium, 672, 192)
    frame["premium_delta1"] = frame.premium.diff()
    frame["premium_delta3"] = frame.premium.diff(3)
    frame["premium_change_z"] = zscore(frame.premium_delta3, 672, 192)

    events = funding.copy().sort_values("funding_time").reset_index(drop=True)
    events["funding_z"] = zscore(events.funding_rate, 30, 15)
    events["funding_abs_z"] = zscore(events.funding_rate.abs(), 30, 15)
    frame["close_time_key"] = frame.open_time + pd.Timedelta(minutes=15)
    frame = pd.merge_asof(
        frame.sort_values("close_time_key"),
        events,
        left_on="close_time_key",
        right_on="funding_time",
        direction="backward",
    )
    frame["minutes_since_funding"] = (
        frame.close_time_key - frame.funding_time
    ).dt.total_seconds() / 60
    frame["just_funded"] = frame.minutes_since_funding.between(0, 20)
    return frame.sort_values("open_time").reset_index(drop=True)


def signal(frame: pd.DataFrame, config: Config) -> tuple[pd.Series, pd.Series]:
    side = config.side
    strict_wick = 0.50 if config.strict else 0.35
    strict_position = 0.65 if config.strict else 0.55
    if config.mechanism == "premium_fade":
        if side == 1:
            mask = (
                frame.contig4
                & (frame.premium_z <= -config.threshold)
                & (frame.premium_delta1 > 0)
                & (frame.move1 <= -0.25)
                & (frame.lwick >= strict_wick)
                & (frame.cpos >= strict_position)
            )
            strength = -frame.premium_z + frame.lwick + frame.cpos
        else:
            mask = (
                frame.contig4
                & (frame.premium_z >= config.threshold)
                & (frame.premium_delta1 < 0)
                & (frame.move1 >= 0.25)
                & (frame.uwick >= strict_wick)
                & (frame.cpos <= 1 - strict_position)
            )
            strength = frame.premium_z + frame.uwick + (1 - frame.cpos)
    elif config.mechanism == "premium_momentum":
        if side == 1:
            mask = (
                frame.contig4
                & (frame.premium_z >= config.threshold)
                & (frame.premium_delta3 > 0)
                & (frame.move2 >= (1.0 if config.strict else 0.5))
                & (frame.imbalance >= (0.15 if config.strict else 0.05))
                & (frame.cpos >= (0.70 if config.strict else 0.60))
            )
            strength = frame.premium_z + frame.move2 + frame.imbalance
        else:
            mask = (
                frame.contig4
                & (frame.premium_z <= -config.threshold)
                & (frame.premium_delta3 < 0)
                & (frame.move2 <= -(1.0 if config.strict else 0.5))
                & (frame.imbalance <= -(0.15 if config.strict else 0.05))
                & (frame.cpos <= (0.30 if config.strict else 0.40))
            )
            strength = -frame.premium_z - frame.move2 - frame.imbalance
    elif config.mechanism == "post_funding":
        if side == 1:
            mask = (
                frame.contig4
                & frame.just_funded
                & (frame.funding_z <= -config.threshold)
                & (frame.premium_delta1 >= 0)
                & (frame.cpos >= (0.60 if config.strict else 0.50))
            )
            strength = -frame.funding_z - frame.premium_z.clip(upper=0) + frame.cpos
        else:
            mask = (
                frame.contig4
                & frame.just_funded
                & (frame.funding_z >= config.threshold)
                & (frame.premium_delta1 <= 0)
                & (frame.cpos <= (0.40 if config.strict else 0.50))
            )
            strength = frame.funding_z + frame.premium_z.clip(lower=0) + (1 - frame.cpos)
    elif config.mechanism == "funding_divergence":
        if side == 1:
            mask = (
                frame.contig4
                & (frame.funding_z <= -config.threshold)
                & (frame.premium_z >= -0.5)
                & (frame.move1 <= -0.25)
                & (frame.lwick >= 0.35)
                & (frame.cpos >= 0.55)
            )
            strength = -frame.funding_z + frame.premium_z + frame.lwick
        else:
            mask = (
                frame.contig4
                & (frame.funding_z >= config.threshold)
                & (frame.premium_z <= 0.5)
                & (frame.move1 >= 0.25)
                & (frame.uwick >= 0.35)
                & (frame.cpos <= 0.45)
            )
            strength = frame.funding_z - frame.premium_z + frame.uwick
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
    funding: pd.DataFrame,
) -> list[dict[str, object]]:
    mask, strength = signal(frame, config)
    timestamps_ns = frame.open_time.astype("int64").to_numpy()
    first = np.searchsorted(timestamps_ns, start.value)
    final = np.searchsorted(timestamps_ns, end.value)
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
    funding_ns = funding.funding_time.astype("int64").to_numpy()
    output: list[dict[str, object]] = []
    last_exit = -1
    for signal_index in candidates:
        if signal_index <= last_exit or signal_index + 1 >= final:
            continue
        entry_index = signal_index + 1
        scheduled = entry_index + config.hold
        if scheduled >= final:
            continue
        if times[entry_index].date() != times[scheduled].date():
            continue
        if crosses_funding(
            funding_ns,
            int(timestamps_ns[entry_index]),
            int(timestamps_ns[scheduled]),
        ):
            continue
        entry = open_price[entry_index]
        atr_signal = atr_value[signal_index]
        if not np.isfinite(atr_signal):
            continue
        side = config.side
        stop = entry - side * 1.5 * atr_signal
        target = entry + side * 3.0 * atr_signal
        exit_price = open_price[scheduled]
        exit_index = scheduled
        reason = "time"
        mae_bps = 0.0
        mfe_bps = 0.0
        for bar_index in range(entry_index, scheduled):
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


def select_events(data: pd.DataFrame, topn: int = 5) -> pd.DataFrame:
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
        return {"trades": 0, "avg_bps": np.nan, "pf": np.nan, "win_rate": np.nan, "total_bps": 0.0, "symbols": 0}
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
