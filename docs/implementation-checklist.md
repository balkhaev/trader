# Implementation Checklist: Trader 2.0

## Overview

Реализация разбита на 4 фазы. Каждая фаза — это MVP следующего уровня.

```
Phase 1 (2 недели)  → Foundation: DB + базовые API
Phase 2 (3 недели)  → Agent MVP: 3 предустановленных агента
Phase 3 (3 недели)  → Prediction Factory: генерация и торговля
Phase 4 (2 недели)  → Integration: агенты торгуют на markets
```

---

## Phase 1: Foundation (2 недели) ✅ COMPLETED

### 1.1 Database Schema ✅

- [x] Создать enum'ы для agents и markets

  - `agent_status`: backtesting, active, paused, archived
  - `allocation_status`: active, withdrawn
  - `trade_status`: open, closed, cancelled
  - `market_category`: macro, crypto, corporate, geo, commodity
  - `market_status`: pending, active, resolved, cancelled
  - `market_outcome`: yes, no, cancelled
  - `creation_type`: ai, user

- [x] Создать таблицу `agent`

  - Базовые поля (id, name, slug, description)
  - Strategy config (JSONB)
  - Performance metrics
  - Timestamps

- [x] Создать таблицу `agent_allocation`

  - Связь user → agent
  - Amount, status, PnL tracking

- [x] Создать таблицу `agent_trade`

  - Детали сделки
  - Reasoning (LLM explanation)
  - Data sources (JSONB)

- [x] Создать таблицу `prediction_market`

  - Question, description
  - Pricing (yes_price)
  - Resolution fields
  - Source article reference

- [x] Создать таблицу `market_position`

  - User/agent positions
  - Side (yes/no), shares, avg_price

- [x] Создать таблицу `market_trade`

  - Trade history

- [x] Создать миграцию
- [x] Обновить Drizzle schema exports

### 1.2 Repository Layer ✅

- [x] `AgentRepository`

  - findAll, findBySlug, findById
  - create, update, delete
  - findByUser (allocations)
  - updatePerformance

- [x] `AllocationRepository` (merged into AgentRepository)

  - allocate, withdraw
  - findByUser, findByAgent
  - calculatePnL

- [x] `AgentTradeRepository` (merged into AgentRepository)

  - create, close
  - findByAgent (with pagination)
  - getOpenPositions

- [x] `PredictionMarketRepository`

  - findAll, findById
  - create, resolve
  - updatePrice
  - findActive, findResolved

- [x] `MarketPositionRepository` (merged into PredictionMarketRepository)

  - findByUser, findByMarket
  - updatePosition

- [x] `MarketTradeRepository` (merged into PredictionMarketRepository)
  - create
  - findByMarket, findByUser

### 1.3 Core Services ✅

- [x] `AgentService`

  - CRUD операции
  - Performance calculation
  - Allocation management

- [x] `MarketService`

  - Market CRUD
  - Price calculation (AMM)
  - Resolution logic

- [x] `AMMService`
  - Automated Market Maker
  - Buy/sell logic with price impact
  - Liquidity management

### 1.4 API Routes ✅

- [x] `/api/agents` routes (CRUD)
- [x] `/api/agents/:slug/allocate` route
- [x] `/api/agents/:slug/withdraw` route
- [x] `/api/markets` routes (CRUD)
- [x] `/api/markets/:id/buy` route
- [x] `/api/markets/:id/sell` route

### 1.5 Types & Interfaces ✅

- [x] Agent types в `packages/db/src/schema/agent.ts`
- [x] Market types в `packages/db/src/schema/prediction-market.ts`
- [x] Repositories export types

---

## Phase 2: Agent MVP (3 недели) 🟡 IN PROGRESS

### 2.1 Pre-built Agents ✅

- [x] **Tanker Scout Agent**

  - Strategy: Long commodities when tanker flow drops
  - Data: Transport service vessels
  - Risk: Medium, max 5% per trade

- [x] **News Hawk Agent**

  - Strategy: Trade crypto on news sentiment
  - Data: News + LLM sentiment
  - Risk: High, momentum-based

- [x] **Macro Oracle Agent**

  - Strategy: Macro positioning based on Fed signals
  - Data: News + Polymarket probabilities
  - Risk: Low, longer holds

- [x] Preset agents defined in `presets.ts`
- [x] Auto-seed on server startup

### 2.2 Agent Execution Engine ✅

- [x] `AgentExecutorService` class

  - Load agent strategy
  - Fetch required data (market, news)
  - Generate signals via LLM
  - Execute trades with risk limits

- [x] Execution scheduling

  - Start/stop per agent
  - 5-minute intervals
  - Error handling + logging

- [x] Decision logging

  - Store reasoning for each trade
  - Data sources used (dataSources JSONB)
  - Confidence level

- [x] Risk management
  - Max position size check
  - Max open positions check
  - Daily loss limit
  - Min time between trades

### 2.3 Performance Tracking ✅

- [x] PnL calculation per trade
- [x] Portfolio value tracking
- [x] Performance metrics calculation

  - Total return
  - Sharpe ratio
  - Max drawdown
  - Win rate

- [x] Historical performance chart data
- [x] `/api/agents/:slug/history` endpoint
- [x] `/api/agents/:slug/recalculate` endpoint

### 2.4 Agent UI ✅

- [x] `/agents` — Marketplace page

  - Grid of agent cards
  - Top performers section
  - Stats bar

- [x] `/agents/:slug` — Agent profile

  - Performance stats
  - Strategy description
  - Recent trades table
  - Allocate modal

- [x] `/my` — My portfolio (agents + positions)

  - List of allocated agents
  - List of market positions
  - Total value, PnL

- [x] Agent card component
- [x] Performance chart component
- [x] Trade history table component
- [x] Allocation dialog component

### 2.5 Agent API Completion ✅

- [x] GET `/api/agents/:slug/performance` — detailed metrics
- [x] GET `/api/agents/:slug/trades` — paginated trades
- [x] GET `/api/agents/:slug/history` — performance chart data
- [x] POST `/api/agents/:slug/recalculate` — recalculate metrics
- [x] GET `/api/agents/me/allocations` — user allocations with PnL

---

## Phase 3: Prediction Factory (3 недели) 🟡 IN PROGRESS

### 3.1 Market Generation ✅

- [x] `MarketGeneratorService`

  - Input: news article
  - Output: 1-3 prediction markets

- [x] LLM prompt для генерации markets

  - Extract tradeable predictions
  - Set resolution criteria
  - Determine category
  - Set reasonable timeframe

- [ ] Market curation pipeline
  - Auto-approve obvious markets
  - Flag ambiguous for review
  - Reject duplicates

### 3.2 Automated Market Maker (AMM) ✅

- [x] Simplified LMSR implementation

  - Price calculation
  - Cost function
  - Shares calculation

- [x] Liquidity seeding

  - Initial liquidity (1000) for new markets
  - Price impact based on trade size

- [x] Price bounds (1-99%)

### 3.3 Resolution System 🟡

- [ ] Auto-resolution sources

  - Price feeds (crypto, commodities)
  - Official announcements (Fed, earnings)
  - Date-based (did X happen by Y?)

- [x] Manual resolution flow

  - POST `/api/markets/:id/resolve` endpoint
  - Resolution notes support

- [x] Settlement
  - Calculate payouts (winners get $1/share)
  - PnL calculation for positions
  - Update position status to "settled"

### 3.4 Markets UI ✅

- [x] `/markets` — Markets feed

  - Active markets list
  - Category filters
  - Trending section
  - Search

- [x] `/markets/:id` — Market detail

  - Question & description
  - Probability bar
  - Trade form (buy yes/no)
  - Recent trades
  - Resolution info

- [x] `/markets/create` — Create market

  - Question input
  - Category selection
  - Resolution criteria
  - End date

- [x] `/my` — My portfolio (includes positions)

  - Open positions
  - Resolved positions
  - Total PnL

- [x] Market card component
- [ ] Price chart component
- [x] Trade form component
- [x] Position card component

### 3.5 Markets API Completion ✅

- [x] POST `/api/markets/generate/:articleId` — AI generate from article
- [ ] GET `/api/markets/:id/orderbook` — order book data
- [ ] GET `/api/markets/:id/chart` — price history
- [x] POST `/api/markets/:id/resolve` — admin resolution
- [x] GET `/api/markets/me/positions` — user positions with PnL

### 3.6 News → Market Pipeline

- [ ] Hook into news ingestion
- [ ] Auto-generate markets for high-impact news
- [ ] Deduplication logic
- [ ] Rate limiting (max N markets per day)

---

## Phase 4: Integration (2 недели)

### 4.1 Agents Trade Markets

- [ ] Add prediction markets as agent data source
- [ ] Agent can buy/sell market positions
- [ ] Use market probabilities as signals

- [ ] **Prediction Arbitrage Agent**
  - Compare market prices vs historical base rates
  - Trade mispriced markets

### 4.2 Cross-Platform Dashboard

- [ ] `/dashboard` — Unified view

  - Agent portfolio summary
  - Market positions summary
  - Combined PnL
  - Activity feed

- [ ] Notifications
  - Agent made a trade
  - Market resolved
  - Position PnL threshold

### 4.3 Social Features

- [ ] Agent leaderboard

  - Top performing agents
  - Trending agents
  - New agents

- [ ] Market leaderboard

  - Most active traders
  - Best predictors
  - Highest volume

- [ ] Share agent/market links

### 4.4 Mobile Optimization

- [ ] Responsive design audit
- [ ] Touch-friendly trade forms
- [ ] PWA setup

### 4.5 Monitoring & Analytics

- [ ] Agent performance monitoring
- [ ] Market health metrics
- [ ] User engagement analytics
- [ ] Error tracking

---

## Phase 5: Polish & Launch (2 недели)

### 5.1 Onboarding

- [ ] Welcome flow for new users
- [ ] Agent allocation tutorial
- [ ] Market trading tutorial
- [ ] Demo mode (paper trading)

### 5.2 Documentation

- [ ] User guide
- [ ] API documentation
- [ ] Agent strategy explanations

### 5.3 Legal & Compliance

- [ ] Terms of service
- [ ] Risk disclaimers
- [ ] Data privacy policy

### 5.4 Performance

- [ ] Database query optimization
- [ ] Caching strategy
- [ ] CDN for static assets

### 5.5 Launch

- [ ] Beta testing
- [ ] Bug fixes
- [ ] Public launch

---

## Technical Dependencies

### New Packages

```json
{
  "decimal.js": "^10.4.3", // Precise financial math
  "cron": "^3.1.6", // Agent scheduling
  "nanoid": "^5.0.4" // Short IDs for slugs
}
```

### Infrastructure

- [ ] Background job runner for agents
- [ ] WebSocket for live price updates
- [ ] Redis for caching (optional)

---

## Success Metrics

### Phase 2 (Agent MVP)

- 3 agents running with paper trading
- Users can allocate/withdraw
- Performance visible in UI

### Phase 3 (Prediction Factory)

- 10+ AI-generated markets
- Buy/sell working
- Resolution flow complete

### Phase 4 (Integration)

- Agents trading on markets
- Unified dashboard
- Real trading enabled

---

## Risk Mitigation

| Risk                  | Mitigation                                 |
| --------------------- | ------------------------------------------ |
| LLM costs             | Cache responses, batch processing          |
| Bad market generation | Curation pipeline, quality filters         |
| Agent losses          | Paper trading first, risk limits           |
| Regulatory            | Disclaimers, no fiat integration initially |
| Complexity            | Phased rollout, MVP focus                  |
