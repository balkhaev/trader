import {
  type Agent,
  type AgentAllocation,
  type AgentFilters,
  type AgentPerformance,
  type AgentTrade,
  agentRepository,
  type CreateAgentData,
  type PaginatedResult,
  type TradeFilters,
} from "@trader/db";
import { logger } from "../../lib/logger";
import { BadRequestError, NotFoundError } from "../../middleware";

class AgentService {
  private log = logger.child("agent");

  // ===== Agents =====

  async getAll(filters: AgentFilters): Promise<PaginatedResult<Agent>> {
    return agentRepository.findAll(filters);
  }

  async getById(id: string): Promise<Agent> {
    const agent = await agentRepository.findById(id);
    if (!agent) {
      throw new NotFoundError("Agent");
    }
    return agent;
  }

  async getBySlug(slug: string): Promise<Agent> {
    const agent = await agentRepository.findBySlug(slug);
    if (!agent) {
      throw new NotFoundError("Agent");
    }
    return agent;
  }

  async getTopPerformers(limit = 10): Promise<Agent[]> {
    return agentRepository.getTopPerformers(limit);
  }

  async create(data: CreateAgentData): Promise<Agent> {
    // Generate slug from name if not provided
    const slug = data.slug || this.generateSlug(data.name);

    // Check if slug exists
    const existing = await agentRepository.findBySlug(slug);
    if (existing) {
      throw new BadRequestError("Agent with this slug already exists");
    }

    const agent = await agentRepository.create({
      ...data,
      slug,
    });

    this.log.info("Agent created", { id: agent.id, name: agent.name });

    return agent;
  }

  async update(
    id: string,
    data: Partial<Omit<Agent, "id" | "createdAt" | "updatedAt">>
  ): Promise<Agent> {
    const agent = await agentRepository.update(id, data);
    if (!agent) {
      throw new NotFoundError("Agent");
    }

    this.log.info("Agent updated", { id: agent.id });

    return agent;
  }

  async updateStatus(
    id: string,
    status: "backtesting" | "active" | "paused" | "archived"
  ): Promise<void> {
    await this.getById(id); // Verify exists
    await agentRepository.updateStatus(id, status);
    this.log.info("Agent status updated", { id, status });
  }

  async delete(id: string): Promise<void> {
    await this.getById(id); // Verify exists
    await agentRepository.delete(id);
    this.log.info("Agent deleted", { id });
  }

  // ===== Allocations =====

  async getUserAllocations(
    userId: string
  ): Promise<PaginatedResult<AgentAllocation & { agent: Agent }>> {
    return agentRepository.findAllocations({ userId, status: "active" });
  }

  async getAllocation(
    userId: string,
    agentId: string
  ): Promise<AgentAllocation | null> {
    return agentRepository.findAllocationByUserAndAgent(userId, agentId);
  }

  async allocate(
    userId: string,
    agentId: string,
    amount: number
  ): Promise<AgentAllocation> {
    // Verify agent exists and is active
    const agent = await this.getById(agentId);

    if (agent.status !== "active") {
      throw new BadRequestError("Cannot allocate to inactive agent");
    }

    if (amount <= 0) {
      throw new BadRequestError("Amount must be positive");
    }

    const allocation = await agentRepository.allocate({
      agentId,
      userId,
      amount: String(amount),
    });

    this.log.info("Allocation created", {
      userId,
      agentId,
      amount,
    });

    return allocation;
  }

  async withdraw(userId: string, agentId: string): Promise<AgentAllocation> {
    const allocation = await agentRepository.withdraw(userId, agentId);

    if (!allocation) {
      throw new NotFoundError("Allocation");
    }

    this.log.info("Allocation withdrawn", { userId, agentId });

    return allocation;
  }

  // ===== Trades =====

  async getTrades(filters: TradeFilters): Promise<PaginatedResult<AgentTrade>> {
    return agentRepository.findTrades(filters);
  }

  async getRecentTrades(agentId: string, limit = 10): Promise<AgentTrade[]> {
    return agentRepository.getRecentTrades(agentId, limit);
  }

  async getOpenPositions(agentId: string): Promise<AgentTrade[]> {
    return agentRepository.getOpenTrades(agentId);
  }

  // ===== Performance =====

  async getPerformance(agentId: string): Promise<AgentPerformance> {
    const agent = await this.getById(agentId);

    return {
      totalReturn: agent.totalReturn ?? "0",
      monthlyReturn: agent.monthlyReturn ?? "0",
      sharpeRatio: agent.sharpeRatio ?? "0",
      maxDrawdown: agent.maxDrawdown ?? "0",
      winRate: agent.winRate ?? "0",
      totalTrades: agent.totalTrades ?? 0,
      avgHoldingPeriodHours: agent.avgHoldingPeriodHours ?? "0",
    };
  }

  async recalculatePerformance(agentId: string): Promise<void> {
    const trades = await agentRepository.findTrades({
      agentId,
      status: "closed",
      limit: 1000,
    });

    if (trades.data.length === 0) {
      return;
    }

    const closedTrades = trades.data;

    // Calculate metrics
    const returns = closedTrades.map((t) => Number(t.pnlPercent ?? 0));
    const totalPnl = returns.reduce((sum, r) => sum + r, 0);
    const winningTrades = closedTrades.filter(
      (t) => Number(t.pnl ?? 0) > 0
    ).length;
    const totalReturn = totalPnl;
    const winRate = winningTrades / closedTrades.length;

    // Calculate Sharpe Ratio
    const avgReturn = totalPnl / returns.length;
    const variance =
      returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) /
      returns.length;
    const stdDev = Math.sqrt(variance);
    // Annualized Sharpe (assuming ~252 trading days, ~1 trade per day avg)
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

    // Calculate holding period
    const holdingPeriods = closedTrades.map((t) => {
      if (!t.closedAt) return 0;
      return (t.closedAt.getTime() - t.openedAt.getTime()) / (1000 * 60 * 60);
    });
    const avgHoldingPeriod =
      holdingPeriods.reduce((a, b) => a + b, 0) / holdingPeriods.length;

    // Calculate max drawdown
    let maxDrawdown = 0;
    let peak = 0;
    let cumulative = 0;
    for (const trade of closedTrades) {
      cumulative += Number(trade.pnlPercent ?? 0);
      if (cumulative > peak) {
        peak = cumulative;
      }
      const drawdown = peak - cumulative;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    // Calculate monthly return (based on first and last trade dates)
    const firstTrade = closedTrades[closedTrades.length - 1];
    const lastTrade = closedTrades[0];
    const monthsActive =
      firstTrade && lastTrade
        ? Math.max(
            1,
            (lastTrade.openedAt.getTime() - firstTrade.openedAt.getTime()) /
              (1000 * 60 * 60 * 24 * 30)
          )
        : 1;
    const monthlyReturn = totalReturn / monthsActive;

    await agentRepository.updatePerformance(agentId, {
      totalReturn: String(totalReturn.toFixed(4)),
      monthlyReturn: String(monthlyReturn.toFixed(4)),
      sharpeRatio: String(sharpeRatio.toFixed(4)),
      maxDrawdown: String(maxDrawdown.toFixed(4)),
      winRate: String(winRate.toFixed(4)),
      totalTrades: closedTrades.length,
      avgHoldingPeriodHours: String(avgHoldingPeriod.toFixed(2)),
    });

    this.log.info("Performance recalculated", {
      agentId,
      totalReturn,
      sharpeRatio,
      winRate,
    });
  }

  /**
   * Get performance history for charting
   */
  async getPerformanceHistory(
    agentId: string,
    days = 30
  ): Promise<Array<{ date: string; value: number; pnl: number }>> {
    const trades = await agentRepository.findTrades({
      agentId,
      status: "closed",
      limit: 500,
    });

    if (trades.data.length === 0) {
      return [];
    }

    // Group trades by day and calculate cumulative PnL
    const dailyPnL = new Map<string, number>();
    let cumulative = 100; // Start at 100 (percentage)

    // Sort by date ascending
    const sortedTrades = [...trades.data].reverse();

    for (const trade of sortedTrades) {
      const date = trade.closedAt
        ? trade.closedAt.toISOString().split("T")[0]!
        : trade.openedAt.toISOString().split("T")[0]!;
      const pnl = Number(trade.pnlPercent ?? 0);
      cumulative += pnl;
      dailyPnL.set(date, cumulative);
    }

    // Convert to array and fill gaps
    const result: Array<{ date: string; value: number; pnl: number }> = [];
    const dates = Array.from(dailyPnL.keys()).sort();

    let prevValue = 100;
    for (const date of dates) {
      const value = dailyPnL.get(date) ?? prevValue;
      result.push({
        date,
        value,
        pnl: value - prevValue,
      });
      prevValue = value;
    }

    // Return last N days
    return result.slice(-days);
  }

  // ===== Helpers =====

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }
}

export const agentService = new AgentService();
