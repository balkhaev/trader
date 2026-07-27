from __future__ import annotations

import numpy as np
import pandas as pd


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
    return true_range.ewm(alpha=1 / periods, adjust=False, min_periods=periods).mean()


def mtf(frame: pd.DataFrame, frequency: str) -> pd.DataFrame:
    close_index = frame.open_time + pd.Timedelta(minutes=5)
    higher = (
        frame.set_index(close_index)
        .resample(frequency, label="right", closed="right")
        .agg(open=("open", "first"), high=("high", "max"), low=("low", "min"), close=("close", "last"))
        .dropna()
    )
    ema20 = higher.close.ewm(span=20, adjust=False, min_periods=20).mean()
    ema50 = higher.close.ewm(span=50, adjust=False, min_periods=50).mean()
    context = pd.DataFrame(
        {
            "trend": np.sign(ema20 - ema50),
            "position": np.sign(higher.close - ema20),
        }
    )
    context = context.reindex(close_index, method="ffill")
    context.index = frame.index
    return context


def build(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.copy()
    numeric = ["open", "high", "low", "close", "volume", "quote_volume", "taker_buy_base"]
    for column in numeric:
        frame[column] = pd.to_numeric(frame[column], errors="coerce", downcast="float")
    frame["atr"] = atr(frame)
    frame["atr_pct"] = frame.atr / frame.close
    frame["ema20"] = frame.close.ewm(span=20, adjust=False, min_periods=20).mean()
    frame["ema50"] = frame.close.ewm(span=50, adjust=False, min_periods=50).mean()
    for periods in [3, 6, 12]:
        frame[f"move{periods}"] = frame.close.pct_change(periods) / frame.atr_pct.replace(0, np.nan)
    imbalance = (
        2 * frame.taker_buy_base / frame.volume.replace(0, np.nan) - 1
    ).clip(-1, 1).fillna(0)
    frame["imb1"] = imbalance
    frame["imb3"] = imbalance.rolling(3).mean()
    log_volume = np.log1p(frame.quote_volume.clip(lower=0))
    mean = log_volume.rolling(288, min_periods=72).mean()
    std = log_volume.rolling(288, min_periods=72).std().replace(0, np.nan)
    frame["volz"] = (log_volume - mean) / std
    returns = np.log(frame.close).diff()
    realized = returns.rolling(24).std()
    frame["volratio"] = realized / realized.rolling(2016, min_periods=576).median().replace(0, np.nan)
    candle_range = (frame.high - frame.low).replace(0, np.nan)
    body_high = frame[["open", "close"]].max(axis=1)
    body_low = frame[["open", "close"]].min(axis=1)
    frame["uwick"] = (frame.high - body_high) / candle_range
    frame["lwick"] = (body_low - frame.low) / candle_range
    frame["cpos"] = (frame.close - frame.low) / candle_range
    for periods in [12, 24, 48, 96]:
        frame[f"hi{periods}"] = frame.high.rolling(periods).max().shift()
        frame[f"lo{periods}"] = frame.low.rolling(periods).min().shift()
    h1 = mtf(frame, "1h")
    h4 = mtf(frame, "4h")
    frame["h1trend"] = h1.trend.to_numpy()
    frame["h1pos"] = h1.position.to_numpy()
    frame["h4trend"] = h4.trend.to_numpy()
    return frame
