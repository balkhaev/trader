# Trader 2.0: Agent Platform + Prediction Factory

## Новое видение

Trader трансформируется из trading terminal в **платформу автономных AI-агентов** и **фабрику prediction markets**.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         TRADER 2.0                                  │
├─────────────────────────────────┬───────────────────────────────────┤
│      AGENT PLATFORM             │      PREDICTION FACTORY           │
│                                 │                                   │
│  ┌─────────┐  ┌─────────┐      │   ┌──────────────────────────┐   │
│  │ Agent 1 │  │ Agent 2 │      │   │  AI-Generated Markets    │   │
│  │ Crypto  │  │ Commods │      │   │  ────────────────────    │   │
│  │ +12%    │  │ +8%     │      │   │  "Fed cuts in March" 34% │   │
│  └────┬────┘  └────┬────┘      │   │  "Oil hits $90"     22% │   │
│       │            │            │   │  "BTC > $100k"      67% │   │
│       ▼            ▼            │   └──────────────────────────┘   │
│  ┌─────────────────────┐       │              ▲                    │
│  │  User Portfolio     │       │              │                    │
│  │  Allocated: $10,000 │◄──────┼──────────────┘                    │
│  └─────────────────────┘       │   Agents trade markets            │
└─────────────────────────────────┴───────────────────────────────────┘
```

---

## Часть 1: Agent Platform

### Концепция

Пользователь не торгует сам — он **"нанимает" AI-агентов**. Каждый агент:
- Имеет специализацию (крипто, commodities, макро)
- Использует разные data sources
- Имеет свой risk profile
- Показывает track record

### Типы агентов

| Агент | Специализация | Data Sources | Risk |
|-------|---------------|--------------|------|
| **Tanker Scout** | Oil & Gas commodities | Vessel tracking, port data | Medium |
| **News Hawk** | Crypto на новостях | RSS, Telegram, LLM sentiment | High |
| **Macro Oracle** | Макро-позиционирование | Fed data, economic indicators | Low |
| **Momentum Rider** | Technical breakouts | OHLCV, volume, indicators | High |
| **Jet Tracker** | M&A / Corp events | Private jet tracking, filings | Medium |

### User Flow

```
1. DISCOVER → Пользователь смотрит marketplace агентов
2. ANALYZE  → Изучает track record, стратегию, risk metrics
3. ALLOCATE → Выделяет капитал агенту ($100 - $10,000)
4. MONITOR  → Следит за сделками агента в реальном времени
5. ADJUST   → Увеличивает/уменьшает аллокацию по результатам
```

### Архитектура агента

```typescript
interface Agent {
  id: string;
  name: string;
  description: string;
  
  // Strategy
  strategy: {
    type: "news" | "technical" | "transport" | "macro" | "hybrid";
    dataSources: DataSource[];
    entryRules: Rule[];
    exitRules: Rule[];
    riskParams: RiskParams;
  };
  
  // Performance
  performance: {
    totalReturn: number;      // All-time return %
    monthlyReturn: number;    // Current month %
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
    avgHoldingPeriod: string; // "2h", "3d", etc.
  };
  
  // Status
  status: "active" | "paused" | "backtesting";
  allocatedCapital: number;
  openPositions: Position[];
  
  // Transparency
  recentTrades: Trade[];
  reasoning: string[];  // LLM explanations for each trade
}
```

### UI Screens

1. **Agent Marketplace** — каталог всех агентов с фильтрами
2. **Agent Profile** — детальная страница агента с графиками
3. **My Agents** — портфель активных агентов
4. **Agent Builder** — создание кастомного агента (Phase 2)

---

## Часть 2: Prediction Factory

### Концепция

AI автоматически генерирует prediction markets из новостей. Пользователи (и агенты) торгуют вероятностями событий.

### Генерация рынков

```
News Input:
"Fed officials signal potential rate cut amid cooling inflation"

↓ LLM Processing ↓

Generated Markets:
1. "Fed will cut rates at March FOMC meeting" — Initial: 50%
2. "Fed will cut rates by 50bp or more in 2025" — Initial: 35%
3. "10Y Treasury yield below 4% by March" — Initial: 40%
```

### Типы рынков

| Категория | Примеры | Resolution Source |
|-----------|---------|-------------------|
| **Macro** | Fed decisions, CPI data | Official announcements |
| **Crypto** | "BTC > $100k by date" | Price feeds |
| **Corporate** | Earnings beats, M&A | SEC filings |
| **Geopolitical** | Elections, treaties | News verification |
| **Commodities** | Price targets | Price feeds |

### Market Lifecycle

```
1. CREATION    → AI генерирует market из новости
2. CURATION    → Модерация (auto + manual)
3. TRADING     → Пользователи/агенты торгуют
4. RESOLUTION  → Автоматическое или ручное разрешение
5. SETTLEMENT  → Выплата победителям
```

### Архитектура рынка

```typescript
interface PredictionMarket {
  id: string;
  question: string;
  description: string;
  
  // Source
  sourceArticleId: string;      // News that triggered creation
  createdBy: "ai" | "user";
  
  // Probabilities
  yesPrice: number;             // 0-100, current "Yes" price
  noPrice: number;              // 100 - yesPrice
  
  // Liquidity
  totalVolume: number;
  liquidity: number;
  
  // Resolution
  resolutionCriteria: string;
  resolutionSource: string;
  resolvesAt: Date;
  resolvedAt?: Date;
  outcome?: "yes" | "no" | "cancelled";
  
  // Metadata
  category: "macro" | "crypto" | "corporate" | "geo" | "commodity";
  relatedSymbols: string[];
  createdAt: Date;
}
```

### Интеграция с Agents

Агенты могут:
1. Торговать на prediction markets
2. Использовать market probabilities как сигналы
3. Хеджировать позиции через противоположные markets

---

## База данных (новые таблицы)

### Agents

```sql
CREATE TABLE agent (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  avatar_url TEXT,
  
  -- Strategy config (JSON)
  strategy JSONB NOT NULL,
  risk_params JSONB NOT NULL,
  
  -- Status
  status agent_status NOT NULL DEFAULT 'backtesting',
  is_public BOOLEAN DEFAULT false,
  
  -- Performance (updated periodically)
  total_return NUMERIC(10, 4),
  monthly_return NUMERIC(10, 4),
  sharpe_ratio NUMERIC(6, 4),
  max_drawdown NUMERIC(6, 4),
  win_rate NUMERIC(5, 4),
  total_trades INTEGER DEFAULT 0,
  
  -- Ownership
  created_by UUID REFERENCES user(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE agent_allocation (
  id UUID PRIMARY KEY,
  agent_id UUID REFERENCES agent(id) ON DELETE CASCADE,
  user_id UUID REFERENCES user(id) ON DELETE CASCADE,
  amount NUMERIC(20, 8) NOT NULL,
  status allocation_status NOT NULL DEFAULT 'active',
  allocated_at TIMESTAMP DEFAULT NOW(),
  withdrawn_at TIMESTAMP,
  realized_pnl NUMERIC(20, 8),
  UNIQUE(agent_id, user_id)
);

CREATE TABLE agent_trade (
  id UUID PRIMARY KEY,
  agent_id UUID REFERENCES agent(id) ON DELETE CASCADE,
  
  -- Trade details
  symbol TEXT NOT NULL,
  side side_enum NOT NULL,
  entry_price NUMERIC(24, 12) NOT NULL,
  exit_price NUMERIC(24, 12),
  quantity NUMERIC(20, 8) NOT NULL,
  
  -- Reasoning
  reasoning TEXT,           -- LLM explanation
  data_sources JSONB,       -- What triggered the trade
  
  -- Status
  status trade_status NOT NULL DEFAULT 'open',
  opened_at TIMESTAMP DEFAULT NOW(),
  closed_at TIMESTAMP,
  pnl NUMERIC(20, 8),
  pnl_percent NUMERIC(10, 4)
);
```

### Prediction Markets

```sql
CREATE TABLE prediction_market (
  id UUID PRIMARY KEY,
  
  -- Question
  question TEXT NOT NULL,
  description TEXT,
  category market_category NOT NULL,
  
  -- Source
  source_article_id UUID REFERENCES news_article(id),
  created_by UUID REFERENCES user(id),
  creation_type creation_type NOT NULL, -- 'ai' | 'user'
  
  -- Trading
  yes_price NUMERIC(5, 2) NOT NULL DEFAULT 50,
  total_volume NUMERIC(20, 8) DEFAULT 0,
  liquidity NUMERIC(20, 8) DEFAULT 0,
  
  -- Resolution
  resolution_criteria TEXT NOT NULL,
  resolution_source TEXT,
  resolves_at TIMESTAMP NOT NULL,
  resolved_at TIMESTAMP,
  outcome market_outcome, -- 'yes' | 'no' | 'cancelled'
  
  -- Status
  status market_status NOT NULL DEFAULT 'pending', -- pending, active, resolved, cancelled
  related_symbols TEXT[],
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE market_position (
  id UUID PRIMARY KEY,
  market_id UUID REFERENCES prediction_market(id) ON DELETE CASCADE,
  user_id UUID REFERENCES user(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agent(id) ON DELETE SET NULL,
  
  side position_side NOT NULL, -- 'yes' | 'no'
  shares NUMERIC(20, 8) NOT NULL,
  avg_price NUMERIC(5, 2) NOT NULL,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(market_id, user_id, side)
);

CREATE TABLE market_trade (
  id UUID PRIMARY KEY,
  market_id UUID REFERENCES prediction_market(id) ON DELETE CASCADE,
  user_id UUID REFERENCES user(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agent(id) ON DELETE SET NULL,
  
  side position_side NOT NULL,
  shares NUMERIC(20, 8) NOT NULL,
  price NUMERIC(5, 2) NOT NULL,
  
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## API Endpoints

### Agents

```
GET    /api/agents                    # List all public agents
GET    /api/agents/:slug              # Agent details
GET    /api/agents/:slug/trades       # Agent trade history
GET    /api/agents/:slug/performance  # Performance metrics
POST   /api/agents                    # Create custom agent
PUT    /api/agents/:id                # Update agent config
DELETE /api/agents/:id                # Delete agent

POST   /api/agents/:id/allocate       # Allocate capital
POST   /api/agents/:id/withdraw       # Withdraw capital
GET    /api/me/agents                 # My allocations
```

### Prediction Markets

```
GET    /api/markets                   # List markets
GET    /api/markets/:id               # Market details
GET    /api/markets/:id/trades        # Trade history
GET    /api/markets/:id/positions     # Position breakdown

POST   /api/markets                   # Create market (user)
POST   /api/markets/generate          # AI generate from article

POST   /api/markets/:id/buy           # Buy shares
POST   /api/markets/:id/sell          # Sell shares
GET    /api/me/positions              # My positions

POST   /api/markets/:id/resolve       # Resolve market (admin)
```

---

## UI Routes

```
/agents                    # Agent marketplace
/agents/:slug              # Agent profile page
/agents/create             # Create custom agent
/my/agents                 # My agent allocations

/markets                   # Prediction markets feed
/markets/:id               # Market detail page
/markets/create            # Create market
/my/positions              # My market positions

/dashboard                 # Unified dashboard (agents + markets)
```

---

## Phased Implementation

См. чеклист в следующем разделе.
