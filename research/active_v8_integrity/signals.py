from __future__ import annotations

import numpy as np
import pandas as pd

from config import V7_HEDGE_COMPONENTS, V8_COMPONENTS, V8_OVERLAY_SCALE


def _schedule(desired: pd.DataFrame, every: int, immediate_exit: bool = True) -> pd.DataFrame:
    output = np.zeros_like(desired.to_numpy(float))
    current = np.zeros(desired.shape[1], dtype=float)
    for index, row in enumerate(desired.to_numpy(float)):
        row = np.nan_to_num(row)
        if immediate_exit:
            current[(np.abs(current) > 1e-15) & (np.abs(row) <= 1e-15)] = 0.0
        if index % every == 0 and np.abs(row - current).sum() > 1e-12:
            current = row.copy()
        output[index] = current
    return pd.DataFrame(output, index=desired.index, columns=desired.columns)


def _relative_component(perp_close: pd.DataFrame, spec: dict[str, float | int]) -> pd.DataFrame:
    btc, eth = "BTCUSDT", "ETHUSDT"
    ratio = np.log(perp_close[eth] / perp_close[btc])
    momentum = ratio.diff(int(spec["lookback_days"]))
    spread_return = 0.5 * (perp_close[eth].pct_change() - perp_close[btc].pct_change())
    spread_vol = spread_return.rolling(int(spec["vol_days"]), min_periods=int(spec["vol_days"])).std().shift(1) * np.sqrt(365.0)
    direction = np.zeros(len(perp_close), dtype=float)
    state = 0.0
    threshold = float(spec["threshold"])
    for index, value in enumerate(momentum.to_numpy(float)):
        if not np.isfinite(value):
            state = 0.0
        elif value > threshold:
            state = 1.0
        elif value < -threshold:
            state = -1.0
        direction[index] = state
    gross = (float(spec["target_vol"]) / spread_vol.replace(0.0, np.nan)).clip(upper=float(spec["max_gross"])).fillna(0.0)
    desired = pd.DataFrame(0.0, index=perp_close.index, columns=[btc, eth])
    desired[btc] = -0.5 * direction * gross
    desired[eth] = 0.5 * direction * gross
    return _schedule(desired, int(spec["rebalance_days"]), immediate_exit=False)


def build_v8_relative(perp_close: pd.DataFrame) -> pd.DataFrame:
    components = [_relative_component(perp_close, dict(spec)) for spec in V8_COMPONENTS]
    return sum(components) / len(components)
