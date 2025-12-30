import {
  autoTradingConfig,
  autoTradingLog,
  db,
  exchangeAccount,
  signal,
} from "@trader/db";
import type { InferSelectModel } from "drizzle-orm";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { decrypt } from "../crypto.service";
import { createExchangeService } from "../exchange";
import { telegramService } from "../notifications";

type Signal = InferSelectModel<typeof signal>;
type AutoTradingConfig = InferSelectModel<typeof autoTradingConfig>;

interface AutoTradeResult {
  executed: boolean;
  reason: string;
  orderId?: string;
  details?: Record<string, unknown>;
}

export const autoTradingService = {
  // Get user's auto-trading config
  async getConfig(userId: string): Promise<AutoTradingConfig | null> {
    const [config] = await db
      .select()
      .from(autoTradingConfig)
      .where(eq(autoTradingConfig.userId, userId));

    return config || null;
  },

  // Create or update config
  async upsertConfig(
    userId: string,
    updates: Partial<
      Omit<AutoTradingConfig, "id" | "userId" | "createdAt" | "updatedAt">
    >
  ): Promise<AutoTradingConfig> {
    const existing = await this.getConfig(userId);

    if (existing) {
      const [updated] = await db
        .update(autoTradingConfig)
        .set(updates)
        .where(eq(autoTradingConfig.userId, userId))
        .returning();
      return updated!;
    }

    const [created] = await db
      .insert(autoTradingConfig)
      .values({ userId, ...updates })
      .returning();
    return created!;
  },

  // Check if signal should be auto-executed
  async shouldAutoExecute(
    config: AutoTradingConfig,
    sig: Signal
  ): Promise<{ should: boolean; reason: string }> {
    // Check if enabled
    if (!config.enabled) {
      return { should: false, reason: "Auto-trading disabled" };
    }

    // Check exchange account
    if (!config.exchangeAccountId) {
      return { should: false, reason: "No exchange account configured" };
    }

    // Check signal strength
    const minStrength = Number.parseFloat(config.minSignalStrength ?? "75");
    const signalStrength = Number.parseFloat(sig.strength ?? "0");
    if (signalStrength < minStrength) {
      return {
        should: false,
        reason: `Signal strength ${signalStrength}% below threshold ${minStrength}%`,
      };
    }

    // Check allowed sources
    const allowedSources = config.allowedSources as string[] | null;
    if (allowedSources && !allowedSources.includes(sig.source)) {
      return { should: false, reason: `Source ${sig.source} not allowed` };
    }

    // Check direction (long/short)
    if (sig.side === "long" && !config.allowLong) {
      return { should: false, reason: "Long positions not allowed" };
    }
    if (sig.side === "short" && !config.allowShort) {
      return { should: false, reason: "Short positions not allowed" };
    }

    // Check symbol whitelist/blacklist
    const allowedSymbols = config.allowedSymbols as string[] | null;
    const blockedSymbols = config.blockedSymbols as string[] | null;

    if (
      allowedSymbols &&
      allowedSymbols.length > 0 &&
      !allowedSymbols.includes(sig.symbol)
    ) {
      return { should: false, reason: `Symbol ${sig.symbol} not in whitelist` };
    }

    if (blockedSymbols && blockedSymbols.includes(sig.symbol)) {
      return { should: false, reason: `Symbol ${sig.symbol} is blocked` };
    }

    // Check daily trade limit
    const maxDailyTrades = Number.parseFloat(config.maxDailyTrades ?? "10");
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [todayTradesResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(autoTradingLog)
      .where(
        and(
          eq(autoTradingLog.userId, config.userId),
          eq(autoTradingLog.action, "executed"),
          gte(autoTradingLog.createdAt, todayStart)
        )
      );

    if ((todayTradesResult?.count ?? 0) >= maxDailyTrades) {
      return { should: false, reason: "Daily trade limit reached" };
    }

    return { should: true, reason: "All checks passed" };
  },

  // Execute auto-trade
  async executeAutoTrade(
    userId: string,
    sig: Signal
  ): Promise<AutoTradeResult> {
    const config = await this.getConfig(userId);

    if (!config) {
      return { executed: false, reason: "No auto-trading config found" };
    }

    const { should, reason } = await this.shouldAutoExecute(config, sig);

    if (!should) {
      // Log skipped trade
      await this.logTrade(userId, sig.id, "skipped", reason);
      return { executed: false, reason };
    }

    try {
      // Get exchange account
      const [account] = await db
        .select()
        .from(exchangeAccount)
        .where(
          and(
            eq(exchangeAccount.id, config.exchangeAccountId!),
            eq(exchangeAccount.userId, userId)
          )
        );

      if (!account) {
        await this.logTrade(
          userId,
          sig.id,
          "error",
          "Exchange account not found"
        );
        return { executed: false, reason: "Exchange account not found" };
      }

      if (!account.enabled) {
        await this.logTrade(
          userId,
          sig.id,
          "error",
          "Exchange account disabled"
        );
        return { executed: false, reason: "Exchange account disabled" };
      }

      // Calculate position size
      const positionSize = this.calculatePositionSize(config);

      // Create exchange service
      const exchangeService = createExchangeService(account.exchange, {
        apiKey: decrypt(account.apiKey),
        apiSecret: decrypt(account.apiSecret),
        testnet: account.testnet,
      });

      // Calculate stop loss and take profit
      const stopLossPercent = Number.parseFloat(
        config.defaultStopLossPercent ?? "5"
      );
      const takeProfitPercent = Number.parseFloat(
        config.defaultTakeProfitPercent ?? "10"
      );

      // Execute order
      const order = await exchangeService.createOrder({
        symbol: sig.symbol,
        side: sig.side === "long" ? "buy" : "sell",
        type: config.orderType as "market" | "limit",
        quantity: positionSize,
        stopLoss: config.useStopLoss ? String(stopLossPercent) : undefined,
        takeProfit: config.useTakeProfit
          ? String(takeProfitPercent)
          : undefined,
      });

      // Update signal status
      await db
        .update(signal)
        .set({
          status: "executed",
          executedAt: new Date(),
          entryPrice: order.avgPrice || order.price,
          metadata: {
            ...(sig.metadata as Record<string, unknown>),
            autoTraded: true,
            autoTradeConfig: {
              positionSize,
              stopLossPercent: config.useStopLoss ? stopLossPercent : null,
              takeProfitPercent: config.useTakeProfit
                ? takeProfitPercent
                : null,
            },
            executionOrder: order,
          },
        })
        .where(eq(signal.id, sig.id));

      // Log successful trade
      await this.logTrade(userId, sig.id, "executed", "Auto-trade executed", {
        orderId: order.id,
        symbol: sig.symbol,
        side: sig.side,
        quantity: positionSize,
        price: order.avgPrice || order.price,
      });

      // Send notification
      await telegramService.notifyTradeOpened(userId, {
        symbol: sig.symbol,
        side: sig.side,
        entryPrice: order.avgPrice || order.price || "0",
      });

      return {
        executed: true,
        reason: "Auto-trade executed successfully",
        orderId: order.id,
        details: {
          symbol: sig.symbol,
          side: sig.side,
          quantity: positionSize,
          price: order.avgPrice || order.price,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await this.logTrade(userId, sig.id, "error", errorMessage);
      return { executed: false, reason: errorMessage };
    }
  },

  // Calculate position size based on config
  calculatePositionSize(config: AutoTradingConfig): string {
    const sizeValue = Number.parseFloat(config.positionSizeValue ?? "100");
    const maxSize = Number.parseFloat(config.maxPositionSize ?? "1000");

    // For now, just use fixed size (in production would need current prices)
    let size = sizeValue;

    if (config.positionSizeType === "percent") {
      // Would need account balance to calculate
      size = sizeValue; // Placeholder
    }

    return String(Math.min(size, maxSize));
  },

  // Log auto-trade action
  async logTrade(
    userId: string,
    signalId: string | null,
    action: "executed" | "skipped" | "error",
    reason: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    await db.insert(autoTradingLog).values({
      userId,
      signalId,
      action,
      reason,
      details,
    });
  },

  // Get recent logs
  async getLogs(
    userId: string,
    limit = 50
  ): Promise<InferSelectModel<typeof autoTradingLog>[]> {
    return db
      .select()
      .from(autoTradingLog)
      .where(eq(autoTradingLog.userId, userId))
      .orderBy(desc(autoTradingLog.createdAt))
      .limit(limit);
  },

  // Get stats
  async getStats(userId: string) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const logs = await db
      .select()
      .from(autoTradingLog)
      .where(
        and(
          eq(autoTradingLog.userId, userId),
          gte(autoTradingLog.createdAt, todayStart)
        )
      );

    const executed = logs.filter((l) => l.action === "executed").length;
    const skipped = logs.filter((l) => l.action === "skipped").length;
    const errors = logs.filter((l) => l.action === "error").length;

    return {
      todayExecuted: executed,
      todaySkipped: skipped,
      todayErrors: errors,
      totalToday: logs.length,
    };
  },
};
