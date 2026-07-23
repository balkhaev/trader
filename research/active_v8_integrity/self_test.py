#!/usr/bin/env python3
from __future__ import annotations

import hashlib
from pathlib import Path
import sys

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from signals import build_v8_relative

EXPECTED_SIGNAL_SHA256 = "4f3e56633b7470005afb9e27e178dc8db1fd58f3429d46952c69ce977a860fea"


def main() -> int:
    source_hash = hashlib.sha256((ROOT / "signals.py").read_bytes()).hexdigest()
    if source_hash != EXPECTED_SIGNAL_SHA256:
        raise SystemExit(f"unexpected signals.py hash: {source_hash}")

    index = pd.date_range("2020-01-01", periods=500, freq="1D", tz="UTC")
    btc = pd.Series(np.exp(np.linspace(8.0, 9.0, len(index))), index=index)
    eth = pd.Series(np.exp(np.linspace(6.0, 7.3, len(index))), index=index)
    close = pd.DataFrame({"BTCUSDT": btc, "ETHUSDT": eth})
    signal = build_v8_relative(close)
    assert signal.index.equals(index)
    assert list(signal.columns) == ["BTCUSDT", "ETHUSDT"]
    assert np.isfinite(signal.to_numpy()).all()
    assert float(signal.abs().sum(axis=1).max()) <= 1.000001

    changed = close.copy()
    changed.iloc[-1, 1] *= 10.0
    second = build_v8_relative(changed)
    pd.testing.assert_frame_equal(signal.iloc[:-1], second.iloc[:-1])
    print("Active V8 deterministic no-look-ahead self-test passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
