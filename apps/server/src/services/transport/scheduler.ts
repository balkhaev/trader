import { transportService } from "./transport.service";

interface SchedulerState {
  isRunning: boolean;
  lastRun: Record<string, Date>;
  intervals: Record<string, ReturnType<typeof setInterval> | null>;
}

const state: SchedulerState = {
  isRunning: false,
  lastRun: {},
  intervals: {
    collectAircraft: null,
    collectVessels: null,
    analyze: null,
  },
};

// Интервалы в миллисекундах
const INTERVALS = {
  collectAircraft: 15 * 60 * 1000, // 15 минут (OpenSky rate limit friendly)
  collectVessels: 60 * 60 * 1000, // 1 час (AIS Hub limits)
  analyze: 30 * 60 * 1000, // 30 минут
};

export const transportScheduler = {
  /**
   * Запуск всех задач
   */
  start(): void {
    if (state.isRunning) {
      console.log("[TransportScheduler] Already running");
      return;
    }

    state.isRunning = true;
    console.log("[TransportScheduler] Starting...");

    // Сбор данных о самолётах (15 минут)
    state.intervals.collectAircraft = setInterval(async () => {
      try {
        console.log("[TransportScheduler] Collecting aircraft data...");
        const result = await transportService.collectAircraft();
        state.lastRun.collectAircraft = new Date();
        console.log(
          `[TransportScheduler] Aircraft: ${result.aircraftCollected} collected, ${result.positionsRecorded} positions`
        );
      } catch (error) {
        console.error(
          "[TransportScheduler] Aircraft collection failed:",
          error
        );
      }
    }, INTERVALS.collectAircraft);

    // Сбор данных о судах (1 час)
    state.intervals.collectVessels = setInterval(async () => {
      try {
        console.log("[TransportScheduler] Collecting vessel data...");
        const result = await transportService.collectVessels();
        state.lastRun.collectVessels = new Date();
        console.log(
          `[TransportScheduler] Vessels: ${result.vesselsCollected} collected, ${result.positionsRecorded} positions`
        );
      } catch (error) {
        console.error("[TransportScheduler] Vessel collection failed:", error);
      }
    }, INTERVALS.collectVessels);

    // Анализ и генерация сигналов (30 минут)
    state.intervals.analyze = setInterval(async () => {
      try {
        console.log("[TransportScheduler] Running analysis...");
        const result = await transportService.analyzeAndGenerateSignals();
        state.lastRun.analyze = new Date();
        console.log(
          `[TransportScheduler] Analysis: ${result.flowsAnalyzed} flows, ${result.signalsGenerated} signals`
        );
      } catch (error) {
        console.error("[TransportScheduler] Analysis failed:", error);
      }
    }, INTERVALS.analyze);

    console.log("[TransportScheduler] Started all tasks");
    console.log(
      `  - Aircraft collection: every ${INTERVALS.collectAircraft / 60_000} min`
    );
    console.log(
      `  - Vessel collection: every ${INTERVALS.collectVessels / 60_000} min`
    );
    console.log(`  - Analysis: every ${INTERVALS.analyze / 60_000} min`);

    // Запускаем первичный сбор данных
    this.initialCollection();
  },

  /**
   * Остановка всех задач
   */
  stop(): void {
    if (!state.isRunning) {
      console.log("[TransportScheduler] Not running");
      return;
    }

    for (const [name, interval] of Object.entries(state.intervals)) {
      if (interval) {
        clearInterval(interval);
        state.intervals[name] = null;
      }
    }

    state.isRunning = false;
    console.log("[TransportScheduler] Stopped");
  },

  /**
   * Первичный сбор данных при старте
   */
  async initialCollection(): Promise<void> {
    console.log("[TransportScheduler] Running initial collection...");

    try {
      // Сначала собираем данные
      console.log("[TransportScheduler] Initial aircraft collection...");
      const aircraftResult = await transportService.collectAircraft();
      state.lastRun.collectAircraft = new Date();
      console.log(
        `[TransportScheduler] Initial aircraft: ${aircraftResult.aircraftCollected} collected`
      );

      console.log("[TransportScheduler] Initial vessel collection...");
      const vesselResult = await transportService.collectVessels();
      state.lastRun.collectVessels = new Date();
      console.log(
        `[TransportScheduler] Initial vessels: ${vesselResult.vesselsCollected} collected`
      );

      // Затем анализируем
      console.log("[TransportScheduler] Initial analysis...");
      const analysisResult = await transportService.analyzeAndGenerateSignals();
      state.lastRun.analyze = new Date();
      console.log(
        `[TransportScheduler] Initial analysis: ${analysisResult.signalsGenerated} signals`
      );

      console.log("[TransportScheduler] Initial collection completed");
    } catch (error) {
      console.error("[TransportScheduler] Initial collection failed:", error);
    }
  },

  /**
   * Ручной запуск сбора данных
   */
  async collectNow(): Promise<{
    aircraft: { collected: number; positions: number };
    vessels: { collected: number; positions: number };
  }> {
    console.log("[TransportScheduler] Manual collection triggered...");

    const aircraftResult = await transportService.collectAircraft();
    state.lastRun.collectAircraft = new Date();

    const vesselResult = await transportService.collectVessels();
    state.lastRun.collectVessels = new Date();

    return {
      aircraft: {
        collected: aircraftResult.aircraftCollected,
        positions: aircraftResult.positionsRecorded,
      },
      vessels: {
        collected: vesselResult.vesselsCollected,
        positions: vesselResult.positionsRecorded,
      },
    };
  },

  /**
   * Ручной запуск анализа
   */
  async analyzeNow(): Promise<{
    flowsAnalyzed: number;
    signalsGenerated: number;
  }> {
    console.log("[TransportScheduler] Manual analysis triggered...");

    const result = await transportService.analyzeAndGenerateSignals();
    state.lastRun.analyze = new Date();

    return result;
  },

  /**
   * Получение статуса
   */
  getStatus(): {
    isRunning: boolean;
    lastRun: Record<string, Date | null>;
    nextRun: Record<string, Date | null>;
    intervals: Record<string, number>;
  } {
    const nextRun: Record<string, Date | null> = {};

    for (const [name, interval] of Object.entries(INTERVALS)) {
      const lastRunTime = state.lastRun[name]?.getTime();
      if (lastRunTime) {
        nextRun[name] = new Date(lastRunTime + interval);
      } else {
        nextRun[name] = null;
      }
    }

    return {
      isRunning: state.isRunning,
      lastRun: {
        collectAircraft: state.lastRun.collectAircraft || null,
        collectVessels: state.lastRun.collectVessels || null,
        analyze: state.lastRun.analyze || null,
      },
      nextRun,
      intervals: {
        collectAircraft: INTERVALS.collectAircraft / 60_000,
        collectVessels: INTERVALS.collectVessels / 60_000,
        analyze: INTERVALS.analyze / 60_000,
      },
    };
  },
};
