import type { CreateAgentData, RiskLevel, StrategyType } from "@trader/db";
import type { AgentStrategy, RiskParams } from "@trader/db/schema/agent";

/**
 * Preset agents for the platform
 * These are pre-configured agents that users can allocate to
 */

// ===== Tanker Scout Agent =====
// Strategy: Long commodities when tanker flow drops

const tankerScoutStrategy: AgentStrategy = {
  type: "transport",
  description:
    "Monitors global tanker traffic patterns. When crude oil tanker activity drops significantly in key shipping lanes, it signals potential supply constraints - triggering long positions in oil-related assets.",
  dataSources: ["transport", "market"],
  entryRules: [
    {
      condition: "tanker_flow_change_24h",
      threshold: -15,
      operator: "<",
    },
    {
      condition: "port_congestion_score",
      threshold: 70,
      operator: ">",
    },
  ],
  exitRules: [
    { type: "takeProfit", value: 5 },
    { type: "stopLoss", value: 3 },
    { type: "timeExit", value: 168 }, // 7 days in hours
  ],
  symbols: ["CL", "USO", "XLE", "BTCUSDT"],
  timeframes: ["4h", "1d"],
};

const tankerScoutRisk: RiskParams = {
  maxPositionSize: 10,
  maxDrawdown: 15,
  maxDailyLoss: 5,
  maxOpenPositions: 3,
  minTimeBetweenTrades: 3600, // 1 hour
};

export const tankerScoutAgent: CreateAgentData = {
  name: "Tanker Scout",
  slug: "tanker-scout",
  description:
    "Tracks global oil tanker movements to predict supply shocks. When tanker traffic drops in key routes like the Persian Gulf or Strait of Hormuz, this agent goes long on oil and energy assets.",
  avatarUrl: "https://api.dicebear.com/7.x/bottts/svg?seed=tanker",
  strategyType: "transport" as StrategyType,
  strategy: tankerScoutStrategy,
  riskParams: tankerScoutRisk,
  riskLevel: "medium" as RiskLevel,
  isPublic: true,
};

// ===== News Hawk Agent =====
// Strategy: Trade crypto on news sentiment

const newsHawkStrategy: AgentStrategy = {
  type: "news",
  description:
    "Scans crypto news in real-time for sentiment shifts. Enters momentum trades when multiple positive or negative news articles cluster around a specific asset.",
  dataSources: ["news", "market"],
  entryRules: [
    {
      condition: "sentiment_score_1h",
      threshold: 0.7,
      operator: ">",
    },
    {
      condition: "news_volume_1h",
      threshold: 5,
      operator: ">",
    },
  ],
  exitRules: [
    { type: "takeProfit", value: 8 },
    { type: "stopLoss", value: 4 },
    { type: "trailingStop", value: 2 },
    { type: "timeExit", value: 24 }, // 24 hours
  ],
  symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"],
  timeframes: ["15m", "1h"],
};

const newsHawkRisk: RiskParams = {
  maxPositionSize: 15,
  maxDrawdown: 20,
  maxDailyLoss: 8,
  maxOpenPositions: 4,
  minTimeBetweenTrades: 900, // 15 minutes
};

export const newsHawkAgent: CreateAgentData = {
  name: "News Hawk",
  slug: "news-hawk",
  description:
    "AI-powered news sentiment trader. Monitors crypto news feeds 24/7, detecting sentiment shifts before they hit the market. Executes quick momentum trades based on breaking news.",
  avatarUrl: "https://api.dicebear.com/7.x/bottts/svg?seed=hawk",
  strategyType: "news" as StrategyType,
  strategy: newsHawkStrategy,
  riskParams: newsHawkRisk,
  riskLevel: "high" as RiskLevel,
  isPublic: true,
};

// ===== Macro Oracle Agent =====
// Strategy: Macro positioning based on Fed signals

const macroOracleStrategy: AgentStrategy = {
  type: "macro",
  description:
    "Analyzes Federal Reserve communications, economic data releases, and prediction market probabilities to position in macro assets. Takes longer-term positions based on monetary policy direction.",
  dataSources: ["news", "prediction"],
  entryRules: [
    {
      condition: "fed_sentiment_shift",
      threshold: 0.3,
      operator: ">",
    },
    {
      condition: "rate_hike_probability_change",
      threshold: 10,
      operator: ">",
    },
  ],
  exitRules: [
    { type: "takeProfit", value: 12 },
    { type: "stopLoss", value: 6 },
    { type: "timeExit", value: 720 }, // 30 days in hours
  ],
  symbols: ["SPY", "TLT", "GLD", "DXY", "BTCUSDT"],
  timeframes: ["1d", "1w"],
};

const macroOracleRisk: RiskParams = {
  maxPositionSize: 8,
  maxDrawdown: 12,
  maxDailyLoss: 3,
  maxOpenPositions: 2,
  minTimeBetweenTrades: 86_400, // 24 hours
};

export const macroOracleAgent: CreateAgentData = {
  name: "Macro Oracle",
  slug: "macro-oracle",
  description:
    "Reads between the lines of Fed speeches and economic data. Uses prediction markets to gauge policy expectations, then positions in stocks, bonds, gold, and crypto based on macro regime changes.",
  avatarUrl: "https://api.dicebear.com/7.x/bottts/svg?seed=oracle",
  strategyType: "macro" as StrategyType,
  strategy: macroOracleStrategy,
  riskParams: macroOracleRisk,
  riskLevel: "low" as RiskLevel,
  isPublic: true,
};

// ===== All Preset Agents =====

export const presetAgents: CreateAgentData[] = [
  tankerScoutAgent,
  newsHawkAgent,
  macroOracleAgent,
];

export default presetAgents;
