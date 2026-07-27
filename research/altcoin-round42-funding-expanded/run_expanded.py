#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

BASE_PATH = Path(__file__).resolve().parents[1] / "altcoin-round41-funding-carry" / "run.py"
spec = importlib.util.spec_from_file_location("round41_base", BASE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("cannot load round41 base")
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)

expanded = []
for mode in ("neutral", "short_positive", "long_negative"):
    for k in (2, 3, 5):
        for threshold in (0.25, 0.50, 1.0, 2.0, 3.0):
            for persistence in (False, True):
                name = (
                    f"{mode.upper()}_K{k}_T{str(threshold).replace('.', 'p')}_"
                    f"{'PERSIST' if persistence else 'RAW'}"
                )
                expanded.append(base.Config(name, mode, k, threshold, persistence))
base.CONFIGS = expanded

if __name__ == "__main__":
    base.main()
