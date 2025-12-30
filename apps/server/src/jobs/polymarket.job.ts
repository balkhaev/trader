import { polymarketService } from "../services/polymarket.service";
import { polymarketCorrelationService } from "../services/polymarket-correlation.service";

// Интервалы для cron jobs (в миллисекундах)
const INTERVALS = {
  PROBABILITY_SNAPSHOTS: 10 * 60 * 1000, // 10 минут
  COMMENTS: 6 * 60 * 60 * 1000, // 6 часов
  HOLDERS: 12 * 60 * 60 * 1000, // 12 часов
  ASSET_MAPPINGS: 24 * 60 * 60 * 1000, // 24 часа
  CLEANUP: 24 * 60 * 60 * 1000, // 24 часа
};

let isRunning = false;
const intervals: ReturnType<typeof setInterval>[] = [];

export function startPolymarketJobs(): void {
  if (isRunning) {
    console.log("[Polymarket Jobs] Already running");
    return;
  }

  isRunning = true;
  console.log("[Polymarket Jobs] Starting background jobs...");

  // Job 1: Снимки вероятностей каждые 10 минут
  intervals.push(
    setInterval(async () => {
      try {
        console.log("[Polymarket Jobs] Creating probability snapshots...");
        const count = await polymarketService.createSnapshotsForActiveMarkets();
        console.log(`[Polymarket Jobs] Created ${count} probability snapshots`);
      } catch (error) {
        console.error("[Polymarket Jobs] Error creating snapshots:", error);
      }
    }, INTERVALS.PROBABILITY_SNAPSHOTS)
  );

  // Job 2: Парсинг комментариев каждые 6 часов
  intervals.push(
    setInterval(async () => {
      try {
        console.log("[Polymarket Jobs] Fetching comments...");
        const events = await polymarketService.getStoredEvents({
          active: true,
          closed: false,
          minVolume: 50_000,
          limit: 50,
        });

        let totalComments = 0;
        for (const event of events) {
          const count = await polymarketService.fetchComments(event.id);
          totalComments += count;
          // Небольшая задержка между запросами
          await new Promise((r) => setTimeout(r, 500));
        }
        console.log(
          `[Polymarket Jobs] Fetched ${totalComments} comments from ${events.length} events`
        );
      } catch (error) {
        console.error("[Polymarket Jobs] Error fetching comments:", error);
      }
    }, INTERVALS.COMMENTS)
  );

  // Job 3: Обновление top holders каждые 12 часов
  intervals.push(
    setInterval(async () => {
      try {
        console.log("[Polymarket Jobs] Fetching top holders...");
        const opportunities = await polymarketService.getOpportunities({
          limit: 30,
        });

        let totalHolders = 0;
        for (const market of opportunities) {
          const count = await polymarketService.fetchTopHolders(market.id);
          totalHolders += count;
          await new Promise((r) => setTimeout(r, 500));
        }
        console.log(
          `[Polymarket Jobs] Fetched ${totalHolders} holders from ${opportunities.length} markets`
        );
      } catch (error) {
        console.error("[Polymarket Jobs] Error fetching holders:", error);
      }
    }, INTERVALS.HOLDERS)
  );

  // Job 4: Обновление asset mappings ежедневно
  intervals.push(
    setInterval(async () => {
      try {
        console.log("[Polymarket Jobs] Updating asset mappings...");
        const count = await polymarketCorrelationService.updateAssetMappings();
        console.log(`[Polymarket Jobs] Updated ${count} asset mappings`);
      } catch (error) {
        console.error(
          "[Polymarket Jobs] Error updating asset mappings:",
          error
        );
      }
    }, INTERVALS.ASSET_MAPPINGS)
  );

  // Job 5: Очистка старых снимков (>7 дней) ежедневно
  intervals.push(
    setInterval(async () => {
      try {
        console.log("[Polymarket Jobs] Cleaning up old snapshots...");
        const { db, polymarketProbabilitySnapshot } = await import(
          "@trader/db"
        );
        const { lt } = await import("drizzle-orm");

        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        await db
          .delete(polymarketProbabilitySnapshot)
          .where(lt(polymarketProbabilitySnapshot.timestamp, cutoff));

        console.log("[Polymarket Jobs] Cleanup completed");
      } catch (error) {
        console.error("[Polymarket Jobs] Error cleaning up:", error);
      }
    }, INTERVALS.CLEANUP)
  );

  // Запускаем первоначальное создание снимков сразу
  setTimeout(async () => {
    try {
      console.log("[Polymarket Jobs] Initial probability snapshots...");
      const count = await polymarketService.createSnapshotsForActiveMarkets();
      console.log(`[Polymarket Jobs] Created ${count} initial snapshots`);
    } catch (error) {
      console.error(
        "[Polymarket Jobs] Error creating initial snapshots:",
        error
      );
    }
  }, 5000); // Через 5 секунд после старта

  console.log("[Polymarket Jobs] All jobs scheduled");
}

export function stopPolymarketJobs(): void {
  if (!isRunning) return;

  console.log("[Polymarket Jobs] Stopping all jobs...");
  for (const interval of intervals) {
    clearInterval(interval);
  }
  intervals.length = 0;
  isRunning = false;
  console.log("[Polymarket Jobs] All jobs stopped");
}

export function getJobStatus(): { isRunning: boolean; jobCount: number } {
  return {
    isRunning,
    jobCount: intervals.length,
  };
}
