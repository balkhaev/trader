# HF90 official fresh replay — Round 32

This workflow runs the frozen `HF90_PASSIVE_FORECAST_V2` model without retraining.

- Binance USD-M BTCUSDT and ETHUSDT monthly 5m klines.
- Official monthly fundingRate archives.
- Period: 2024-09-01 through 2026-06-30.
- Every ZIP is verified against the adjacent SHA-256 `.CHECKSUM`.
- Base execution: 12 bps round trip, 1 bp queue penetration.
- Stress execution: 16 bps, 3 bp queue penetration.
- Frozen 77 features, 15 bps signal threshold, passive 0.20 ATR entry and 90-minute exit.
- The artifact includes trades, bootstrap, calendar blocks, account scenarios and the preregistered PASS matrix.

No API keys or trading endpoints are used.
