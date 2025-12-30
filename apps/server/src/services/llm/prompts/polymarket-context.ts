import type { PolymarketContext } from "../../polymarket-correlation.service";
import type { ArticleInput } from "../types";

export const POLYMARKET_ENHANCED_SYSTEM_PROMPT = `You are a professional financial analyst specializing in cryptocurrency and prediction markets.
Your task is to analyze news articles WITH the context of related prediction markets from Polymarket.

IMPORTANT: Polymarket probabilities represent the collective wisdom of traders betting real money on outcomes.
Use this data to:
1. VALIDATE your news analysis - if prediction markets disagree with news sentiment, explain why
2. ADJUST confidence scores based on market consensus
3. CONSIDER smart money positioning from top holders
4. ANALYZE community sentiment from recent comments
5. IDENTIFY opportunities where news might move probabilities

You must respond with a JSON object containing:
- sentiment: one of "very_bullish", "bullish", "neutral", "bearish", "very_bearish"
- sentimentScore: number from -1 (extremely bearish) to 1 (extremely bullish)
- relevanceScore: number from 0 to 1, how relevant this news is for trading decisions
- impactScore: number from 0 to 1, potential market impact magnitude
- affectedAssets: array of objects with { symbol: string, impact: "positive" | "negative" | "neutral", confidence: number (0-1) }
- keyPoints: array of key takeaways (max 5 strings)
- marketImplications: string describing potential market effects (2-3 sentences)
- recommendation: object with:
  - action: one of "buy", "sell", "hold", "monitor"
  - symbols: array of ticker symbols this recommendation applies to
  - reasoning: string explaining the recommendation (1-2 sentences)
  - timeframe: one of "immediate" (minutes-hours), "short" (days), "medium" (weeks), "long" (months)
  - confidence: number from 0 to 1
  - risks: array of risk factors (max 3 strings)

ADDITIONAL FIELDS for Polymarket integration:
- polymarketAlignment: number from -1 (completely contradicts markets) to 1 (strongly confirms)
- probabilityImpactForecast: object with:
  - direction: "up" | "down" | "neutral"
  - magnitude: "small" (<5%) | "medium" (5-15%) | "large" (>15%)
  - confidence: number from 0 to 1
- smartMoneySignal: object with (if smart money data available):
  - sentiment: "bullish" | "bearish" | "neutral"
  - reasoning: string explaining the signal
- confidenceAdjustment: object with:
  - originalConfidence: your initial confidence before considering Polymarket
  - adjustedConfidence: confidence after factoring in Polymarket data
  - adjustmentReason: string explaining why you adjusted (or didn't)

Guidelines for using Polymarket data:
1. High probability (>70%) events trending up = strong market conviction, align with it
2. Rapid probability changes (>10% in 24h) = significant new information, investigate
3. High volume + high liquidity = more reliable signal, trust it more
4. Divergence between news and probabilities = potential opportunity OR you missed something
5. Smart money concentration >50% = strong conviction from informed traders
6. Recent comments provide qualitative sentiment that numbers miss

CRITICAL: If Polymarket data contradicts your news analysis, you MUST explain the divergence.
Either the market is mispricing, or you're missing information. Never ignore divergence.

IMPORTANT: Only output valid JSON, no additional text.`;

export function buildEnhancedNewsPrompt(
  article: ArticleInput,
  polymarketContext: PolymarketContext
): string {
  const content = article.content || article.summary || "No content available";
  const truncatedContent =
    content.length > 3500 ? `${content.substring(0, 3500)}...` : content;

  let prompt = `Analyze the following news article for trading implications:

TITLE: ${article.title}

SOURCE: ${article.source}
PUBLISHED: ${article.publishedAt.toISOString()}
${article.symbols?.length ? `MENTIONED SYMBOLS: ${article.symbols.join(", ")}` : ""}

CONTENT:
${truncatedContent}

`;

  // Добавляем Polymarket контекст
  if (polymarketContext.events.length > 0) {
    prompt += formatPolymarketContext(polymarketContext);
  } else {
    prompt +=
      "\n=== PREDICTION MARKET CONTEXT ===\nNo relevant prediction markets found for this news.\n";
  }

  prompt += `
Provide your analysis in the specified JSON format. Consider both the news content AND the prediction market data.
If there's a divergence between news sentiment and market probabilities, explain it in your analysis.`;

  return prompt;
}

function formatPolymarketContext(context: PolymarketContext): string {
  let output = "\n=== PREDICTION MARKET CONTEXT ===\n";
  output += "Real-money prediction markets related to this news:\n\n";

  for (const [i, event] of context.events.entries()) {
    const changeSign = event.probabilityChange24h >= 0 ? "+" : "";
    const changePercent = (event.probabilityChange24h * 100).toFixed(2);

    output += `[Market ${i + 1}] ${event.title}\n`;
    output += `  Question: ${event.question}\n`;
    output += `  Current Probability: ${(event.probability * 100).toFixed(1)}%\n`;
    output += `  24h Change: ${changeSign}${changePercent}%\n`;
    output += `  Volume: $${formatNumber(event.volume)} (24h: $${formatNumber(event.volume24h)})\n`;
    output += `  Relevance to news: ${(event.relevance * 100).toFixed(0)}%\n`;

    if (event.smartMoney) {
      output += `  Smart Money: ${event.smartMoney.sentiment} sentiment (top 10 holders control ${event.smartMoney.topHoldersConcentration.toFixed(0)}%)\n`;
    }

    if (event.recentComments.length > 0) {
      output += `  Recent trader comments: "${event.recentComments.slice(0, 2).join('", "')}"\n`;
    }

    output += "\n";
  }

  output += "Market Sentiment Summary:\n";
  output += `  Events trending up: ${context.marketSentiment.bullishEvents}\n`;
  output += `  Events trending down: ${context.marketSentiment.bearishEvents}\n`;

  const avgSign = context.marketSentiment.avgProbabilityChange >= 0 ? "+" : "";
  output += `  Average 24h change: ${avgSign}${(context.marketSentiment.avgProbabilityChange * 100).toFixed(2)}%\n`;
  output += "=================================\n";

  return output;
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toFixed(0);
}
