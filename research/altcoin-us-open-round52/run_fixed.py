#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve()
BASE_PATH = HERE.parent / "run.py"
spec = importlib.util.spec_from_file_location("us_open_base", BASE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("cannot load US-open base")
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)

original_load_symbol = base.load_symbol


def load_symbol_with_atr(symbol, manifest):
    frame, funding = original_load_symbol(symbol, manifest)
    if len(frame):
        frame = frame.copy()
        for column in ("open", "high", "low", "close", "volume", "quote_volume"):
            frame[column] = pd.to_numeric(frame[column], errors="coerce")
        frame["atr"] = base.atr(frame)
    return frame, funding


base.load_symbol = load_symbol_with_atr

if __name__ == "__main__":
    base.main()
