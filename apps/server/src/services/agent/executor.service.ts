import {
  type Agent,
  agentRepository,
} from "@trader/db";
import { logger } from "../../lib/logger";
import {
  type TradeDecision,
  contextService,
  riskService,
  decisionService,
  tradeService,
} from "./executor";

class AgentExecutorService {
  private log = logger.child("executor");
  private executionIntervals: Map<string, ReturnType<typeof setInterval>> =
    new Map();

  /**
   * Start executing an agent's strategy
   */
  async startAgent(agentId: string): Promise<void> {
    const agent = await agentRepository.findById(agentId);
    if (!agent) {
      throw new Error("Agent not found");
    }

    if (agent.status !== "active") {
      throw new Error("Agent is not active");
    }

    if (this.executionIntervals.has(agentId)) {
      this.log.warn("Agent already running", { agentId });
      return;
    }

    this.log.info("Starting agent execution", {
      agentId,
      name: agent.name,
      strategy: agent.strategyType,
    });

    // Run immediately
    await this.executeAgent(agent);

    // Then run on interval (every 5 minutes)
    const interval = setInterval(
      () => {
        this.executeAgent(agent).catch((err) => {
          this.log.error("Execution error", {
            agentId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      },
      5 * 60 * 1000
    );

    this.executionIntervals.set(agentId, interval);
  }

  /**
   * Stop an agent's execution
   */
  stopAgent(agentId: string): void {
    const interval = this.executionIntervals.get(agentId);
    if (interval) {
      clearInterval(interval);
      this.executionIntervals.delete(agentId);
      this.log.info("Agent stopped", { agentId });
    }
  }

  /**
   * Execute a single cycle for an agent
   */
  async executeAgent(agent: Agent): Promise<TradeDecision | null> {
    this.log.debug("Executing agent cycle", { agentId: agent.id });

    try {
      // Build context
      const context = await contextService.buildContext(agent);

      // Check risk limits
      const riskCheck = riskService.checkRiskLimits(context);
      if (!riskCheck.canTrade) {
        this.log.info("Risk limits prevent trading", {
          agentId: agent.id,
          reason: riskCheck.reason,
        });
        return null;
      }

      // Get trade decision from LLM
      const decision = await decisionService.getTradeDecision(context);

      if (!decision.shouldTrade || decision.action === "hold") {
        this.log.debug("Agent decided to hold", { agentId: agent.id });
        return decision;
      }

      // Execute the decision
      await tradeService.executeTrade(agent, decision);

      return decision;
    } catch (error) {
      this.log.error("Agent execution failed", {
        agentId: agent.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get status of all running agents
   */
  getRunningAgents(): string[] {
    return Array.from(this.executionIntervals.keys());
  }

  /**
   * Stop all running agents
   */
  stopAll(): void {
    for (const agentId of this.executionIntervals.keys()) {
      this.stopAgent(agentId);
    }
  }
}

export const agentExecutorService = new AgentExecutorService();
