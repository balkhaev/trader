import type { InferSelectModel } from "drizzle-orm";
import { and, count, desc, eq, type SQL } from "drizzle-orm";
import {
  type AgentStrategy,
  agent,
  agentAllocation,
  agentTrade,
  type RiskParams,
} from "../schema/agent";
import {
  BaseRepository,
  type PaginatedResult,
  type PaginationParams,
} from "./base.repository";

// Types
export type Agent = InferSelectModel<typeof agent>;
export type AgentAllocation = InferSelectModel<typeof agentAllocation>;
export type AgentTrade = InferSelectModel<typeof agentTrade>;

export type AgentStatus = "backtesting" | "active" | "paused" | "archived";
export type StrategyType =
  | "news"
  | "technical"
  | "transport"
  | "macro"
  | "prediction"
  | "hybrid";
export type RiskLevel = "low" | "medium" | "high";

export interface AgentFilters extends PaginationParams {
  status?: AgentStatus;
  strategyType?: StrategyType;
  riskLevel?: RiskLevel;
  isPublic?: boolean;
  createdBy?: string;
}

export interface AllocationFilters extends PaginationParams {
  userId?: string;
  agentId?: string;
  status?: "active" | "withdrawn";
}

export interface TradeFilters extends PaginationParams {
  agentId: string;
  status?: "open" | "closed" | "cancelled";
  symbol?: string;
}

export interface CreateAgentData {
  name: string;
  slug?: string;
  description?: string;
  avatarUrl?: string;
  strategyType: StrategyType;
  strategy: AgentStrategy;
  riskParams: RiskParams;
  riskLevel: RiskLevel;
  isPublic?: boolean;
  createdBy?: string;
}

export interface AgentPerformance {
  totalReturn: string;
  monthlyReturn: string;
  sharpeRatio: string;
  maxDrawdown: string;
  winRate: string;
  totalTrades: number;
  avgHoldingPeriodHours: string;
}

class AgentRepository extends BaseRepository<typeof agent> {
  constructor() {
    super(agent);
  }

  // ===== Agents =====

  async findAll(filters: AgentFilters): Promise<PaginatedResult<Agent>> {
    const {
      status,
      strategyType,
      riskLevel,
      isPublic = true,
      createdBy,
      limit = 50,
      offset = 0,
    } = filters;

    const conditions: SQL[] = [];
    if (status) conditions.push(eq(agent.status, status));
    if (strategyType) conditions.push(eq(agent.strategyType, strategyType));
    if (riskLevel) conditions.push(eq(agent.riskLevel, riskLevel));
    if (isPublic !== undefined) conditions.push(eq(agent.isPublic, isPublic));
    if (createdBy) conditions.push(eq(agent.createdBy, createdBy));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(agent)
        .where(whereClause)
        .orderBy(desc(agent.totalReturn))
        .limit(limit)
        .offset(offset),
      this.db.select({ count: count() }).from(agent).where(whereClause),
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

  async findById(id: string): Promise<Agent | null> {
    const [result] = await this.db.select().from(agent).where(eq(agent.id, id));
    return result ?? null;
  }

  async findBySlug(slug: string): Promise<Agent | null> {
    const [result] = await this.db
      .select()
      .from(agent)
      .where(eq(agent.slug, slug));
    return result ?? null;
  }

  async create(data: CreateAgentData): Promise<Agent> {
    const slug = data.slug ?? this.generateSlug(data.name);
    const [newAgent] = await this.db
      .insert(agent)
      .values({
        ...data,
        slug,
      })
      .returning();
    return newAgent!;
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  async update(
    id: string,
    data: Partial<Omit<Agent, "id" | "createdAt" | "updatedAt">>
  ): Promise<Agent | null> {
    const [updated] = await this.db
      .update(agent)
      .set(data)
      .where(eq(agent.id, id))
      .returning();
    return updated ?? null;
  }

  async updatePerformance(
    id: string,
    performance: AgentPerformance
  ): Promise<void> {
    await this.db
      .update(agent)
      .set({
        totalReturn: performance.totalReturn,
        monthlyReturn: performance.monthlyReturn,
        sharpeRatio: performance.sharpeRatio,
        maxDrawdown: performance.maxDrawdown,
        winRate: performance.winRate,
        totalTrades: performance.totalTrades,
        avgHoldingPeriodHours: performance.avgHoldingPeriodHours,
      })
      .where(eq(agent.id, id));
  }

  async updateStatus(id: string, status: AgentStatus): Promise<void> {
    await this.db.update(agent).set({ status }).where(eq(agent.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(agent).where(eq(agent.id, id));
  }

  async getTopPerformers(limit = 10): Promise<Agent[]> {
    return this.db
      .select()
      .from(agent)
      .where(and(eq(agent.status, "active"), eq(agent.isPublic, true)))
      .orderBy(desc(agent.totalReturn))
      .limit(limit);
  }

  // ===== Allocations =====

  async findAllocations(
    filters: AllocationFilters
  ): Promise<PaginatedResult<AgentAllocation & { agent: Agent }>> {
    const { userId, agentId, status, limit = 50, offset = 0 } = filters;

    const conditions: SQL[] = [];
    if (userId) conditions.push(eq(agentAllocation.userId, userId));
    if (agentId) conditions.push(eq(agentAllocation.agentId, agentId));
    if (status) conditions.push(eq(agentAllocation.status, status));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, countResult] = await Promise.all([
      this.db
        .select({
          allocation: agentAllocation,
          agent,
        })
        .from(agentAllocation)
        .innerJoin(agent, eq(agentAllocation.agentId, agent.id))
        .where(whereClause)
        .orderBy(desc(agentAllocation.allocatedAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(agentAllocation)
        .where(whereClause),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    return {
      data: data.map((d) => ({ ...d.allocation, agent: d.agent })),
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    };
  }

  async findAllocationByUserAndAgent(
    userId: string,
    agentId: string
  ): Promise<AgentAllocation | null> {
    const [result] = await this.db
      .select()
      .from(agentAllocation)
      .where(
        and(
          eq(agentAllocation.userId, userId),
          eq(agentAllocation.agentId, agentId)
        )
      );
    return result ?? null;
  }

  async allocate(data: {
    agentId: string;
    userId: string;
    amount: string;
  }): Promise<AgentAllocation> {
    // Check if allocation exists
    const existing = await this.findAllocationByUserAndAgent(
      data.userId,
      data.agentId
    );

    if (existing) {
      // Add to existing allocation
      const newAmount = Number(existing.amount) + Number(data.amount);
      const [updated] = await this.db
        .update(agentAllocation)
        .set({
          amount: String(newAmount),
          status: "active",
          withdrawnAt: null,
        })
        .where(eq(agentAllocation.id, existing.id))
        .returning();

      // Update agent total allocated
      await this.updateTotalAllocated(data.agentId);

      return updated!;
    }

    // Create new allocation
    const [allocation] = await this.db
      .insert(agentAllocation)
      .values({
        ...data,
        currentValue: data.amount,
        status: "active",
      })
      .returning();

    // Update agent total allocated
    await this.updateTotalAllocated(data.agentId);

    return allocation!;
  }

  async withdraw(
    userId: string,
    agentId: string
  ): Promise<AgentAllocation | null> {
    const [updated] = await this.db
      .update(agentAllocation)
      .set({
        status: "withdrawn",
        withdrawnAt: new Date(),
      })
      .where(
        and(
          eq(agentAllocation.userId, userId),
          eq(agentAllocation.agentId, agentId),
          eq(agentAllocation.status, "active")
        )
      )
      .returning();

    if (updated) {
      await this.updateTotalAllocated(agentId);
    }

    return updated ?? null;
  }

  private async updateTotalAllocated(agentId: string): Promise<void> {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(agentAllocation)
      .where(
        and(
          eq(agentAllocation.agentId, agentId),
          eq(agentAllocation.status, "active")
        )
      );

    // For now just count, in real scenario would sum amounts
    await this.db
      .update(agent)
      .set({ totalAllocated: String(result[0]?.total ?? 0) })
      .where(eq(agent.id, agentId));
  }

  // ===== Trades =====

  async findTrades(
    filters: TradeFilters
  ): Promise<PaginatedResult<AgentTrade>> {
    const { agentId, status, symbol, limit = 50, offset = 0 } = filters;

    const conditions: SQL[] = [eq(agentTrade.agentId, agentId)];
    if (status) conditions.push(eq(agentTrade.status, status));
    if (symbol) conditions.push(eq(agentTrade.symbol, symbol));

    const whereClause = and(...conditions);

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(agentTrade)
        .where(whereClause)
        .orderBy(desc(agentTrade.openedAt))
        .limit(limit)
        .offset(offset),
      this.db.select({ count: count() }).from(agentTrade).where(whereClause),
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

  async getOpenTrades(agentId: string): Promise<AgentTrade[]> {
    return this.db
      .select()
      .from(agentTrade)
      .where(
        and(eq(agentTrade.agentId, agentId), eq(agentTrade.status, "open"))
      )
      .orderBy(desc(agentTrade.openedAt));
  }

  async createTrade(data: {
    agentId: string;
    symbol: string;
    side: "long" | "short";
    quantity: string;
    entryPrice: string;
    stopLoss?: string;
    takeProfit?: string;
    reasoning?: string;
    dataSources?: AgentTrade["dataSources"];
    confidence?: string;
  }): Promise<AgentTrade> {
    const [trade] = await this.db
      .insert(agentTrade)
      .values({
        ...data,
        status: "open",
      })
      .returning();
    return trade!;
  }

  async closeTrade(
    tradeId: string,
    exitPrice: string,
    pnl: string,
    pnlPercent: string
  ): Promise<AgentTrade | null> {
    const [updated] = await this.db
      .update(agentTrade)
      .set({
        status: "closed",
        exitPrice,
        pnl,
        pnlPercent,
        closedAt: new Date(),
      })
      .where(eq(agentTrade.id, tradeId))
      .returning();
    return updated ?? null;
  }

  async getRecentTrades(agentId: string, limit = 10): Promise<AgentTrade[]> {
    return this.db
      .select()
      .from(agentTrade)
      .where(eq(agentTrade.agentId, agentId))
      .orderBy(desc(agentTrade.openedAt))
      .limit(limit);
  }
}

export const agentRepository = new AgentRepository();
