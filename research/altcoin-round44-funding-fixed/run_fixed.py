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

base.CONFIGS = [
    base.Config(
        "SHORT_POSITIVE_K3_T0p5_RAW",
        "short_positive",
        3,
        0.50,
        False,
    )
]

if __name__ == "__main__":
    base.main()
