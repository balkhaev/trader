# Trader — Consensus WIF + DOT

Deterministic Binance USD-M trading platform for **Consensus WIF + DOT Risk Accelerator V1**.

The product contains one explicit strategy:

- **WIFUSDT OI Flush Reclaim** on closed 15-minute data;
- **DOTUSDT negative-funding rebound** using only an already-published funding rate;
- exchange-side stop-loss and take-profit orders;
- risk-based sizing with a 3× gross cap;
- base → boost → automatic de-risk → sticky hard-stop;
- Binance USD-M execution and a LEAN replay harness.

> This is a high-risk strategy. Historical 100% returns are not a forecast. Production defaults keep live Binance trading disabled until testnet and forward-validation gates are complete.

## Strategy

### WIFUSDT

Long only on Tuesday, Friday and Sunday after a 45-minute fall of at least 2 ATR with elevated volume, lower-wick reclaim, taker-flow confirmation, OI flush and strength of at least 3.5. Stop: 1.25 ATR. Target: 5R. Time exit: 60 minutes.

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

Full specification: [`docs/consensus-wif-dot.md`](docs/consensus-wif-dot.md).

## Local development

```bash
bun install
bun run db:push
bun run dev
```

- Web: `http://localhost:3001`
- API: `http://localhost:3000`

The web client uses same-origin `/api` by default. During local development Next proxies it to `http://localhost:3000`; `NEXT_PUBLIC_API_URL` remains available only as an explicit override.

## Production images

Every relevant push to `main` runs `.github/workflows/production.yml`:

1. strategy and Binance adapter tests;
2. full server/web/database TypeScript checks;
3. production Next.js build;
4. server and web Docker builds;
5. publication to:
   - `ghcr.io/balkhaev/trader-server:latest`;
   - `ghcr.io/balkhaev/trader-web:latest`;
   - immutable `sha-<commit>` tags.

## Production deployment

The included stack runs PostgreSQL, the Hono API, Next.js and Caddy with automatic TLS.

```bash
cp .env.production.example .env.production
# Set DOMAIN, PUBLIC_URL, POSTGRES_PASSWORD, BETTER_AUTH_SECRET and ENCRYPTION_KEY.

docker compose --env-file .env.production -f docker-compose.prod.yml pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d

docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

DNS for `DOMAIN` must point to the production host and ports 80/443 must be reachable. Caddy obtains and renews TLS certificates automatically.

The server applies the Drizzle schema before startup. PostgreSQL, Caddy data and certificates use persistent Docker volumes.

### Coolify deployment

`docker-compose.coolify.yml` is the production stack for the managed Coolify host. It omits Caddy because Coolify's Traefik proxy owns ports 80/443 and TLS. The stack keeps PostgreSQL private, persists its data, generates application secrets through Coolify magic variables, and leaves `ALLOW_LIVE_TRADING=false`.

The default images are pinned to the immutable SHA that passed the production pipeline. Update `SERVER_IMAGE` and `WEB_IMAGE` together for an explicit rollout, then deploy the same Compose resource.

### Safe rollout order

1. Keep `ALLOW_LIVE_TRADING=false`.
2. Connect a Binance Futures **Testnet** account.
3. Start a new Forward Validation epoch.
4. Verify fills, funding, fees, stops and reconciliation.
5. Enable the scheduler with `STRATEGY_SCHEDULER_ENABLED=true`.
6. Set `ALLOW_LIVE_TRADING=true` only after the forward gate passes and production secrets/backups have been reviewed.

## Verification

```bash
bun test apps/server/src/services/strategy/consensus-wif-dot.service.test.ts
bun test apps/server/src/services/exchange/binance.test.ts
bunx tsc -p apps/server/tsconfig.json --noEmit
bunx tsc -p apps/web/tsconfig.json --noEmit
bunx tsc -p packages/db/tsconfig.json --noEmit
bun run --cwd apps/web build
```

## Structure

```text
apps/server/src/services/strategy/   signal evaluation, market scan, scheduler
apps/server/src/services/exchange/   Binance USD-M adapter
apps/web/src/app/strategy-builder/   immutable strategy blueprint and risk envelope
apps/web/src/app/auto-trading/       preflight, emergency stop and execution logs
apps/web/src/app/validation/         explicit forward-validation epoch
apps/lean/Consensus WIF DOT Risk Accelerator/  replay harness
packages/db/src/schema/strategy.ts   canonical strategy configuration
Dockerfile                           server and web image targets
docker-compose.prod.yml              PostgreSQL + server + web + Caddy
```
