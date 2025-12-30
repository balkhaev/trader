import type { InferSelectModel } from "drizzle-orm";
import { and, count, desc, eq, type SQL } from "drizzle-orm";
import { exchangeAccount, signal } from "../schema/exchange";
import { newsAnalysis, signalNewsLink } from "../schema/news";
import {
  BaseRepository,
  type PaginatedResult,
  type PaginationParams,
} from "./base.repository";

// Types
export type Signal = InferSelectModel<typeof signal>;
export type SignalStatus = "pending" | "executed" | "rejected" | "expired";

export interface SignalFilters extends PaginationParams {
  userId: string;
  status?: SignalStatus;
}

export interface SignalStats {
  total: number;
  pending: number;
  executed: number;
  rejected: number;
  expired: number;
  executionRate: number;
}

export interface SignalWithAnalyses extends Signal {
  analyses: Array<InferSelectModel<typeof newsAnalysis>>;
}

class SignalRepository extends BaseRepository<typeof signal> {
  constructor() {
    super(signal);
  }

  // ===== Find =====

  async findById(signalId: string): Promise<Signal | null> {
    const [sig] = await this.db
      .select()
      .from(signal)
      .where(eq(signal.id, signalId));

    return sig ?? null;
  }

  async findByIdAndUser(
    signalId: string,
    userId: string
  ): Promise<Signal | null> {
    const [sig] = await this.db
      .select()
      .from(signal)
      .where(and(eq(signal.id, signalId), eq(signal.userId, userId)));

    return sig ?? null;
  }

  async findPending(userId: string): Promise<Signal[]> {
    return this.db
      .select()
      .from(signal)
      .where(and(eq(signal.userId, userId), eq(signal.status, "pending")))
      .orderBy(desc(signal.createdAt));
  }

  async findAll(filters: SignalFilters): Promise<PaginatedResult<Signal>> {
    const { userId, status, limit = 50, offset = 0 } = filters;

    const conditions: SQL[] = [eq(signal.userId, userId)];
    if (status) conditions.push(eq(signal.status, status));

    const whereClause = and(...conditions);

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(signal)
        .where(whereClause)
        .orderBy(desc(signal.createdAt))
        .limit(limit)
        .offset(offset),
      this.db.select({ count: count() }).from(signal).where(whereClause),
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

  async findWithAnalyses(signalId: string): Promise<SignalWithAnalyses | null> {
    const sig = await this.findById(signalId);
    if (!sig) return null;

    const links = await this.db
      .select({ analysis: newsAnalysis })
      .from(signalNewsLink)
      .innerJoin(newsAnalysis, eq(signalNewsLink.analysisId, newsAnalysis.id))
      .where(eq(signalNewsLink.signalId, signalId));

    return {
      ...sig,
      analyses: links.map((l) => l.analysis),
    };
  }

  // ===== Create / Update =====

  async create(data: {
    userId: string;
    source: "backtest" | "webhook" | "manual" | "llm";
    symbol: string;
    side: "long" | "short";
    strength?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Signal> {
    const [newSignal] = await this.db
      .insert(signal)
      .values({
        ...data,
        status: "pending",
      })
      .returning();

    return newSignal!;
  }

  async linkToAnalysis(signalId: string, analysisId: string): Promise<void> {
    await this.db.insert(signalNewsLink).values({
      signalId,
      analysisId,
    });
  }

  async updateStatus(
    signalId: string,
    status: SignalStatus,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const updates: Partial<Signal> = { status };

    if (status === "executed") {
      updates.executedAt = new Date();
    }

    if (metadata) {
      const existing = await this.findById(signalId);
      updates.metadata = {
        ...(existing?.metadata as Record<string, unknown>),
        ...metadata,
      };
    }

    await this.db.update(signal).set(updates).where(eq(signal.id, signalId));
  }

  // ===== Stats =====

  async getStats(userId: string): Promise<SignalStats> {
    const signals = await this.db
      .select()
      .from(signal)
      .where(eq(signal.userId, userId));

    const pending = signals.filter((s) => s.status === "pending").length;
    const executed = signals.filter((s) => s.status === "executed").length;
    const rejected = signals.filter((s) => s.status === "rejected").length;
    const expired = signals.filter((s) => s.status === "expired").length;

    return {
      total: signals.length,
      pending,
      executed,
      rejected,
      expired,
      executionRate: signals.length > 0 ? executed / signals.length : 0,
    };
  }

  // ===== Exchange Account =====

  async findExchangeAccount(
    accountId: string,
    userId: string
  ): Promise<InferSelectModel<typeof exchangeAccount> | null> {
    const [account] = await this.db
      .select()
      .from(exchangeAccount)
      .where(
        and(
          eq(exchangeAccount.id, accountId),
          eq(exchangeAccount.userId, userId)
        )
      );

    return account ?? null;
  }
}

export const signalRepository = new SignalRepository();
