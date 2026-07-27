from __future__ import annotations

import pandas as pd

SYMBOLS = [
    "SOLUSDT", "XRPUSDT", "DOGEUSDT", "BNBUSDT", "SUIUSDT",
    "1000PEPEUSDT", "ADAUSDT", "ENAUSDT", "LINKUSDT", "AVAXUSDT",
    "LTCUSDT", "ZECUSDT", "PENGUUSDT", "BCHUSDT", "WIFUSDT",
    "AAVEUSDT", "UNIUSDT", "TRUMPUSDT", "DOTUSDT", "1000BONKUSDT",
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
PREMIUM_MONTHLY = "https://data.binance.vision/data/futures/um/monthly/premiumIndexKlines"
PREMIUM_DAILY = "https://data.binance.vision/data/futures/um/daily/premiumIndexKlines"
FUNDING_MONTHLY = "https://data.binance.vision/data/futures/um/monthly/fundingRate"
FUNDING_ENDPOINTS = [
    "https://fapi.binance.com/fapi/v1/fundingRate",
    "https://fapi1.binance.com/fapi/v1/fundingRate",
    "https://fapi2.binance.com/fapi/v1/fundingRate",
    "https://fapi3.binance.com/fapi/v1/fundingRate",
    "https://fapi4.binance.com/fapi/v1/fundingRate",
]
