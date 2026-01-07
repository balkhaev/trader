import type { InferSelectModel } from "drizzle-orm";
import { and, count, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { predictionVector } from "../schema/prediction-market";
import {
  BaseRepository,
  type PaginatedResult,
  type PaginationParams,
} from "./base.repository";

// Types
export type PredictionVector = InferSelectModel<typeof predictionVector>;

export type PredictionVectorStatus = "pending" | "checked" | "resolved";

export interface PredictionVectorFilters extends PaginationParams {
  agentId?: string;
  marketId?: string;
  status?: PredictionVectorStatus;
  confidenceMin?: number;
  confidenceMax?: number;
  predictedAfter?: Date;
  predictedBefore?: Date;
}

export interface CreatePredictionVectorData {
  agentId: string;
  marketId: string;
  prediction: "yes" | "no";
  confidence: string;
  reasoning?: string;
  status?: PredictionVectorStatus;
  checkCount?: number;
}

export interface ConfidenceBucket {
  range: string;
  minConfidence: number;
  maxConfidence: number;
  totalPredictions: number;
  resolvedPredictions: number;
  avgAccuracy: number | null;
  calibration: number | null;
}

export interface AgentPredictionStats {
  totalPredictions: number;
  resolvedPredictions: number;
  avgAccuracy: number | null;
  avgConfidence: number | null;
  calibrationScore: number | null;
}

class PredictionVectorRepository extends BaseRepository<
  typeof predictionVector
> {
  constructor() {
    super(predictionVector);
  }

  async findById(id: string): Promise<PredictionVector | null> {
    const [result] = await this.db
      .select()
      .from(predictionVector)
      .where(eq(predictionVector.id, id));
    return result ?? null;
  }

  async findByAgent(agentId: string): Promise<PredictionVector[]> {
    return this.db
      .select()
      .from(predictionVector)
      .where(eq(predictionVector.agentId, agentId))
      .orderBy(desc(predictionVector.predictedAt));
  }

  async findByMarket(marketId: string): Promise<PredictionVector[]> {
    return this.db
      .select()
      .from(predictionVector)
      .where(eq(predictionVector.marketId, marketId))
      .orderBy(desc(predictionVector.predictedAt));
  }

  async findAll(
    filters: PredictionVectorFilters
  ): Promise<PaginatedResult<PredictionVector>> {
    const {
      agentId,
      marketId,
      status,
      confidenceMin,
      confidenceMax,
      predictedAfter,
      predictedBefore,
      limit = 50,
      offset = 0,
    } = filters;

    const conditions: SQL[] = [];
    if (agentId) conditions.push(eq(predictionVector.agentId, agentId));
    if (marketId) conditions.push(eq(predictionVector.marketId, marketId));
    if (status) conditions.push(eq(predictionVector.status, status));
    if (confidenceMin !== undefined)
      conditions.push(gte(predictionVector.confidence, String(confidenceMin)));
    if (confidenceMax !== undefined)
      conditions.push(lte(predictionVector.confidence, String(confidenceMax)));
    if (predictedAfter)
      conditions.push(gte(predictionVector.predictedAt, predictedAfter));
    if (predictedBefore)
      conditions.push(lte(predictionVector.predictedAt, predictedBefore));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(predictionVector)
        .where(whereClause)
        .orderBy(desc(predictionVector.predictedAt))
        .limit(limit)
        .offset(offset),
      this.db.select({ count: count() }).from(predictionVector).where(whereClause),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    return {
      data,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    };
  }

  async create(data: CreatePredictionVectorData): Promise<PredictionVector> {
    const [newVector] = await this.db
      .insert(predictionVector)
      .values(data)
      .returning();
    return newVector!;
  }

  async update(
    id: string,
    data: Partial<Omit<PredictionVector, "id" | "createdAt" | "updatedAt">>
  ): Promise<PredictionVector | null> {
    const [updated] = await this.db
      .update(predictionVector)
      .set(data)
      .where(eq(predictionVector.id, id))
      .returning();
    return updated ?? null;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(predictionVector).where(eq(predictionVector.id, id));
  }

  async markAsChecked(id: string): Promise<PredictionVector | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const [updated] = await this.db
      .update(predictionVector)
      .set({
        checkCount: existing.checkCount + 1,
        checkedAt: new Date(),
        status: "checked",
      })
      .where(eq(predictionVector.id, id))
      .returning();
    return updated ?? null;
  }

  async resolve(
    id: string,
    outcome: boolean
  ): Promise<PredictionVector | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    // Calculate accuracy: 1.00 if prediction matches outcome, 0.00 if not
    // prediction is "yes" or "no", outcome is boolean (true = yes, false = no)
    const predictionMatchesOutcome =
      (existing.prediction === "yes" && outcome === true) ||
      (existing.prediction === "no" && outcome === false);
    const accuracy = predictionMatchesOutcome ? "1.00" : "0.00";

    const [updated] = await this.db
      .update(predictionVector)
      .set({
        accuracy,
        resolvedAt: new Date(),
        status: "resolved",
      })
      .where(eq(predictionVector.id, id))
      .returning();
    return updated ?? null;
  }

  // ===== Analytics =====

  async getAgentAccuracy(agentId: string): Promise<number | null> {
    const vectors = await this.db
      .select()
      .from(predictionVector)
      .where(
        and(
          eq(predictionVector.agentId, agentId),
          eq(predictionVector.status, "resolved")
        )
      );

    if (vectors.length === 0) return null;

    const totalAccuracy = vectors.reduce((sum, vector) => {
      return sum + Number(vector.accuracy ?? 0);
    }, 0);

    return totalAccuracy / vectors.length;
  }

  async getAccuracyByConfidenceRange(
    agentId?: string
  ): Promise<ConfidenceBucket[]> {
    const conditions: SQL[] = [];
    if (agentId) conditions.push(eq(predictionVector.agentId, agentId));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const vectors = await this.db
      .select()
      .from(predictionVector)
      .where(whereClause);

    // Define confidence buckets
    const buckets = [
      { range: "0.00-0.50", minConfidence: 0, maxConfidence: 0.5 },
      { range: "0.50-0.70", minConfidence: 0.5, maxConfidence: 0.7 },
      { range: "0.70-0.90", minConfidence: 0.7, maxConfidence: 0.9 },
      { range: "0.90-1.00", minConfidence: 0.9, maxConfidence: 1.0 },
    ];

    return buckets.map((bucket) => {
      const bucketVectors = vectors.filter((v) => {
        const confidence = Number(v.confidence);
        return confidence >= bucket.minConfidence && confidence <= bucket.maxConfidence;
      });

      const resolvedVectors = bucketVectors.filter(
        (v) => v.status === "resolved" && v.accuracy !== null
      );

      let avgAccuracy: number | null = null;
      let calibration: number | null = null;

      if (resolvedVectors.length > 0) {
        const totalAccuracy = resolvedVectors.reduce((sum, v) => {
          return sum + Number(v.accuracy ?? 0);
        }, 0);
        avgAccuracy = totalAccuracy / resolvedVectors.length;

        // Calibration: how close is avg confidence to avg accuracy
        const totalConfidence = resolvedVectors.reduce((sum, v) => {
          return sum + Number(v.confidence);
        }, 0);
        const avgConfidence = totalConfidence / resolvedVectors.length;
        calibration = 1 - Math.abs(avgConfidence - avgAccuracy);
      }

      return {
        range: bucket.range,
        minConfidence: bucket.minConfidence,
        maxConfidence: bucket.maxConfidence,
        totalPredictions: bucketVectors.length,
        resolvedPredictions: resolvedVectors.length,
        avgAccuracy,
        calibration,
      };
    });
  }

  async getAgentStats(agentId: string): Promise<AgentPredictionStats> {
    const vectors = await this.db
      .select()
      .from(predictionVector)
      .where(eq(predictionVector.agentId, agentId));

    const resolvedVectors = vectors.filter(
      (v) => v.status === "resolved" && v.accuracy !== null
    );

    let avgAccuracy: number | null = null;
    let avgConfidence: number | null = null;
    let calibrationScore: number | null = null;

    if (vectors.length > 0) {
      const totalConfidence = vectors.reduce((sum, v) => {
        return sum + Number(v.confidence);
      }, 0);
      avgConfidence = totalConfidence / vectors.length;
    }

    if (resolvedVectors.length > 0) {
      const totalAccuracy = resolvedVectors.reduce((sum, v) => {
        return sum + Number(v.accuracy ?? 0);
      }, 0);
      avgAccuracy = totalAccuracy / resolvedVectors.length;

      // Calibration score: how well does confidence match accuracy across all resolved predictions
      const totalConfidence = resolvedVectors.reduce((sum, v) => {
        return sum + Number(v.confidence);
      }, 0);
      const avgResolvedConfidence = totalConfidence / resolvedVectors.length;
      calibrationScore = 1 - Math.abs(avgResolvedConfidence - avgAccuracy);
    }

    return {
      totalPredictions: vectors.length,
      resolvedPredictions: resolvedVectors.length,
      avgAccuracy,
      avgConfidence,
      calibrationScore,
    };
  }
}

export const predictionVectorRepository = new PredictionVectorRepository();
