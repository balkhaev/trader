# AGENTS.md

Детальная документация для AI агентов. Содержит всю необходимую информацию о сервисах, API, типах данных и интеграциях.

---

## 🚀 Trader 2.0 Vision

**Новое направление:** Платформа автономных AI-агентов + Фабрика prediction markets.

| Компонент              | Описание                                                      |
| ---------------------- | ------------------------------------------------------------- |
| **Agent Platform**     | Пользователи "нанимают" AI-агентов, которые торгуют автономно |
| **Prediction Factory** | AI генерирует prediction markets из новостей                  |

Полная документация:

- [Vision 2025](docs/vision-2025.md) — архитектура и концепция
- [Implementation Checklist](docs/implementation-checklist.md) — поэтапный план

### Ключевые сущности

```
Agent              → Автономный торговый агент со стратегией
AgentAllocation    → Аллокация капитала пользователя в агента
AgentTrade         → Сделка агента с reasoning
PredictionMarket   → AI-сгенерированный рынок вероятностей
MarketPosition     → Позиция пользователя/агента в market
```

### Trader 2.0 Сервисы ✅

| Сервис           | Путь                                              | Описание                                    |
| ---------------- | ------------------------------------------------- | ------------------------------------------- |
| Agent Service    | `services/agent/agent.service.ts`                 | Управление агентами, аллокациями, сделками  |
| Agent Executor   | `services/agent/executor.service.ts`              | Автоматическое исполнение стратегий агентов |
| Market Service   | `services/prediction-market/market.service.ts`    | CRUD prediction markets + trading           |
| AMM Service      | `services/prediction-market/amm.service.ts`       | LMSR для ценообразования                    |
| Market Generator | `services/prediction-market/generator.service.ts` | AI генерация markets из новостей            |

---

## Содержание

- [Архитектура](#архитектура)
- [Сервисы](#сервисы)
  - [Market Service](#market-service)
  - [Transport Service](#transport-service)
  - [News Service](#news-service)
  - [Trends Service](#trends-service)
  - [Signals Service](#signals-service)
  - [LLM Service](#llm-service)
  - [Exchange Service](#exchange-service)
  - [Polymarket Service](#polymarket-service)
- [База данных](#база-данных)
- [API Reference](#api-reference)

---

## Архитектура

```
┌─────────────────────────────────────────────────────────────────────┐
│                           apps/web (Next.js)                        │
│                         порт 3001, React 19                         │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        apps/server (Hono API)                       │
│                      Bun runtime, hot reload                        │
├─────────────────────────────────────────────────────────────────────┤
│  routes/          services/                                         │
│  ├── market      ├── market/      ← Мультирыночный анализ          │
│  ├── transport   ├── transport/   ← Транспортные потоки            │
│  ├── news        ├── news/        ← Сбор новостей                  │
│  ├── trends      ├── trends/      ← Анализ трендов (LLM)           │
│  ├── signals     ├── signals/     ← Торговые сигналы               │
│  ├── exchange    ├── exchange/    ← Биржи (Bybit)                  │
│  ├── polymarket  ├── llm/         ← OpenAI интеграция              │
│  └── lean        └── polymarket   ← Предсказательный рынок         │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
              ┌──────────┐   ┌──────────┐   ┌──────────────┐
              │PostgreSQL│   │ClickHouse│   │  NATS/Redis  │
              │ @trader/ │   │ (metrics)│   │  (messaging) │
              │    db    │   │          │   │              │
              └──────────┘   └──────────┘   └──────────────┘
```

### Apps

| App       | Путь             | Описание                                                  |
| --------- | ---------------- | --------------------------------------------------------- |
| web       | `apps/web`       | Next.js 16, React 19, TailwindCSS 4, shadcn/ui, порт 3001 |
| server    | `apps/server`    | Hono API на Bun с hot reload                              |
| lean      | `apps/lean`      | QuantConnect Lean для бэктестинга (Python)                |
| portfolio | `apps/portfolio` | Python сервис оптимизации портфеля                        |

### Packages

| Package        | Описание                                        |
| -------------- | ----------------------------------------------- |
| `@trader/db`   | Drizzle ORM + PostgreSQL, схемы в `src/schema/` |
| `@trader/auth` | better-auth с email/password                    |
| `@trader/env`  | Типизированные переменные окружения             |

---

## Сервисы

### Market Service

**Путь:** `apps/server/src/services/market/`

Система мультирыночного анализа для крипты, ETF, S&P 500 и MOEX.

#### Источники данных

| Источник   | Рынок        | API             | Без ключа |
| ---------- | ------------ | --------------- | --------- |
| `binance`  | Crypto       | REST API        | ✅        |
| `yahoo`    | ETF, S&P 500 | Chart/Quote API | ✅        |
| `moex_iss` | MOEX         | ISS API         | ✅        |

#### Структура

```
market/
├── collectors/
│   ├── base.collector.ts      # Базовый класс
│   ├── binance.collector.ts   # Binance API
│   ├── yahoo.collector.ts     # Yahoo Finance
│   └── moex.collector.ts      # MOEX ISS
├── analyzers/
│   └── technical.analyzer.ts  # RSI, MACD, Bollinger, ADX, ATR
├── scheduler.ts               # Планировщик сбора
├── types.ts                   # Типы
└── index.ts
```

#### Использование

```typescript
import {
  binanceCollector,
  yahooCollector,
  moexCollector,
} from "@/services/market"

// Сбор OHLCV
const btcCandles = await binanceCollector.fetchOHLCV("BTCUSDT", "1h", 200)
const spyCandles = await yahooCollector.fetchOHLCV("SPY", "1d", 200)
const sberCandles = await moexCollector.fetchOHLCV("SBER", "1h", 200)

// Топ символы
const cryptoSymbols = await binanceCollector.fetchTopSymbols(50)
const etfSymbols = await yahooCollector.fetchETFSymbols(30)
const moexSymbols = await moexCollector.fetchTopSymbols(25)
```

#### Технический анализ

```typescript
import { technicalAnalyzer } from "@/services/market"

const analysis = await technicalAnalyzer.analyze(candles, {
  rsiPeriod: 14,
  fastPeriod: 12,
  slowPeriod: 26,
  signalPeriod: 9,
})

// Результат:
// - rsi: { value, signal: "oversold" | "overbought" | "neutral" }
// - macd: { macd, signal, histogram, trend }
// - bollinger: { upper, middle, lower, percentB, bandwidth }
// - adx: { adx, plusDI, minusDI, trendStrength }
// - atr: { value, volatilityLevel }
// - supportResistance: [{ price, strength, type, touches }]
```

#### Типы

```typescript
type MarketType = "crypto" | "etf" | "stock" | "moex" | "forex" | "commodity"
type DataSource =
  | "binance"
  | "bybit"
  | "yahoo"
  | "alpaca"
  | "moex_iss"
  | "tinkoff"
type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w"

interface OHLCV {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface AssetInfo {
  symbol: string
  name: string
  baseCurrency: string
  quoteCurrency: string
  marketType: MarketType
  dataSource: DataSource
  sector?: string
}
```

---

### Transport Service

**Путь:** `apps/server/src/services/transport/`

Анализ транспортных потоков для прогнозирования цен на сырьевые товары.

#### Структура

```
transport/
├── collectors/
│   ├── base.collector.ts      # Базовый класс
│   ├── opensky.collector.ts   # Самолёты (OpenSky Network)
│   └── aishub.collector.ts    # Суда (AIS Hub)
├── analyzers/
│   ├── flow.analyzer.ts       # Анализ грузопотоков
│   └── signal.generator.ts    # Генерация сигналов
├── transport.service.ts       # Основной сервис
├── scheduler.ts               # Планировщик
└── types.ts                   # Маппинги товаров
```

#### Маппинги

```typescript
import {
  VESSEL_TYPE_TO_COMMODITY,
  COMMODITY_TO_TICKERS,
} from "@/services/transport/types"

// Тип судна → Товар
// tanker_crude → ["crude_oil", "brent"]
// tanker_lng   → ["lng", "natural_gas"]
// bulk_carrier → ["wheat", "corn", "soybeans", "rice", "coal", "iron_ore"]

// Товар → Тикеры
// crude_oil → ["CL", "USO", "XLE"]
// wheat     → ["ZW", "WEAT"]
// iron_ore  → ["VALE", "RIO", "BHP"]
```

#### Сигналы

| Тип сигнала           | Описание                   | Направление   |
| --------------------- | -------------------------- | ------------- |
| `tanker_surge`        | Рост танкерного трафика    | Bearish       |
| `tanker_decline`      | Падение танкерного трафика | Bullish       |
| `bulk_flow_increase`  | Рост перевозок навалом     | Bearish       |
| `bulk_flow_drop`      | Падение перевозок          | Bullish       |
| `port_congestion`     | Загруженность порта        | Bullish       |
| `private_jet_cluster` | Скопление бизнес-джетов    | Neutral (M&A) |

#### Регионы

- **Persian Gulf** — нефть, газ
- **US Gulf** — нефтепродукты, зерно
- **West Africa** — нефть
- **North Sea** — Brent crude
- **Baltic Sea** — зерно, уголь
- **Southeast Asia** — контейнеры, LNG
- **Australia** — руда, уголь

#### Использование

```typescript
import { transportService } from "@/services/transport"

// Активные сигналы
const signals = await transportService.getSignals({
  commodity: "crude_oil",
  direction: "bullish",
})

// Обзор для дашборда
const overview = await transportService.getOverview()
// { vesselCount, aircraftCount, activeSignals, topCommodities, regionActivity }
```

#### Планировщик

- Самолёты: каждые 15 минут
- Суда: каждый час
- Анализ: каждые 30 минут

---

### News Service

**Путь:** `apps/server/src/services/news/`

Сбор новостей из множества источников.

#### Структура

```
news/
├── parsers/
│   ├── rss.parser.ts          # RSS фиды
│   ├── telegram.parser.ts     # Telegram каналы
│   └── web-scraper.parser.ts  # Web scraping
├── realtime/
│   ├── browser-pool.ts        # Пул браузеров
│   ├── page-watcher.ts        # Мониторинг страниц
│   ├── telegram-client.ts     # Telegram клиент
│   └── event-emitter.ts       # События
├── websocket/
│   └── server.ts              # WebSocket для real-time
├── news.service.ts            # Основной сервис
├── scheduler.ts               # Планировщик
├── sources-config.ts          # Конфигурация источников
└── types.ts
```

#### Источники

Конфигурация в `sources-config.ts`:

- RSS фиды (CoinDesk, CoinTelegraph, etc.)
- Telegram каналы
- Web страницы для скрапинга

---

### Trends Service

**Путь:** `apps/server/src/services/trends/`

Анализ новостных трендов с извлечением тегов через LLM.

#### Структура

```
trends/
├── tag-extractor.service.ts      # Извлечение тегов (LLM)
├── trend-aggregator.service.ts   # Агрегация трендов
├── graph-builder.service.ts      # Граф связей
├── anomaly-detector.service.ts   # Обнаружение аномалий
└── index.ts
```

#### Типы тегов

- **entity** — персоны, компании, криптовалюты, протоколы, биржи
- **topic** — regulation, defi, nft, macro, security, adoption
- **event** — hack, listing, lawsuit, announcement, partnership
- **region** — USA, EU, China

#### Использование

```typescript
import {
  tagExtractorService,
  trendAggregatorService,
  graphBuilderService,
} from "@/services/trends"

// Извлечение тегов из статьи
const result = await tagExtractorService.extractAndSaveTags(articleId)

// Hot trends
const hotTrends = await trendAggregatorService.getHotTrends("24h", 20)

// Граф для визуализации
const graph = await graphBuilderService.buildGraph({
  maxNodes: 100,
  minStrength: 0.1,
  periodDays: 7,
})
```

#### LLM извлечение

```typescript
interface TagExtractionResult {
  entities: { name; type; sentiment; relevance; context; aliases }[]
  topics: { name; category; sentiment; relevance }[]
  events: { name; type; date; severity; affectedEntities }[]
  regions: { name; sentiment; relevance }[]
  relations: { source; target; type; description }[]
}
```

---

### Signals Service

**Путь:** `apps/server/src/services/signals/`

Генерация и управление торговыми сигналами.

```typescript
import { signalService } from "@/services/signals"

const signals = await signalService.getActiveSignals()
```

---

### LLM Service

**Путь:** `apps/server/src/services/llm/`

Интеграция с OpenAI.

#### Структура

```
llm/
├── openai.service.ts
├── prompts/
│   ├── tag-extraction.ts       # Извлечение тегов
│   ├── news-analysis.ts        # Анализ новостей
│   └── polymarket-context.ts   # Контекст Polymarket
└── types.ts
```

---

### Exchange Service

**Путь:** `apps/server/src/services/exchange/`

Работа с биржами (Bybit).

```
exchange/
├── bybit.ts
├── types.ts
└── index.ts
```

---

### Polymarket Service

**Путь:** `apps/server/src/services/polymarket.service.ts`

Интеграция с Polymarket (предсказательный рынок).

---

## База данных

**Путь:** `packages/db/src/schema/`

### Схемы

| Файл                   | Таблицы                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth.ts`              | user, session, account, verification                                                                                                             |
| `market.ts`            | market_asset, market_candle, market_indicator, market_trend, market_opportunity, market_correlation                                              |
| `transport.ts`         | transport_vessel, transport_aircraft, transport_position, transport_port, transport_port_call, transport_route, transport_flow, transport_signal |
| `news.ts`              | news_source, news_article, news_tag, tag_mention, tag_relation, trend_snapshot, trend_alert                                                      |
| `polymarket.ts`        | polymarket_market, polymarket_position                                                                                                           |
| `exchange.ts`          | exchange_order, exchange_position                                                                                                                |
| `lean.ts`              | lean_backtest, lean_strategy                                                                                                                     |
| `data-import.ts`       | data_import_job                                                                                                                                  |
| `agent.ts`             | agent, agent_allocation, agent_trade                                                                                                             |
| `prediction-market.ts` | prediction_market, market_position, market_trade                                                                                                 |

---

## API Reference

### Market API

```
GET  /api/market/overview
GET  /api/market/sources
GET  /api/market/assets
GET  /api/market/assets/:symbol
GET  /api/market/candles/:symbol?timeframe=1h&limit=100
GET  /api/market/indicators/:symbol?timeframe=1h
GET  /api/market/trends?marketType=crypto&trendType=uptrend
GET  /api/market/opportunities?minScore=60&direction=long
GET  /api/market/heatmap
POST /api/market/collect
POST /api/market/scheduler/start
POST /api/market/scheduler/stop
GET  /api/market/scheduler/status
```

### Transport API

```
GET  /api/transport/stats
GET  /api/transport/vessels
GET  /api/transport/aircraft
GET  /api/transport/flows
GET  /api/transport/signals
GET  /api/transport/overview
POST /api/transport/collect
POST /api/transport/analyze
GET  /api/transport/scheduler
POST /api/transport/scheduler/start
POST /api/transport/scheduler/stop
```

### News API

```
GET  /api/news/articles
GET  /api/news/articles/:id
GET  /api/news/sources
POST /api/news/collect
```

### Trends API

```
GET  /api/trends/tags
GET  /api/trends/tags/:id
GET  /api/trends/tags/:id/graph
GET  /api/trends/hot?period=24h
GET  /api/trends/graph
GET  /api/trends/graph/stats
GET  /api/trends/graph/clusters
GET  /api/trends/graph/centrality
GET  /api/trends/alerts
GET  /api/trends/alerts/stats
POST /api/trends/alerts/:id/acknowledge
POST /api/trends/alerts/scan
POST /api/trends/extract/:articleId
POST /api/trends/extract-batch
POST /api/trends/aggregate
POST /api/trends/update-aggregates
```

### Agents API (NEW)

```
GET  /api/agents                    # Список публичных агентов
GET  /api/agents/top                # Топ по performance
GET  /api/agents/:slug              # Детали агента
GET  /api/agents/:slug/trades       # Сделки агента
GET  /api/agents/:slug/performance  # Метрики агента
POST /api/agents                    # Создать агента (auth)
PATCH /api/agents/:slug/status      # Изменить статус
POST /api/agents/:slug/allocate     # Аллоцировать капитал
POST /api/agents/:slug/withdraw     # Вывести капитал
GET  /api/agents/me/allocations     # Мои аллокации
DELETE /api/agents/:slug            # Удалить агента
POST /api/agents/:slug/start        # Запустить автоторговлю
POST /api/agents/:slug/stop         # Остановить автоторговлю
POST /api/agents/:slug/execute      # Выполнить 1 цикл
GET  /api/agents/executor/status    # Статус executor'а
```

### Prediction Markets API (NEW)

```
GET  /api/markets                   # Список markets
GET  /api/markets/trending          # Trending markets
GET  /api/markets/stats             # Статистика
GET  /api/markets/:id               # Детали market
GET  /api/markets/:id/trades        # История сделок
GET  /api/markets/:id/positions     # Позиции в market
POST /api/markets                   # Создать market (auth)
POST /api/markets/:id/buy           # Купить shares
POST /api/markets/:id/sell          # Продать shares
POST /api/markets/:id/resolve       # Разрешить market
POST /api/markets/:id/cancel        # Отменить market
POST /api/markets/:id/activate      # Активировать market
GET  /api/markets/me/positions      # Мои позиции
GET  /api/markets/me/trades         # Мои сделки
POST /api/markets/generate/:articleId  # Сгенерировать из статьи
POST /api/markets/generate/batch    # Обработать недавние статьи
```

### Signals API

```
GET  /api/signals
GET  /api/signals/:id
POST /api/signals/generate
```

### Exchange API

```
GET  /api/exchange/balance
GET  /api/exchange/positions
POST /api/exchange/orders
```

### Polymarket API

```
GET  /api/polymarket/markets
GET  /api/polymarket/positions
```

### Lean API

```
GET  /api/lean/strategies
GET  /api/lean/backtests
POST /api/lean/run
```

---

## Переменные окружения

```env
# База данных
DATABASE_URL=postgresql://...

# Auth
BETTER_AUTH_SECRET=...   # минимум 32 символа
BETTER_AUTH_URL=...
CORS_ORIGIN=...

# LLM
OPENAI_API_KEY=...

# Transport
OPENSKY_USERNAME=        # опционально
OPENSKY_PASSWORD=        # опционально
AISHUB_USERNAME=

# Exchange
BYBIT_API_KEY=
BYBIT_API_SECRET=
```

---

## Логирование

Все логи пишутся в директорию `/logs` в корне проекта:

- `analyzer.log` — логи анализатора
- `historian.log` — логи историка
- `listener.log` — логи слушателя
- `screener.log` — логи скринера

---

## Инфраструктура

ВСЕ сервисы (ClickHouse, PostgreSQL, NATS) работают на **удалённом сервере**, не локально.

Для работы с ClickHouse использовать MCP инструменты (`mcp_clickhouse_*`), НЕ docker команды.

В dev режиме (`bun dev`) каждое изменение файлов автоматически перезапускает сервисы через hot reload. **НИКОГДА не убивать процессы** (pkill, kill и т.д.).
