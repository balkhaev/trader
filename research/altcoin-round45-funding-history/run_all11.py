#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
BASE_PATH = HERE.parent / "run_history.py"
spec = importlib.util.spec_from_file_location("funding_history_base", BASE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("cannot load funding history base")
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)

base.CONFIGS = [
    base.base.Config("LONG_NEGATIVE_K3_T0p5_PERSIST", "long_negative", 3, 0.5, True),
    base.base.Config("LONG_NEGATIVE_K2_T1p0_PERSIST", "long_negative", 2, 1.0, True),
    base.base.Config("SHORT_POSITIVE_K3_T0p5_RAW", "short_positive", 3, 0.5, False),
    base.base.Config("NEUTRAL_K3_T0p5_PERSIST", "neutral", 3, 0.5, True),
    base.base.Config("LONG_NEGATIVE_K3_T0p25_PERSIST", "long_negative", 3, 0.25, True),
    base.base.Config("SHORT_POSITIVE_K5_T1p0_RAW", "short_positive", 5, 1.0, False),
    base.base.Config("LONG_NEGATIVE_K2_T2p0_RAW", "long_negative", 2, 2.0, False),
    base.base.Config("LONG_NEGATIVE_K5_T1p0_PERSIST", "long_negative", 5, 1.0, True),
    base.base.Config("SHORT_POSITIVE_K5_T0p5_RAW", "short_positive", 5, 0.5, False),
    base.base.Config("SHORT_POSITIVE_K3_T1p0_RAW", "short_positive", 3, 1.0, False),
    base.base.Config("LONG_NEGATIVE_K2_T0p5_PERSIST", "long_negative", 2, 0.5, True),
]

if __name__ == "__main__":
    base.main()
