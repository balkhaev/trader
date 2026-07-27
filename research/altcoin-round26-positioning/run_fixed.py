from __future__ import annotations

import pandas as pd

import data


def parse_time(values: pd.Series) -> pd.Series:
    numeric = pd.to_numeric(values, errors="coerce")
    # Raw metrics use human-readable UTC text; klines/funding use epoch values.
    if numeric.notna().mean() < 0.8:
        return pd.to_datetime(values, utc=True, errors="coerce")
    median = numeric.dropna().median()
    if pd.isna(median):
        return pd.to_datetime(values, utc=True, errors="coerce")
    unit = "us" if median > 1e14 else ("ms" if median > 1e11 else "s")
    return pd.to_datetime(numeric, unit=unit, utc=True, errors="coerce")


data.parse_time = parse_time

import run

if __name__ == "__main__":
    run.main()
