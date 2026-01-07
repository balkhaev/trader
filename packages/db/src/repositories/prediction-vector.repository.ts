import type { InferSelectModel } from "drizzle-orm";
import { desc, eq } from "drizzle-orm";
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
}

export const predictionVectorRepository = new PredictionVectorRepository();
