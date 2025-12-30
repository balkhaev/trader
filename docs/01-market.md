# Market Service

> Базовая информация в [AGENTS.md](../AGENTS.md#market-service)

Система мультирыночного анализа для крипты, ETF, S&P 500 и MOEX.

## Секторы по источникам

### Crypto (Binance)

Автоматически из символа: `BTCUSDT` → baseCurrency: BTC

### ETF (Yahoo)

| Сектор | Примеры |
|--------|---------|
| `index` | SPY, QQQ, DIA |
| `technology` | XLK, VGT |
| `financials` | XLF, VFH |
| `healthcare` | XLV, VHT |
| `energy` | XLE, VDE |
| `bonds` | TLT, BND |
| `commodities` | GLD, SLV, USO |
| `real_estate` | VNQ, IYR |
| `volatility` | VXX, UVXY |

### S&P 500 (Yahoo)

| Сектор | Примеры |
|--------|---------|
| `technology` | AAPL, MSFT, NVDA |
| `financials` | JPM, BAC, GS |
| `healthcare` | JNJ, UNH, PFE |
| `consumer_cyclical` | AMZN, TSLA |
| `consumer_defensive` | PG, KO, WMT |
| `energy` | XOM, CVX |

### MOEX

| Сектор | Примеры |
|--------|---------|
| `financials` | SBER, VTBR |
| `energy` | GAZP, LKOH, ROSN |
| `materials` | GMKN, NLMK |
| `technology` | YNDX |
| `consumer` | MGNT, X5 |
| `telecom` | MTSS, RTKM |

## Scheduler интервалы

| Источник | Timeframe | Интервал |
|----------|-----------|----------|
| Binance | 1h | 5 минут |
| Binance | 1d | 1 час |
| Yahoo | 1h | 15 минут |
| Yahoo | 1d | 1 час |
| MOEX | 1h | 10 минут |
| MOEX | 1d | 1 час |

## Примеры интеграции

### Подписка на возможности

```typescript
import { db, marketOpportunity } from "@trader/db";
import { desc, gt } from "drizzle-orm";

const recentOpportunities = await db
  .select()
  .from(marketOpportunity)
  .where(gt(marketOpportunity.score, 70))
  .orderBy(desc(marketOpportunity.createdAt))
  .limit(10);
```

### Кросс-рыночный анализ

```typescript
import { db, marketAsset, marketTrend } from "@trader/db";
import { eq } from "drizzle-orm";

const strongTrends = await db
  .select()
  .from(marketTrend)
  .innerJoin(marketAsset, eq(marketTrend.assetId, marketAsset.id))
  .where(eq(marketTrend.isActive, "true"));
```
