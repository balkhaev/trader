# AIMR intraday research backtest

A reproducible, conservative 5-minute backtest for BTCUSDT and ETHUSDT.

## Strategy

- long/flat Binance Spot, no leverage;
- next-bar-open execution after a completed-bar signal;
- 5m momentum breakout with completed 1h/4h regime filters;
- 5m failed-continuation mean reversion after a downside shock;
- ATR stops, fixed-R targets and time exits;
- 0.5% risk budget per trade, 50% maximum allocation per symbol;
- daily, weekly and hard-drawdown circuit breakers;
- stop-first treatment whenever stop and target are both touched in one bar.

## Data and periods

The runner downloads Binance Public monthly 5-minute archives for BTCUSDT and ETHUSDT from 2024-01 through 2026-06. It validates timestamps and OHLCV fields, records SHA-256 hashes and uses the following predeclared split:

- development: 2024-01-01 through 2024-12-31;
- validation: 2025-01-01 through 2025-06-30;
- untouched test: 2025-07-01 through 2026-06-30.

No parameter optimization is performed in this run.

## Cost scenarios

- low: 5 bps per side all-in;
- base: 10 bps per side all-in;
- stress: 20 bps per side all-in.

All-in cost means the combined fee and slippage assumption for one side of a trade.

## Run

```bash
python -m pip install -r research/aimr_intraday/requirements.txt
python research/aimr_intraday/bootstrap.py --self-test
python research/aimr_intraday/bootstrap.py \
  --output research/aimr_intraday/artifacts \
  --cache .cache/binance_vision
```

`bootstrap.py` verifies the compressed runner payload by SHA-256, reconstructs readable Python source, copies it into the output artifact and executes it.

## Research limitations

OHLCV data does not reveal bid/ask quotes, queue position or the within-bar order of the high and low. Costs are scenario assumptions. The implementation deliberately chooses the stop whenever one bar touches both stop and target. A positive historical result would still require paper-forward validation before any live deployment.
