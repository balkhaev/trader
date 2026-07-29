# Consensus WIF + DOT Risk Accelerator V1

## Safety status

The code is production-shaped but the strategy is still a forward-test hypothesis. Historical results were obtained in a large research program and are vulnerable to regime change. The scheduler is disabled unless `STRATEGY_SCHEDULER_ENABLED=true`.

Recommended rollout:

1. Binance USD-M testnet and shadow scans.
2. At least 30 new completed signals with real fees and slippage.
3. Both modules positive, portfolio PF ≥ 1.35, result positive without the three best trades.
4. Only then enable base risk. Boost remains conditional on +15% closed-equity profit at a new high-water.

## Data and timing

The server scanner uses Binance USD-M public endpoints:

- 15m contract klines;
- premium-index klines;
- 5m open-interest history;
- published funding rates;
- live futures ticker price.

All decisions are based on closed bars or an already-published funding event. There is no use of the next funding value.

## WIF module

Instrument: `WIFUSDT`. Direction: long. Timeframe: 15m.

Signal requirements:

```text
weekday UTC: Tuesday, Friday or Sunday
45m price move / ATR14 <= -2
log quote-volume z-score >= 1
lower wick / range >= 0.50
close location in range >= 0.60
taker imbalance >= -0.10
45m open-interest-change z-score <= -1
strength = abs(moveATR) + max(-oiZ,0)/2 + max(-premiumZ,0)/2 >= 3.5
```

Execution:

```text
entry: current market price immediately after the scanner confirms the closed bar
stop: entry - 1.25 ATR
take profit: entry + 5 * stop distance
maximum hold: 60 minutes
```

## DOT module

Instrument: `DOTUSDT`. Direction: long.

The entry window begins 15 minutes after the funding timestamp and ends after 30 minutes. Funding thresholds use Monday=0:

```text
Monday, Tuesday: funding <= -2.25 bps
Friday, Saturday, Sunday: funding <= -2.50 bps
Wednesday, Thursday: disabled
```

Execution:

```text
stop: entry - 6 ATR
take profit: entry + 2 * stop distance
maximum hold: 480 minutes
```

## Position sizing

The server obtains current exchange equity and open futures positions. Position notional is:

```text
notional = equity * target_stop_risk / (stop_distance_percent + cost_percent)
```

It is capped by:

- the strategy gross limit;
- the optional per-position USDT cap in auto-trading settings;
- one position per symbol;
- two total open positions.

The configured 20 bps round-turn cost is included in risk sizing, not subtracted only after the fact.

## Risk-state persistence

Runtime state is stored in the strategy JSON configuration:

- `initialEquity`;
- current `equity`;
- `highWaterEquity`;
- `lastDeriskHighWaterEquity`;
- `mode`: base, boost or stopped.

A stopped state is sticky. Reset it only after an explicit review by clearing runtime state or creating a new canonical strategy.

## Execution guarantees

For Binance USD-M:

1. Quantity and prices are rounded to exchange filters.
2. The entry order is submitted first.
3. Absolute `STOP_MARKET` and `TAKE_PROFIT_MARKET` close-position orders are submitted.
4. If protection placement fails, the service attempts to flatten the entry and returns an error.
5. The scheduler reconciles expired positions and sends a reduce-only market close after the maximum hold.

## Signal API

`POST /api/strategy/scan`

```json
{ "execute": false }
```

- `false`: create/return a shadow signal only;
- `true`: pass the signal into auto-trading execution.

Duplicate keys are based on module plus signal timestamp, so repeated scheduler ticks do not create repeated positions.
