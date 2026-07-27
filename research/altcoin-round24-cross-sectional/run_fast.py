from __future__ import annotations

import pandas as pd

import run as base


def signal_events_fast(panel: pd.DataFrame, cfg: base.Config) -> pd.DataFrame:
    eligible = (
        panel.contig4.fillna(False)
        & panel.z.notna()
        & (panel.market_count >= 40)
    )
    if cfg.high_dispersion:
        eligible &= panel.market_std >= panel.dispersion_reference

    low = panel[eligible & (panel.z <= -cfg.threshold)].copy()
    high = panel[eligible & (panel.z >= cfg.threshold)].copy()
    if low.empty or high.empty:
        return pd.DataFrame()

    low["rank"] = low.groupby("open_time").z.rank(method="first", ascending=True)
    high["rank"] = high.groupby("open_time").z.rank(method="first", ascending=False)
    low = low[low["rank"] <= cfg.k]
    high = high[high["rank"] <= cfg.k]

    low_count = low.groupby("open_time").symbol.transform("count")
    high_count = high.groupby("open_time").symbol.transform("count")
    low = low[low_count >= cfg.k]
    high = high[high_count >= cfg.k]
    valid_times = pd.Index(low.open_time.unique()).intersection(high.open_time.unique())
    low = low[low.open_time.isin(valid_times)]
    high = high[high.open_time.isin(valid_times)]

    if cfg.mode == "reversal":
        low["side"] = 1
        high["side"] = -1
    else:
        low["side"] = -1
        high["side"] = 1
    selected = pd.concat([low, high], ignore_index=True)

    if cfg.flow_filter:
        long_ok = (selected.side == 1) & (selected.imb1 >= 0) & (selected.cpos >= 0.55)
        short_ok = (selected.side == -1) & (selected.imb1 <= 0) & (selected.cpos <= 0.45)
        selected = selected[long_ok | short_ok]
        side_counts = selected.groupby(["open_time", "side"]).symbol.size().unstack(fill_value=0)
        valid = side_counts.index[
            (side_counts.get(1, 0) >= 2) & (side_counts.get(-1, 0) >= 2)
        ]
        selected = selected[selected.open_time.isin(valid)]

    selected["event_time"] = selected.open_time
    selected["event_size"] = selected.groupby("event_time").symbol.transform("count")
    selected["strength"] = selected.z.abs() + selected.volz.clip(lower=0).fillna(0) / 4
    return selected.drop(columns=["rank"], errors="ignore").sort_values(
        ["event_time", "strength"], ascending=[True, False]
    ).reset_index(drop=True)


base.signal_events = signal_events_fast

if __name__ == "__main__":
    base.main()
