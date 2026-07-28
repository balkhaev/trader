import { logger } from "../../lib/logger";
import { strategyRunnerService } from "./strategy-runner.service";
import { strategyService } from "./strategy.service";

const POLL_INTERVAL = 60_000;

class StrategyScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  start(): void {
    if (this.timer || process.env.STRATEGY_SCHEDULER_ENABLED !== "true") {
      return;
    }
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL);
    void this.tick();
    logger.info("Consensus strategy scheduler started", {
      intervalMs: POLL_INTERVAL,
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
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
