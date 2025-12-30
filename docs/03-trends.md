# Trends Service

> Базовая информация в [AGENTS.md](../AGENTS.md#trends-service)

Анализ новостных трендов с извлечением структурированных тегов через LLM.

## Архитектура обработки

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   News Article  │────▶│  Tag Extractor   │────▶│    news_tag     │
└─────────────────┘     │    (LLM GPT-4)   │     │  tag_mention    │
                        └──────────────────┘     └────────┬────────┘
                                                         │
                        ┌──────────────────┐             │
                        │ Trend Aggregator │◀────────────┘
                        │  (velocity/acc)  │
                        └────────┬─────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          ▼                      ▼                      ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Graph Builder  │    │ Trend Snapshot  │    │Anomaly Detector │
│ (co-occurrence) │    │  (1h/24h/7d)    │    │ (spikes/shifts) │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Полная структура LLM извлечения

### Промпт

Промпт возвращает структурированный JSON:

```typescript
interface TagExtractionResult {
  entities: {
    name: string;                    // "Bitcoin", "Coinbase"
    type: "person" | "company" | "crypto" | "protocol" | "exchange";
    sentiment: "positive" | "negative" | "neutral";
    relevance: number;               // 0-1, важность в контексте статьи
    context: string;                 // "упоминается как актив"
    aliases: string[];               // ["BTC", "биткоин"]
  }[];
  
  topics: {
    name: string;                    // "ETF approval"
    category: "regulation" | "defi" | "nft" | "macro" | "security" | "adoption";
    sentiment: "positive" | "negative" | "neutral";
    relevance: number;
  }[];
  
  events: {
    name: string;                    // "SEC lawsuit"
    type: "hack" | "listing" | "lawsuit" | "announcement" | "partnership";
    date: string | null;             // ISO дата если указана
    severity: number;                // 1-10
    affectedEntities: string[];      // ["Ripple", "XRP"]
  }[];
  
  regions: {
    name: string;                    // ISO: "USA", "EU", "China"
    sentiment: "positive" | "negative" | "neutral";
    relevance: number;
  }[];
  
  relations: {
    source: string;                  // "SEC"
    target: string;                  // "Coinbase"
    type: "causal" | "temporal" | "partnership" | "competitive";
    description: string;             // "судится с"
  }[];
}
```

## Типы алертов

| Тип | Описание | Триггер |
|-----|----------|---------|
| `spike` | Резкий рост упоминаний | +200% за час |
| `sentiment_shift` | Смена тональности | >0.3 за 24ч |
| `new_trend` | Новый растущий тренд | >50 упоминаний/час |
| `declining_trend` | Угасающий тренд | -70% за 24ч |
| `correlation_break` | Разрыв связи между тегами | Strength < 0.1 |

## Метрики трендов

```typescript
interface TrendMetrics {
  mentionCount: number;       // Всего упоминаний
  velocity: number;           // Упоминаний/час
  acceleration: number;       // Изменение velocity
  avgSentiment: number;       // -1 до 1
  sentimentVolatility: number; // Разброс настроений
  
  // Периодические снимки
  count1h: number;
  count24h: number;
  count7d: number;
  
  // Тренд
  growthPercent24h: number;
  isRising: boolean;
}
```

## Граф связей

### Построение

```typescript
interface GraphNode {
  id: string;           // tag ID
  name: string;
  type: "entity" | "topic" | "event" | "region";
  weight: number;       // Количество упоминаний
  sentiment: number;    // Средний sentiment
}

interface GraphEdge {
  source: string;       // tag ID
  target: string;       // tag ID
  weight: number;       // Сила связи (co-occurrence)
  type: "co_occurrence" | "causal" | "temporal";
}
```

### Алгоритм связей

1. **Co-occurrence**: Два тега упоминаются в одной статье
2. **Causal**: LLM определил причинно-следственную связь
3. **Temporal**: События произошли в близкие даты

## Периодические задачи

```typescript
// Каждый час: снимки трендов
await trendAggregatorService.createSnapshotsForAllTags("1h");

// Каждые 5 минут: обнаружение аномалий
await anomalyDetectorService.runFullScan();

// Каждые 24 часа: обновление агрегатов
await trendAggregatorService.updateAllTagAggregates();
await graphBuilderService.updateRelationStrengths();
```

## Примеры использования

### Подписка на алерты

```typescript
import { anomalyEvents } from "@/services/trends";

anomalyEvents.on("alert", (alert) => {
  // alert: { tagId, tagName, alertType, severity, title, description }
  
  if (alert.severity >= 8) {
    // Отправить в Telegram
    await sendTelegramAlert(alert);
  }
});
```

### Визуализация графа

```typescript
import { graphBuilderService } from "@/services/trends";

const graph = await graphBuilderService.buildGraph({
  maxNodes: 100,
  minStrength: 0.1,
  periodDays: 7,
  centerTag: "Bitcoin",  // Эго-граф
});

// Для D3.js или vis.js
const d3Data = {
  nodes: graph.nodes.map(n => ({ id: n.id, label: n.name, size: n.weight })),
  links: graph.edges.map(e => ({ source: e.source, target: e.target, value: e.weight })),
};
```

### Получение hot trends для дашборда

```typescript
import { trendAggregatorService } from "@/services/trends";

const hotTrends = await trendAggregatorService.getHotTrends("24h", 20);
// [{ tagId, tagName, tagType, mentionCount, growthPercent, avgSentiment }]

// Топ растущие
const rising = hotTrends.filter(t => t.growthPercent > 50);

// Топ негативные
const negative = hotTrends.filter(t => t.avgSentiment < -0.3);
```
