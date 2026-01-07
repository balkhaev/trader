import type { InferSelectModel } from "drizzle-orm";
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

class PredictionVectorRepository extends BaseRepository<
  typeof predictionVector
> {
  constructor() {
    super(predictionVector);
  }
}

export const predictionVectorRepository = new PredictionVectorRepository();
