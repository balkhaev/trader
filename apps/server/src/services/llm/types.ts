export type Sentiment =
  | "very_bullish"
  | "bullish"
  | "neutral"
  | "bearish"
  | "very_bearish";

export type RecommendedAction = "buy" | "sell" | "hold" | "monitor";

export type Timeframe = "immediate" | "short" | "medium" | "long";

export interface AffectedAsset {
  symbol: string;
  impact: "positive" | "negative" | "neutral";
  confidence: number;
}

export interface Recommendation {
  action: RecommendedAction;
  symbols: string[];
  reasoning: string;
  timeframe: Timeframe;
  confidence: number;
  risks: string[];
}

export interface AnalysisResult {
  sentiment: Sentiment;
  sentimentScore: number; // -1 to 1
  relevanceScore: number; // 0 to 1
  impactScore: number; // 0 to 1
  affectedAssets: AffectedAsset[];
  keyPoints: string[];
  marketImplications: string;
  recommendation: Recommendation;
}

export interface LLMResponse {
  result: AnalysisResult;
  model: string;
  promptTokens: number;
  completionTokens: number;
  rawResponse: Record<string, unknown>;
}

export interface ArticleInput {
  title: string;
  content?: string;
  summary?: string;
  source: string;
  publishedAt: Date;
  symbols?: string[];
}

export interface SignalGenerationParams {
  symbol: string;
  side: "long" | "short";
  strength: number;
  reasoning: string;
  suggestedStopLoss?: number;
  suggestedTakeProfit?: number;
}

export interface SignalGenerationResult {
  shouldCreateSignal: boolean;
  signalParams?: SignalGenerationParams;
}

export interface UserPreferences {
  riskTolerance: "low" | "medium" | "high";
  tradingStyle: "conservative" | "moderate" | "aggressive";
  watchlist?: string[];
}

// === POLYMARKET INTEGRATION TYPES ===

export interface ProbabilityImpactForecast {
  direction: "up" | "down" | "neutral";
  magnitude: "small" | "medium" | "large";
  confidence: number;
}

export interface SmartMoneySignal {
  sentiment: "bullish" | "bearish" | "neutral";
  reasoning: string;
}

export interface ConfidenceAdjustment {
  originalConfidence: number;
  adjustedConfidence: number;
  adjustmentReason: string;
}

export interface EnhancedAnalysisResult extends AnalysisResult {
  polymarketAlignment: number; // -1 to 1
  probabilityImpactForecast: ProbabilityImpactForecast;
  smartMoneySignal?: SmartMoneySignal;
  confidenceAdjustment: ConfidenceAdjustment;
}

export interface EnhancedLLMResponse {
  result: EnhancedAnalysisResult;
  model: string;
  promptTokens: number;
  completionTokens: number;
  rawResponse: Record<string, unknown>;
}

export interface PolymarketValidation {
  isAligned: boolean;
  divergenceLevel: "none" | "minor" | "significant" | "major";
  divergenceExplanation?: string;
  recommendedAction: "proceed" | "caution" | "reconsider";
}

// === TAG EXTRACTION TYPES ===

export type EntitySubtype =
  | "person"
  | "company"
  | "crypto"
  | "organization"
  | "protocol"
  | "exchange";

export type TopicCategory =
  | "regulation"
  | "defi"
  | "nft"
  | "macro"
  | "security"
  | "adoption"
  | "technology"
  | "market"
  | "governance";

export type EventType =
  | "hack"
  | "listing"
  | "delisting"
  | "lawsuit"
  | "announcement"
  | "partnership"
  | "acquisition"
  | "funding"
  | "launch"
  | "upgrade"
  | "bankruptcy";

export type RelationType =
  | "causal"
  | "temporal"
  | "mention"
  | "partnership"
  | "competitive";

export interface ExtractedEntity {
  name: string;
  type: EntitySubtype;
  sentiment: Sentiment;
  relevance: number;
  context: string;
  aliases: string[];
}

export interface ExtractedTopic {
  name: string;
  category: TopicCategory;
  sentiment: Sentiment;
  relevance: number;
}

export interface ExtractedEvent {
  name: string;
  type: EventType;
  date: string | null;
  severity: number;
  affectedEntities: string[];
}

export interface ExtractedRegion {
  name: string;
  sentiment: Sentiment;
  relevance: number;
}

export interface ExtractedRelation {
  source: string;
  target: string;
  type: RelationType;
  description: string;
}

export interface TagExtractionResult {
  entities: ExtractedEntity[];
  topics: ExtractedTopic[];
  events: ExtractedEvent[];
  regions: ExtractedRegion[];
  relations: ExtractedRelation[];
}

export interface TagExtractionResponse {
  result: TagExtractionResult;
  model: string;
  promptTokens: number;
  completionTokens: number;
  rawResponse: Record<string, unknown>;
}

// === TAG EXTRACTION TYPES ===

export type EntityType =
  | "person"
  | "company"
  | "crypto"
  | "organization"
  | "protocol"
  | "exchange";

export type TopicCategory =
  | "regulation"
  | "defi"
  | "nft"
  | "macro"
  | "security"
  | "adoption"
  | "technology"
  | "market"
  | "governance";

export type EventType =
  | "hack"
  | "listing"
  | "delisting"
  | "lawsuit"
  | "announcement"
  | "partnership"
  | "acquisition"
  | "funding"
  | "launch"
  | "upgrade"
  | "bankruptcy";

export type RelationType =
  | "causal"
  | "temporal"
  | "mention"
  | "partnership"
  | "competitive";

export interface ExtractedEntity {
  name: string;
  type: EntityType;
  sentiment: Sentiment;
  relevance: number;
  context: string;
  aliases?: string[];
}

export interface ExtractedTopic {
  name: string;
  category: TopicCategory;
  sentiment: Sentiment;
  relevance: number;
}

export interface ExtractedEvent {
  name: string;
  type: EventType;
  date: string | null;
  severity: number;
  affectedEntities: string[];
}

export interface ExtractedRegion {
  name: string;
  sentiment: Sentiment;
  relevance: number;
}

export interface ExtractedRelation {
  source: string;
  target: string;
  type: RelationType;
  description: string;
}

export interface TagExtractionResult {
  entities: ExtractedEntity[];
  topics: ExtractedTopic[];
  events: ExtractedEvent[];
  regions: ExtractedRegion[];
  relations: ExtractedRelation[];
}

export interface TagExtractionResponse {
  result: TagExtractionResult;
  model: string;
  promptTokens: number;
  completionTokens: number;
  rawResponse: Record<string, unknown>;
}
