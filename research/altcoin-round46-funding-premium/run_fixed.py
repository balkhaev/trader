#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve()
BASE_PATH = HERE.parent / "run.py"
spec = importlib.util.spec_from_file_location("funding_premium_base", BASE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("cannot load funding premium base")
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)

original_simulate = base.simulate


def simulate_with_atr(all_events, prices, funding, cfg, start, end):
    enriched = {}
    for symbol, frame in prices.items():
        x = frame.copy()
        for column in ("open", "high", "low", "close", "volume", "quote_volume"):
            x[column] = pd.to_numeric(x[column], errors="coerce")
        if "atr" not in x:
            x["atr"] = base.atr(x)
        enriched[symbol] = x
    return original_simulate(all_events, enriched, funding, cfg, start, end)


base.simulate = simulate_with_atr

if __name__ == "__main__":
    base.main()
