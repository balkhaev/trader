from __future__ import annotations

import hashlib
import itertools
import json
import math
from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

from config import COST_BPS, QUEUE_BPS


@dataclass(frozen=True)
class Rule:
    family: str
    params: dict[str, float | int]
    rule_id: str


@dataclass(frozen=True)
class Exec:
    passive: bool = False
    offset: float = 0.0
    hold: int = 12
    stop: float | None = None
    target: float | None = None
    cost: float = COST_BPS
    queue: float = QUEUE_BPS


def rules() -> list[Rule]:
    output: list[Rule] = []

    def add(family: str, params: dict[str, float | int]) -> None:
        encoded = json.dumps(params, sort_keys=True).encode()
        rule_id = family + "-" + hashlib.sha1(encoded).hexdigest()[:8]
        output.append(Rule(family, params, rule_id))

    for lookback, move, imbalance, volume_z, trend in itertools.product(
        [3, 6, 12], [1.0, 1.5, 2.0], [0.1, 0.2], [0.0, 0.75], [0, 1]
    ):
        add(
            "flow",
            {"lb": lookback, "move": move, "imb": imbalance, "vz": volume_z, "trend": trend},
        )
    for periods, vol_ratio, imbalance, trend in itertools.product(
        [12, 24, 48], [0.7, 0.85], [0.1, 0.2], [0, 1]
    ):
        add(
            "squeeze",
            {"n": periods, "vr": vol_ratio, "imb": imbalance, "trend": trend},
        )
    for periods, wick, imbalance in itertools.product([24, 48, 96], [0.4, 0.6], [0.0, 0.1]):
        add("sweep", {"n": periods, "wick": wick, "imb": imbalance})
    for lookback, move, volume_z, wick, imbalance in itertools.product(
        [3, 6], [1.5, 2.0], [0.75, 1.5], [0.4, 0.6], [0.0, 0.1]
    ):
        add(
            "exhaustion",
            {"lb": lookback, "move": move, "vz": volume_z, "wick": wick, "imb": imbalance},
        )
    for lookback, move, imbalance, vol_ratio in itertools.product(
        [6, 12], [0.5, 1.0], [0.0, 0.1], [0.8, 1.0]
    ):
        add(
            "pullback",
            {"lb": lookback, "move": move, "imb": imbalance, "vr": vol_ratio},
        )
    return output


def signal(frame: pd.DataFrame, rule: Rule) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    params = rule.params
    if rule.family == "flow":
        move = frame[f"move{params['lb']}"]
        long = (
            (move >= params["move"])
            & (frame.imb3 >= params["imb"])
            & (frame.volz >= params["vz"])
        )
        short = (
            (move <= -params["move"])
            & (frame.imb3 <= -params["imb"])
            & (frame.volz >= params["vz"])
        )
        if params["trend"]:
            long &= (frame.h1trend > 0) & (frame.h1pos > 0)
            short &= (frame.h1trend < 0) & (frame.h1pos < 0)
        strength = move.abs()
    elif rule.family == "squeeze":
        high = frame[f"hi{params['n']}"]
        low = frame[f"lo{params['n']}"]
        compressed = frame.volratio.shift(1) <= params["vr"]
        long = compressed & (frame.close > high) & (frame.imb3 >= params["imb"])
        short = compressed & (frame.close < low) & (frame.imb3 <= -params["imb"])
        if params["trend"]:
            long &= frame.h4trend >= 0
            short &= frame.h4trend <= 0
        strength = pd.concat(
            [(frame.close - high).abs(), (frame.close - low).abs()], axis=1
        ).max(axis=1) / frame.atr
    elif rule.family == "sweep":
        high = frame[f"hi{params['n']}"]
        low = frame[f"lo{params['n']}"]
        long = (
            (frame.low < low)
            & (frame.close > low)
            & (frame.lwick >= params["wick"])
            & (frame.imb1 >= params["imb"])
        )
        short = (
            (frame.high > high)
            & (frame.close < high)
            & (frame.uwick >= params["wick"])
            & (frame.imb1 <= -params["imb"])
        )
        strength = pd.concat(
            [(low - frame.low).clip(lower=0), (frame.high - high).clip(lower=0)], axis=1
        ).max(axis=1) / frame.atr
    elif rule.family == "exhaustion":
        move = frame[f"move{params['lb']}"]
        long = (
            (move <= -params["move"])
            & (frame.volz >= params["vz"])
            & (frame.lwick >= params["wick"])
            & (frame.cpos >= 0.55)
            & (frame.imb1 >= -params["imb"])
        )
        short = (
            (move >= params["move"])
            & (frame.volz >= params["vz"])
            & (frame.uwick >= params["wick"])
            & (frame.cpos <= 0.45)
            & (frame.imb1 <= params["imb"])
        )
        strength = move.abs() + frame.volz.clip(lower=0).fillna(0) / 3
    elif rule.family == "pullback":
        move = frame[f"move{params['lb']}"]
        active = frame.volratio >= params["vr"]
        long = (
            active
            & (frame.h1trend > 0)
            & (move >= params["move"])
            & (frame.low <= frame.ema20)
            & (frame.close > frame.ema20)
            & (frame.imb3 >= params["imb"])
        )
        short = (
            active
            & (frame.h1trend < 0)
            & (move <= -params["move"])
            & (frame.high >= frame.ema20)
            & (frame.close < frame.ema20)
            & (frame.imb3 <= -params["imb"])
        )
        strength = move.abs() + (frame.close - frame.ema20).abs() / frame.atr
    else:  # pragma: no cover - protected by fixed rule generator
        raise ValueError(f"unknown family: {rule.family}")
    return (
        long.fillna(False).to_numpy(),
        short.fillna(False).to_numpy(),
        strength.replace([np.inf, -np.inf], np.nan).fillna(0).to_numpy(float),
    )


def crosses_funding(
    funding_ns: np.ndarray,
    entry_ns: int,
    exit_ns: int,
) -> bool:
    if funding_ns.size == 0:
        return False
    index = np.searchsorted(funding_ns, entry_ns, side="left")
    return index < funding_ns.size and funding_ns[index] <= exit_ns


def simulate(
    symbol: str,
    frame: pd.DataFrame,
    rule: Rule,
    execution: Exec,
    start: pd.Timestamp,
    end: pd.Timestamp,
    funding_ns: np.ndarray | None = None,
    pre: tuple[np.ndarray, np.ndarray, np.ndarray] | None = None,
) -> list[dict[str, object]]:
    long_signal, short_signal, strength = pre if pre is not None else signal(frame, rule)
    timestamp_ns = frame.open_time.astype("int64").to_numpy()
    funding_ns = np.asarray(funding_ns if funding_ns is not None else [], dtype="int64")
    first = np.searchsorted(timestamp_ns, start.value)
    final = np.searchsorted(timestamp_ns, end.value)
    candidates = np.flatnonzero(
        (long_signal | short_signal)
        & (np.arange(len(frame)) >= first)
        & (np.arange(len(frame)) < final)
    )
    open_price = frame.open.to_numpy()
    high = frame.high.to_numpy()
    low = frame.low.to_numpy()
    close = frame.close.to_numpy()
    atr_value = frame.atr.to_numpy()
    timestamps = list(frame.open_time)
    trades: list[dict[str, object]] = []
    last_exit = -1
    for signal_index in candidates:
        if signal_index <= last_exit or signal_index + 1 >= final or not np.isfinite(atr_value[signal_index]):
            continue
        side = 1 if long_signal[signal_index] else -1
        entry_index = signal_index + 1
        entry_price = open_price[entry_index]
        if execution.passive:
            entry_price = close[signal_index] - side * execution.offset * atr_value[signal_index]
            if side == 1 and low[entry_index] > entry_price * (1 - execution.queue / 1e4):
                continue
            if side == -1 and high[entry_index] < entry_price * (1 + execution.queue / 1e4):
                continue
        scheduled_exit = entry_index + execution.hold
        if scheduled_exit >= final:
            continue
        if timestamps[entry_index].date() != timestamps[scheduled_exit].date():
            continue
        if crosses_funding(
            funding_ns,
            int(timestamp_ns[entry_index]),
            int(timestamp_ns[scheduled_exit]),
        ):
            continue
        stop_price = (
            None
            if execution.stop is None
            else entry_price - side * execution.stop * atr_value[signal_index]
        )
        risk = None if stop_price is None else abs(entry_price - stop_price)
        target_price = (
            None
            if execution.target is None or risk is None
            else entry_price + side * execution.target * risk
        )
        exit_price = open_price[scheduled_exit]
        exit_index = scheduled_exit
        exit_reason = "time"
        mae_bps = 0.0
        mfe_bps = 0.0
        for bar_index in range(entry_index, scheduled_exit):
            excursion = [
                side * (high[bar_index] / entry_price - 1) * 1e4,
                side * (low[bar_index] / entry_price - 1) * 1e4,
            ]
            mae_bps = min(mae_bps, *excursion)
            mfe_bps = max(mfe_bps, *excursion)
            if stop_price is not None:
                if side == 1 and open_price[bar_index] <= stop_price:
                    exit_price, exit_index, exit_reason = open_price[bar_index], bar_index, "stop_gap"
                    break
                if side == 1 and low[bar_index] <= stop_price:
                    exit_price, exit_index, exit_reason = stop_price, bar_index, "stop"
                    break
                if side == -1 and open_price[bar_index] >= stop_price:
                    exit_price, exit_index, exit_reason = open_price[bar_index], bar_index, "stop_gap"
                    break
                if side == -1 and high[bar_index] >= stop_price:
                    exit_price, exit_index, exit_reason = stop_price, bar_index, "stop"
                    break
            # Passive entry and profit target on the same OHLC bar are order-ambiguous.
            if target_price is not None and (not execution.passive or bar_index > entry_index):
                if side == 1 and high[bar_index] >= target_price:
                    exit_price, exit_index, exit_reason = target_price, bar_index, "target"
                    break
                if side == -1 and low[bar_index] <= target_price:
                    exit_price, exit_index, exit_reason = target_price, bar_index, "target"
                    break
        gross_bps = side * (exit_price / entry_price - 1) * 1e4
        trades.append(
            {
                "symbol": symbol,
                "family": rule.family,
                "rule_id": rule.rule_id,
                "side": side,
                "signal_time": timestamps[signal_index],
                "entry_time": timestamps[entry_index],
                "exit_time": timestamps[exit_index],
                "gross_bps": gross_bps,
                "net_bps": gross_bps - execution.cost,
                "strength": strength[signal_index],
                "reason": exit_reason,
                "mae_bps": mae_bps,
                "mfe_bps": mfe_bps,
            }
        )
        last_exit = exit_index
    return trades


def metrics(data: list[dict[str, object]] | pd.DataFrame) -> dict[str, float | int]:
    if isinstance(data, list):
        values = np.asarray([item["net_bps"] for item in data], dtype=float)
        symbols = [str(item["symbol"]) for item in data]
    else:
        values = data.net_bps.to_numpy(float)
        symbols = data.symbol.astype(str).tolist() if len(data) else []
    if not len(values):
        return {
            "trades": 0,
            "avg_bps": float("nan"),
            "pf": float("nan"),
            "win_rate": float("nan"),
            "total_bps": 0.0,
            "symbols": 0,
        }
    gains = float(values[values > 0].sum())
    losses = float(-values[values < 0].sum())
    return {
        "trades": int(len(values)),
        "avg_bps": float(values.mean()),
        "pf": float(gains / losses) if losses else float("inf"),
        "win_rate": float(np.mean(values > 0)),
        "total_bps": float(values.sum()),
        "symbols": int(len(set(symbols))),
    }


def score(data: list[dict[str, object]], min_trades: int = 200) -> tuple[float, dict[str, float | int]]:
    result = metrics(data)
    if result["trades"] < min_trades:
        return -1e9, result
    by_symbol: dict[str, list[float]] = {}
    for item in data:
        by_symbol.setdefault(str(item["symbol"]), []).append(float(item["net_bps"]))
    eligible = [values for values in by_symbol.values() if len(values) >= 6]
    breadth = float(np.mean([np.mean(values) > 0 for values in eligible])) if eligible else 0.0
    result["breadth"] = breadth
    profit_factor = float(result["pf"])
    clipped_pf = min(profit_factor, 4.0) if np.isfinite(profit_factor) else 4.0
    ranking = (
        float(result["avg_bps"]) * math.sqrt(float(result["trades"]) / 500)
        + 10 * (breadth - 0.5)
        + 3 * math.log(max(clipped_pf, 0.2))
    )
    return ranking, result


def executions() -> list[Exec]:
    output: list[Exec] = []
    for passive, offset, hold, stop, target in itertools.product(
        [0, 1], [0.15, 0.25], [6, 12, 18], [None, 2.0], [None, 2.0]
    ):
        if not passive and offset != 0.15:
            continue
        output.append(
            Exec(
                passive=bool(passive),
                offset=offset if passive else 0.0,
                hold=hold,
                stop=stop,
                target=target,
            )
        )
    return output
