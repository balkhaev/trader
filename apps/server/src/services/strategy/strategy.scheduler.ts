import { logger } from "../../lib/logger";
import { strategyRunnerService } from "./strategy-runner.service";
import { strategyService } from "./strategy.service";

const FIFTEEN_MINUTES = 15 * 60_000;
const CLOSE_SETTLE_DELAY = 5_000;

class StrategyScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private nextRunAt: number | null = null;

  start(): void {
    if (this.timer || process.env.STRATEGY_SCHEDULER_ENABLED !== "true") {
      return;
    }
    this.scheduleNext();
    logger.info("Consensus strategy scheduler enabled", {
      cadenceMinutes: 15,
    });
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.nextRunAt = null;
  }

  status() {
    return {
      enabled: process.env.STRATEGY_SCHEDULER_ENABLED === "true",
      running: this.running,
      nextRunAt: this.nextRunAt
        ? new Date(this.nextRunAt).toISOString()
        : null,
    };
  }

  private scheduleNext(): void {
    if (process.env.STRATEGY_SCHEDULER_ENABLED !== "true") return;
    const now = Date.now();
    let next = Math.ceil(now / FIFTEEN_MINUTES) * FIFTEEN_MINUTES;
    next += CLOSE_SETTLE_DELAY;
    if (next <= now + 1_000) next += FIFTEEN_MINUTES;
    this.nextRunAt = next;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.nextRunAt = null;
      void this.tick()
        .catch((error) =>
          logger.error("Consensus scheduler tick failed", {
            error: error instanceof Error ? error.message : String(error),
          })
        )
        .finally(() => this.scheduleNext());
    }, Math.max(1_000, next - now));
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const active = await strategyService.getActive();
      for (const item of active) {
        try {
          await strategyRunnerService.scanUser(item.userId, { execute: true });
        } catch (error) {
          logger.error("Consensus strategy scan failed", {
            userId: item.userId,
            strategyId: item.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      this.running = false;
    }
  }
}

export const strategyScheduler = new StrategyScheduler();
