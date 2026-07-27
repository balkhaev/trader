from __future__ import annotations

import pandas as pd

KLINE_BASE = "https://data.binance.vision/data/futures/um/monthly/klines"
FUNDING_BASE = "https://data.binance.vision/data/futures/um/monthly/fundingRate"
EXCHANGE_INFO_HOSTS = [
    "https://fapi.binance.com/fapi/v1/exchangeInfo",
    "https://fapi1.binance.com/fapi/v1/exchangeInfo",
    "https://fapi2.binance.com/fapi/v1/exchangeInfo",
    "https://fapi3.binance.com/fapi/v1/exchangeInfo",
    "https://fapi4.binance.com/fapi/v1/exchangeInfo",
]
INTERVAL = "5m"
START = pd.Timestamp("2024-01-01", tz="UTC")
END = pd.Timestamp("2026-07-01", tz="UTC")
COST_BPS = 12.0
STRESS_COST_BPS = 20.0
QUEUE_BPS = 1.0

# Fixed before the run. BTC/ETH are intentionally excluded from candidate ranking.
SYMBOLS = [
    "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT",
    "AVAXUSDT", "LINKUSDT", "DOTUSDT", "LTCUSDT", "BCHUSDT",
    "TRXUSDT", "ETCUSDT", "NEARUSDT", "ATOMUSDT", "APTUSDT",
    "ARBUSDT", "OPUSDT", "SUIUSDT", "INJUSDT", "TIAUSDT",
    "SEIUSDT", "AAVEUSDT", "UNIUSDT", "FILUSDT", "WLDUSDT",
    "1000PEPEUSDT", "1000BONKUSDT", "1000SHIBUSDT", "STXUSDT",
    "ICPUSDT", "IMXUSDT", "GALAUSDT", "SANDUSDT", "RUNEUSDT",
    "FETUSDT", "RENDERUSDT",
]

PERIODS = {
    "2024": (pd.Timestamp("2024-01-01", tz="UTC"), pd.Timestamp("2025-01-01", tz="UTC")),
    "2025": (pd.Timestamp("2025-01-01", tz="UTC"), pd.Timestamp("2026-01-01", tz="UTC")),
    "2026H1": (pd.Timestamp("2026-01-01", tz="UTC"), pd.Timestamp("2026-07-01", tz="UTC")),
}
