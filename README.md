# Trader — Consensus WIF + DOT

Deterministic Binance USD-M trading platform for the researched **Consensus WIF + DOT Risk Accelerator V1** strategy.

The previous generic indicator builder and SMA example are replaced by one explicit production strategy:

- **WIFUSDT OI Flush Reclaim** on closed 15-minute data;
- **DOTUSDT negative-funding rebound** using only an already-published funding rate;
- absolute exchange stop-loss and take-profit orders;
- risk-based position sizing with a 3× portfolio gross cap;
- base → boost → automatic de-risk → hard-stop state machine;
- optional scheduler, disabled by default;
- Binance USD-M REST execution plus a LEAN replay harness.

> This repository implements a high-risk research strategy. Historical 100% returns are not a guarantee. Start on Binance testnet and keep `STRATEGY_SCHEDULER_ENABLED` disabled until the data pipeline and executions are verified.

## Strategy summary

### WIFUSDT

Long only on Tuesday, Friday and Sunday after a 45-minute fall of at least 2 ATR with elevated volume, lower-wick reclaim, non-worsening taker flow, OI flush and total strength of at least 3.5. Stop: 1.25 ATR. Target: 5R. Time exit: 60 minutes.

### DOTUSDT

Long 15 minutes after an already-known negative funding event. Mon/Tue threshold: -2.25 bps; Fri/Sat/Sun: -2.50 bps. Stop: 6 ATR. Target: 2R. Time exit: 8 hours.

### Risk Accelerator

| State | WIF stop-risk | DOT stop-risk |
|---|---:|---:|
| Base | 3% | 5% |
| Boost after +15% at a new high-water | 7.5% | 10% |
| De-risk after 8% drawdown | back to base | back to base |
| Hard stop after 15% drawdown | no new positions | no new positions |

Maximum open positions: 2. Maximum gross notional: 3× equity.

Full operating specification: [`docs/consensus-wif-dot.md`](docs/consensus-wif-dot.md).

## Stack

- Bun + Turborepo
- TypeScript
- Next.js / React
- Hono
- Drizzle / PostgreSQL
- Binance USD-M REST API
- QuantConnect LEAN replay harness

## Setup

```bash
bun install
bun run db:push
bun run dev
```

Web: `http://localhost:3001`
API: `http://localhost:3000`

Add a **Binance** exchange account in testnet mode, open `/strategy-builder`, activate the canonical strategy, and configure execution in `/auto-trading`.

The scheduler is deliberately opt-in:

```bash
STRATEGY_SCHEDULER_ENABLED=true bun run dev:server
```

Without this variable, use the **Shadow scan** button or call:

```bash
curl -X POST http://localhost:3000/api/strategy/scan \
  -H 'Content-Type: application/json' \
  -d '{"execute":false}'
```

## Verification

```bash
bun run check-types
bun run test:strategy
```

## Project structure

```text
apps/server/src/services/strategy/   signal evaluation, market scan, scheduler
apps/server/src/services/exchange/   Binance USD-M / Bybit adapters
apps/web/src/app/strategy-builder/   fixed strategy control panel
apps/web/src/app/auto-trading/       execution guardrails and logs
apps/lean/Consensus WIF DOT Risk Accelerator/  replay harness
packages/db/src/schema/strategy.ts   canonical strategy configuration
```
