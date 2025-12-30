import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { getUserFromContext, requireAuth } from "../middleware";
import { agentExecutorService, agentService } from "../services/agent";

const agents = new Hono();

// ===== Schemas =====

const paginationSchema = z.object({
  limit: z.coerce.number().optional(),
  offset: z.coerce.number().optional(),
});

const agentFiltersSchema = paginationSchema.extend({
  status: z.enum(["backtesting", "active", "paused", "archived"]).optional(),
  strategyType: z
    .enum(["news", "technical", "transport", "macro", "prediction", "hybrid"])
    .optional(),
  riskLevel: z.enum(["low", "medium", "high"]).optional(),
});

const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().optional(),
  description: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  strategyType: z.enum([
    "news",
    "technical",
    "transport",
    "macro",
    "prediction",
    "hybrid",
  ]),
  strategy: z.object({
    type: z.enum([
      "news",
      "technical",
      "transport",
      "macro",
      "prediction",
      "hybrid",
    ]),
    description: z.string(),
    dataSources: z.array(z.string()),
    entryRules: z.array(
      z.object({
        condition: z.string(),
        threshold: z.number().optional(),
        operator: z.enum([">", "<", "=", ">=", "<="]).optional(),
      })
    ),
    exitRules: z.array(
      z.object({
        type: z.enum([
          "takeProfit",
          "stopLoss",
          "trailingStop",
          "timeExit",
          "signal",
        ]),
        value: z.number(),
      })
    ),
    symbols: z.array(z.string()).optional(),
    timeframes: z.array(z.string()).optional(),
  }),
  riskParams: z.object({
    maxPositionSize: z.number().min(0).max(100),
    maxDrawdown: z.number().min(0).max(100),
    maxDailyLoss: z.number().min(0).max(100),
    maxOpenPositions: z.number().min(1),
    minTimeBetweenTrades: z.number().min(0),
  }),
  riskLevel: z.enum(["low", "medium", "high"]),
  isPublic: z.boolean().optional(),
});

const allocateSchema = z.object({
  amount: z.number().positive(),
});

const updateStatusSchema = z.object({
  status: z.enum(["backtesting", "active", "paused", "archived"]),
});

// ===== Public Routes =====

// List all public agents
agents.get("/", zValidator("query", agentFiltersSchema), async (c) => {
  const filters = c.req.valid("query");
  const result = await agentService.getAll({ ...filters, isPublic: true });
  return c.json(result);
});

// Get top performers
agents.get("/top", async (c) => {
  const limit = Number(c.req.query("limit") ?? 10);
  const top = await agentService.getTopPerformers(limit);
  return c.json({ agents: top });
});

// Get agent by slug
agents.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const agent = await agentService.getBySlug(slug);
  return c.json(agent);
});

// Get agent trades
agents.get(
  "/:slug/trades",
  zValidator("query", paginationSchema),
  async (c) => {
    const slug = c.req.param("slug");
    const filters = c.req.valid("query");

    const agent = await agentService.getBySlug(slug);
    const trades = await agentService.getTrades({
      agentId: agent.id,
      ...filters,
    });

    return c.json(trades);
  }
);

// Get agent performance
agents.get("/:slug/performance", async (c) => {
  const slug = c.req.param("slug");
  const agent = await agentService.getBySlug(slug);
  const performance = await agentService.getPerformance(agent.id);
  return c.json(performance);
});

// ===== Protected Routes =====

// Create agent (requires auth)
agents.post(
  "/",
  requireAuth,
  zValidator("json", createAgentSchema),
  async (c) => {
    const user = getUserFromContext(c);
    const data = c.req.valid("json");

    const agent = await agentService.create({
      ...data,
      createdBy: user.id,
    });

    return c.json(agent, 201);
  }
);

// Update agent status
agents.patch(
  "/:slug/status",
  requireAuth,
  zValidator("json", updateStatusSchema),
  async (c) => {
    const slug = c.req.param("slug");
    const { status } = c.req.valid("json");

    const agent = await agentService.getBySlug(slug);
    await agentService.updateStatus(agent.id, status);

    return c.json({ message: "Status updated", status });
  }
);

// Allocate to agent
agents.post(
  "/:slug/allocate",
  requireAuth,
  zValidator("json", allocateSchema),
  async (c) => {
    const user = getUserFromContext(c);
    const slug = c.req.param("slug");
    const { amount } = c.req.valid("json");

    const agent = await agentService.getBySlug(slug);
    const allocation = await agentService.allocate(user.id, agent.id, amount);

    return c.json(allocation, 201);
  }
);

// Withdraw from agent
agents.post("/:slug/withdraw", requireAuth, async (c) => {
  const user = getUserFromContext(c);
  const slug = c.req.param("slug");

  const agent = await agentService.getBySlug(slug);
  const allocation = await agentService.withdraw(user.id, agent.id);

  return c.json(allocation);
});

// Get my allocations
agents.get("/me/allocations", requireAuth, async (c) => {
  const user = getUserFromContext(c);
  const allocations = await agentService.getUserAllocations(user.id);
  return c.json(allocations);
});

// Delete agent
agents.delete("/:slug", requireAuth, async (c) => {
  const user = getUserFromContext(c);
  const slug = c.req.param("slug");

  const agent = await agentService.getBySlug(slug);

  // Only creator can delete
  if (agent.createdBy !== user.id) {
    return c.json({ error: "Forbidden" }, 403);
  }

  await agentService.delete(agent.id);

  return c.json({ message: "Agent deleted" });
});

// ===== Executor Endpoints =====

// Start agent execution
agents.post("/:slug/start", requireAuth, async (c) => {
  const slug = c.req.param("slug");
  const agent = await agentService.getBySlug(slug);

  await agentExecutorService.startAgent(agent.id);

  return c.json({ message: "Agent started", agentId: agent.id });
});

// Stop agent execution
agents.post("/:slug/stop", requireAuth, async (c) => {
  const slug = c.req.param("slug");
  const agent = await agentService.getBySlug(slug);

  agentExecutorService.stopAgent(agent.id);

  return c.json({ message: "Agent stopped", agentId: agent.id });
});

// Get running agents
agents.get("/executor/status", requireAuth, async (c) => {
  const runningAgents = agentExecutorService.getRunningAgents();
  return c.json({ running: runningAgents, count: runningAgents.length });
});

// Execute single cycle manually
agents.post("/:slug/execute", requireAuth, async (c) => {
  const slug = c.req.param("slug");
  const agent = await agentService.getBySlug(slug);

  const decision = await agentExecutorService.executeAgent(agent);

  return c.json({ decision });
});

// Get performance history for charts
agents.get("/:slug/history", async (c) => {
  const slug = c.req.param("slug");
  const days = Number(c.req.query("days") ?? 30);

  const agent = await agentService.getBySlug(slug);
  const history = await agentService.getPerformanceHistory(agent.id, days);

  return c.json({ history });
});

// Recalculate performance metrics
agents.post("/:slug/recalculate", requireAuth, async (c) => {
  const slug = c.req.param("slug");

  const agent = await agentService.getBySlug(slug);
  await agentService.recalculatePerformance(agent.id);
  const performance = await agentService.getPerformance(agent.id);

  return c.json(performance);
});

export default agents;
