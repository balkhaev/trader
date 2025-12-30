import { env } from "@trader/env/server";
import OpenAI from "openai";
import {
  buildNewsAnalysisPrompt,
  NEWS_ANALYSIS_SYSTEM_PROMPT,
} from "./prompts/news-analysis";
import type {
  AnalysisResult,
  ArticleInput,
  LLMResponse,
  SignalGenerationResult,
  UserPreferences,
} from "./types";

let openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  if (!openai) {
    openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return openai;
}

export const openaiService = {
  isConfigured(): boolean {
    return !!env.OPENAI_API_KEY;
  },

  async analyzeNews(article: ArticleInput): Promise<LLMResponse> {
    const client = getOpenAI();
    const userPrompt = buildNewsAnalysisPrompt(article);

    const response = await client.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [
        { role: "system", content: NEWS_ANALYSIS_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from OpenAI");
    }

    const result = JSON.parse(content) as AnalysisResult;

    // Валидация результата
    if (!result.sentiment || result.sentimentScore === undefined) {
      throw new Error("Invalid analysis result: missing required fields");
    }

    return {
      result,
      model: response.model,
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      rawResponse: response as unknown as Record<string, unknown>,
    };
  },

  async extractTags(article: ArticleInput): Promise<TagExtractionResponse> {
    const client = getOpenAI();
    const userPrompt = buildTagExtractionPrompt(article);

    const response = await client.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [
        { role: "system", content: TAG_EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2, // Lower temperature for more consistent extraction
      max_tokens: 3000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from OpenAI");
    }

    const result = JSON.parse(content) as TagExtractionResult;

    // Валидация структуры
    if (
      !(result.entities && result.topics && result.events && result.regions)
    ) {
      throw new Error("Invalid tag extraction result: missing required arrays");
    }

    // Нормализация - убедимся что все массивы существуют
    result.entities = result.entities || [];
    result.topics = result.topics || [];
    result.events = result.events || [];
    result.regions = result.regions || [];
    result.relations = result.relations || [];

    return {
      result,
      model: response.model,
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      rawResponse: response as unknown as Record<string, unknown>,
    };
  },

  async extractTags(article: ArticleInput): Promise<TagExtractionResponse> {
    const client = getOpenAI();
    const userPrompt = buildTagExtractionPrompt(article);

    const response = await client.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [
        { role: "system", content: TAG_EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2, // Низкая температура для консистентности
      max_tokens: 4000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from OpenAI");
    }

    const result = JSON.parse(content) as TagExtractionResult;

    // Валидация и нормализация результата
    if (!result.entities) result.entities = [];
    if (!result.topics) result.topics = [];
    if (!result.events) result.events = [];
    if (!result.regions) result.regions = [];
    if (!result.relations) result.relations = [];

    return {
      result,
      model: response.model,
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      rawResponse: response as unknown as Record<string, unknown>,
    };
  },

  generateSignalFromAnalysis(
    analysis: AnalysisResult,
    userPreferences: UserPreferences
  ): SignalGenerationResult {
    const { recommendation, impactScore } = analysis;

    // Не создаем сигнал если:
    // - Рекомендация "hold" или "monitor"
    // - Низкий impactScore (< 0.5)
    // - Низкая confidence (< 0.6)
    if (
      recommendation.action === "hold" ||
      recommendation.action === "monitor" ||
      impactScore < 0.5 ||
      recommendation.confidence < 0.6
    ) {
      return { shouldCreateSignal: false };
    }

    // Фильтруем по watchlist если есть
    const targetSymbols = userPreferences.watchlist?.length
      ? recommendation.symbols.filter((s) =>
          userPreferences.watchlist!.includes(s)
        )
      : recommendation.symbols;

    if (targetSymbols.length === 0) {
      return { shouldCreateSignal: false };
    }

    // Корректируем strength по risk tolerance
    let strengthMultiplier = 1;
    if (userPreferences.riskTolerance === "low") strengthMultiplier = 0.7;
    if (userPreferences.riskTolerance === "high") strengthMultiplier = 1.3;

    const strength = Math.min(
      100,
      Math.round(recommendation.confidence * 100 * strengthMultiplier)
    );

    // Минимальный порог для создания сигнала
    if (strength < 50) {
      return { shouldCreateSignal: false };
    }

    return {
      shouldCreateSignal: true,
      signalParams: {
        symbol: targetSymbols[0]!,
        side: recommendation.action === "buy" ? "long" : "short",
        strength,
        reasoning: recommendation.reasoning,
      },
    };
  },

  // === POLYMARKET ENHANCED METHODS ===

  async analyzeNewsWithPolymarket(
    article: ArticleInput,
    polymarketContext: PolymarketContext
  ): Promise<EnhancedLLMResponse> {
    const { buildEnhancedNewsPrompt, POLYMARKET_ENHANCED_SYSTEM_PROMPT } =
      await import("./prompts/polymarket-context");

    const client = getOpenAI();
    const userPrompt = buildEnhancedNewsPrompt(article, polymarketContext);

    const response = await client.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [
        { role: "system", content: POLYMARKET_ENHANCED_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 3000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from OpenAI");
    }

    const result = JSON.parse(content) as EnhancedAnalysisResult;

    // Валидация базовых полей
    if (!result.sentiment || result.sentimentScore === undefined) {
      throw new Error("Invalid analysis result: missing required fields");
    }

    // Дефолтные значения для Polymarket полей если отсутствуют
    if (result.polymarketAlignment === undefined) {
      result.polymarketAlignment = 0;
    }
    if (!result.probabilityImpactForecast) {
      result.probabilityImpactForecast = {
        direction: "neutral",
        magnitude: "small",
        confidence: 0.5,
      };
    }
    if (!result.confidenceAdjustment) {
      result.confidenceAdjustment = {
        originalConfidence: result.recommendation.confidence,
        adjustedConfidence: result.recommendation.confidence,
        adjustmentReason: "No Polymarket data to adjust",
      };
    }

    return {
      result,
      model: response.model,
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      rawResponse: response as unknown as Record<string, unknown>,
    };
  },

  validateSignalWithPolymarket(
    signal: SignalGenerationParams,
    polymarketContext: PolymarketContext
  ): PolymarketValidation {
    const relevantEvents = polymarketContext.events.filter(
      (e) => e.relevance > 0.5
    );

    if (relevantEvents.length === 0) {
      return {
        isAligned: true,
        divergenceLevel: "none",
        recommendedAction: "proceed",
      };
    }

    // Анализируем согласованность сигнала с Polymarket
    const avgProbChange =
      relevantEvents.reduce((sum, e) => sum + e.probabilityChange24h, 0) /
      relevantEvents.length;

    const signalDirection = signal.side === "long" ? 1 : -1;
    const marketDirection =
      avgProbChange > 0.02 ? 1 : avgProbChange < -0.02 ? -1 : 0;

    const isAligned =
      signalDirection === marketDirection || marketDirection === 0;

    let divergenceLevel: PolymarketValidation["divergenceLevel"] = "none";
    if (!isAligned) {
      const divergenceMagnitude = Math.abs(avgProbChange);
      if (divergenceMagnitude > 0.1) divergenceLevel = "major";
      else if (divergenceMagnitude > 0.05) divergenceLevel = "significant";
      else divergenceLevel = "minor";
    }

    let recommendedAction: PolymarketValidation["recommendedAction"] =
      "proceed";
    if (divergenceLevel === "major") recommendedAction = "reconsider";
    else if (divergenceLevel === "significant") recommendedAction = "caution";

    return {
      isAligned,
      divergenceLevel,
      divergenceExplanation: isAligned
        ? undefined
        : `News suggests ${signal.side} but prediction markets moved ${avgProbChange > 0 ? "up" : "down"} ${(Math.abs(avgProbChange) * 100).toFixed(1)}%`,
      recommendedAction,
    };
  },

  adjustSignalStrength(
    baseStrength: number,
    alignment: number,
    divergenceLevel: PolymarketValidation["divergenceLevel"]
  ): number {
    let multiplier = 1;

    // Alignment bonus/penalty
    if (alignment > 0.5) multiplier += 0.1;
    else if (alignment < -0.5) multiplier -= 0.2;

    // Divergence penalty
    if (divergenceLevel === "major") multiplier -= 0.3;
    else if (divergenceLevel === "significant") multiplier -= 0.15;
    else if (divergenceLevel === "minor") multiplier -= 0.05;

    return Math.round(Math.max(0, Math.min(100, baseStrength * multiplier)));
  },

  /**
   * Generic chat method for agents and market generation
   */
  async chat(params: {
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    responseFormat?: { type: "json_object" | "text" };
    temperature?: number;
  }): Promise<{ content: string | null }> {
    const client = getOpenAI();

    const response = await client.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: params.messages,
      response_format: params.responseFormat ?? { type: "text" },
      temperature: params.temperature ?? 0.7,
      max_tokens: 4000,
    });

    return {
      content: response.choices[0]?.message?.content ?? null,
    };
  },
};

// Импортируем типы динамически чтобы избежать circular dependencies
import type { PolymarketContext } from "../polymarket-correlation.service";
import type {
  EnhancedAnalysisResult,
  EnhancedLLMResponse,
  PolymarketValidation,
  SignalGenerationParams,
} from "./types";
