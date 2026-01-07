# Specification: Enhance News Analysis Integration for Agent Input System

## Overview

This feature enhances the existing news analysis pipeline to provide richer, more frequent data to trading agents. The system already has news parsing and agent integration, but needs improvements to: (1) increase news refresh frequency, (2) enrich the news context provided to agents with analysis data, and (3) ensure the news pipeline runs continuously and reliably as a core agent input source.

## Workflow Type

**Type**: feature

**Rationale**: This is a feature enhancement that extends existing functionality. The news service, scheduler, and agent context builder already exist - we're enhancing integration depth and data richness rather than building from scratch.

## Task Scope

### Services Involved
- **server** (primary) - Contains news service, scheduler, and agent executor
- **db** (integration) - Schema already defined for news and analysis

### This Task Will:
- [ ] Reduce news batch fetch interval from 5 minutes to 2 minutes for faster updates
- [ ] Enhance `NewsContext` interface to include analysis data (keyPoints, recommendations, affectedAssets)
- [ ] Enrich `getNewsContext()` to aggregate analyzed news data for agents
- [ ] Add news sentiment trends (comparing current vs previous period) to agent context
- [ ] Ensure news scheduler auto-starts reliably with the server
- [ ] Add real-time news event emission to agent decision triggers

### Out of Scope:
- Adding new news source types/parsers
- Changing the database schema (already comprehensive)
- Frontend changes
- New agent types

## Service Context

### Server (apps/server)

**Tech Stack:**
- Language: TypeScript
- Framework: Hono
- Task Queue: BullMQ
- ORM: Drizzle

**Entry Point:** `src/index.ts`

**How to Run:**
```bash
bun dev
```

**Port:** 3000

**Key Directories:**
- `src/services/news/` - News parsing, scheduler, analysis
- `src/services/agent/executor/` - Agent execution and context building
- `src/services/llm/` - OpenAI integration for news analysis

## Files to Modify

| File | Service | What to Change |
|------|---------|---------------|
| `apps/server/src/services/news/scheduler.ts` | server | Reduce FETCH_INTERVAL to 2 minutes, add news event emission for agent triggers |
| `apps/server/src/services/agent/executor/types.ts` | server | Extend NewsContext interface with analysis fields |
| `apps/server/src/services/agent/executor/context-builder.service.ts` | server | Enrich getNewsContext() to include analysis data |
| `apps/server/src/services/agent/executor.service.ts` | server | Format enriched news data in prompt |
| `apps/server/src/services/news/realtime/event-emitter.ts` | server | Add events for agent notification |

## Files to Reference

These files show patterns to follow:

| File | Pattern to Copy |
|------|----------------|
| `apps/server/src/services/agent/executor/context-builder.service.ts` | How to build context with async data fetching |
| `apps/server/src/services/news/scheduler.ts` | Scheduler pattern with timers and status tracking |
| `apps/server/src/services/news/deduplication.service.ts` | How to aggregate news data for consumption |
| `packages/db/src/schema/news.ts` | Available fields in newsAnalysis table |

## Patterns to Follow

### Context Builder Pattern

From `apps/server/src/services/agent/executor/context-builder.service.ts`:

```typescript
private async getNewsContext(
  strategy: AgentStrategy
): Promise<NewsContext | undefined> {
  if (!strategy.dataSources.includes("news")) {
    return undefined;
  }
  // Fetch and aggregate data...
}
```

**Key Points:**
- Check if data source is enabled in strategy before fetching
- Return undefined if not applicable
- Use parallel Promise.all for multiple fetches
- Log context building with structured data

### Event Emitter Pattern

From `apps/server/src/services/news/realtime/event-emitter.ts`:

```typescript
class NewsEventEmitter {
  private emitter = new EventEmitter();

  emitArticleSaved(article: ParsedArticle, sourceId: string, sourceName: string) {
    this.emitter.emit("article:saved", { article, sourceId, sourceName });
  }
}
```

**Key Points:**
- Use typed event names
- Include relevant context in event payload
- Allow subscribers to filter by criteria

## Requirements

### Functional Requirements

1. **Increased News Frequency**
   - Description: Reduce batch fetch interval from 5 to 2 minutes
   - Acceptance: News fetch logs show 2-minute intervals

2. **Enriched News Context for Agents**
   - Description: Include keyPoints, recommendations, affectedAssets, sentimentScore in agent context
   - Acceptance: Agent decision prompt shows enriched news data

3. **News Sentiment Trends**
   - Description: Calculate sentiment change vs previous period (1h, 24h)
   - Acceptance: Context includes sentimentTrend field with direction

4. **Continuous Operation**
   - Description: News scheduler starts automatically and recovers from errors
   - Acceptance: Server logs show scheduler start on boot, no manual intervention needed

5. **Real-time News Events for Agents**
   - Description: Emit events when high-impact news arrives that agents can subscribe to
   - Acceptance: Event emitted when news with impactScore > 0.7 is analyzed

### Edge Cases

1. **No analyzed news available** - Fall back to raw headlines with neutral sentiment
2. **OpenAI API unavailable** - Use cached analysis, log warning, continue operating
3. **Empty news period** - Return empty context rather than undefined
4. **High-impact news burst** - Rate limit agent triggers to prevent overload

## Implementation Notes

### DO
- Follow the existing context builder pattern in `context-builder.service.ts`
- Reuse `deduplicationService.listCanonical()` for deduplicated stories
- Use `newsRepository` methods for data access
- Keep scheduler interval configurable via constants
- Log all state changes with structured data

### DON'T
- Create new database tables (schema is already comprehensive)
- Add new parser types (out of scope)
- Change the existing analysis prompt (separate concern)
- Make breaking changes to existing NewsContext consumers

## Development Environment

### Start Services

```bash
bun dev              # Starts all apps (web:3001 + server:3000)
```

### Service URLs
- Server API: http://localhost:3000
- Web Frontend: http://localhost:3001

### Required Environment Variables
- `DATABASE_URL`: PostgreSQL connection string
- `OPENAI_API_KEY`: For news analysis (optional, degrades gracefully)
- `REDIS_URL`: For BullMQ task queue

### Verify News System Running
```bash
# Check scheduler status
curl http://localhost:3000/api/news/scheduler/status

# Check realtime status
curl http://localhost:3000/api/news/realtime/status
```

## Success Criteria

The task is complete when:

1. [ ] News fetch interval reduced to 2 minutes (check scheduler.ts FETCH_INTERVAL)
2. [ ] NewsContext interface includes: keyPoints, recommendations, affectedAssets, sentimentScore, sentimentTrend
3. [ ] getNewsContext() aggregates analysis data from newsAnalysis table
4. [ ] Agent decision prompt includes enriched news data
5. [ ] High-impact news (impactScore > 0.7) triggers event emission
6. [ ] No console errors
7. [ ] Existing tests still pass
8. [ ] Server starts with news scheduler running automatically

## QA Acceptance Criteria

**CRITICAL**: These criteria must be verified by the QA Agent before sign-off.

### Unit Tests
| Test | File | What to Verify |
|------|------|----------------|
| NewsContext enrichment | `apps/server/src/services/agent/executor/context-builder.service.ts` | getNewsContext returns analysis fields when available |
| Scheduler interval | `apps/server/src/services/news/scheduler.ts` | FETCH_INTERVAL is 2 * 60 * 1000 |

### Integration Tests
| Test | Services | What to Verify |
|------|----------|----------------|
| News → Agent Context | news ↔ agent | Agent buildContext includes enriched news when strategy.dataSources includes "news" |
| News Event → Agent | news ↔ event-emitter | High-impact analyzed news emits event |

### End-to-End Tests
| Flow | Steps | Expected Outcome |
|------|-------|------------------|
| Agent receives news | 1. Create agent with news datasource 2. Wait for execution cycle 3. Check logs | Decision prompt shows enriched news data |
| News auto-start | 1. Start server 2. Check scheduler status | isRunning: true, realtimeRunning: true |

### API Verification
| Endpoint | Method | Expected |
|----------|--------|----------|
| `/api/news/scheduler/status` | GET | `{ running: true, realtimeRunning: true }` |
| `/api/news/realtime/status` | GET | `{ isRunning: true, ... }` |

### Database Verification (if applicable)
| Check | Query/Command | Expected |
|-------|---------------|----------|
| News analysis exists | `SELECT COUNT(*) FROM news_analysis WHERE status = 'completed'` | > 0 (analysis running) |

### QA Sign-off Requirements
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] All E2E tests pass
- [ ] API verification complete
- [ ] No regressions in existing functionality
- [ ] Code follows established patterns
- [ ] No security vulnerabilities introduced
- [ ] News scheduler starts automatically on server boot
- [ ] Agent prompts show enriched news data

## Technical Details

### Enhanced NewsContext Interface

```typescript
interface NewsContext {
  headlines: string[];
  sentiment: number;
  // New fields
  keyPoints?: string[];
  recommendations?: {
    action: 'buy' | 'sell' | 'hold' | 'monitor';
    symbols: string[];
    reasoning: string;
  }[];
  affectedAssets?: {
    symbol: string;
    impact: 'positive' | 'negative' | 'neutral';
    confidence: number;
  }[];
  sentimentTrend?: {
    direction: 'improving' | 'declining' | 'stable';
    change: number; // -1 to 1
    period: '1h' | '24h';
  };
}
```

### Scheduler Constants Update

```typescript
// Current
const FETCH_INTERVAL = 5 * 60 * 1000; // 5 minutes

// New
const FETCH_INTERVAL = 2 * 60 * 1000; // 2 minutes
```

### High-Impact News Event

```typescript
// In scheduler.ts analyzeUnprocessedArticles
if (llmResponse.result.impactScore > 0.7) {
  newsEventEmitter.emitHighImpactNews({
    articleId: article.id,
    title: article.title,
    sentiment: llmResponse.result.sentiment,
    impactScore: llmResponse.result.impactScore,
    affectedAssets: llmResponse.result.affectedAssets,
  });
}
```
