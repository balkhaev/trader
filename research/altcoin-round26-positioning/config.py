from __future__ import annotations

import pandas as pd

SYMBOLS = [
    "SOLUSDT", "XRPUSDT", "DOGEUSDT", "BNBUSDT", "SUIUSDT",
    "1000PEPEUSDT", "ADAUSDT", "ENAUSDT", "LINKUSDT", "AVAXUSDT",
    "LTCUSDT", "ZECUSDT", "PENGUUSDT", "BCHUSDT", "WIFUSDT",
]

WARMUP_START = pd.Timestamp("2025-06-01", tz="UTC")
START = pd.Timestamp("2025-07-01", tz="UTC")
CUT = pd.Timestamp("2026-01-01", tz="UTC")
PRE_JULY_END = pd.Timestamp("2026-07-01", tz="UTC")
JULY_END = pd.Timestamp("2026-07-27", tz="UTC")

INTERVAL = "15m"
BASE_COST_BPS = 12.0
STRESS_COST_BPS = 20.0

KLINE_MONTHLY = "https://data.binance.vision/data/futures/um/monthly/klines"
KLINE_DAILY = "https://data.binance.vision/data/futures/um/daily/klines"
FUNDING_MONTHLY = "https://data.binance.vision/data/futures/um/monthly/fundingRate"
METRICS_DAILY = "https://data.binance.vision/data/futures/um/daily/metrics"
