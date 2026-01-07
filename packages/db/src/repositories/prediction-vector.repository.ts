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
}

export const predictionVectorRepository = new PredictionVectorRepository();
