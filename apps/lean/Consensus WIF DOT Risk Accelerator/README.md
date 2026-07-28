# Consensus WIF + DOT Risk Accelerator

LEAN research harness for the deterministic production strategy.

The live scanner in `apps/server/src/services/strategy` computes WIF OI/volume/premium features from Binance USD-M data and consumes already-known DOT funding observations. The LEAN project expects equivalent precomputed CSV inputs:

- `WIF_SIGNAL_CSV`: `timestamp,entry_price,atr,move45m_atr,volume_z,taker_imbalance,oi_z,premium_z,open,high,low,close`
- `DOT_FUNDING_CSV`: `timestamp,funding_time,funding_bps,entry_price,atr`

No future funding value is used. The project is a backtest/replay harness; live execution is handled by the server exchange service with absolute stop and take-profit orders.
