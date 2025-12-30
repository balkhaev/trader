import { db, marketAsset, marketCandle } from "@trader/db";
import { and, eq } from "drizzle-orm";
import type {
  AssetInfo,
  DataSource,
  ICollector,
  MarketAsset,
  OHLCV,
  Timeframe,
} from "../types";

export abstract class BaseCollector implements ICollector {
  abstract readonly name: string;
  abstract readonly dataSource: DataSource;

  abstract fetchOHLCV(
    symbol: string,
    timeframe: Timeframe,
    limit?: number
  ): Promise<OHLCV[]>;

  abstract fetchTopSymbols(limit?: number): Promise<string[]>;

  abstract getAssetInfo(symbol: string): Promise<AssetInfo>;

  /**
   * Сохраняет или обновляет актив в БД
   */
  async upsertAsset(info: AssetInfo): Promise<MarketAsset> {
    const existing = await db
      .select()
      .from(marketAsset)
      .where(
        and(
          eq(marketAsset.symbol, info.symbol),
          eq(marketAsset.dataSource, info.dataSource)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      const asset = existing[0] as MarketAsset;
      await db
        .update(marketAsset)
        .set({
          name: info.name,
          baseCurrency: info.baseCurrency,
          quoteCurrency: info.quoteCurrency,
          sector: info.sector,
          metadata: info.metadata,
        })
        .where(eq(marketAsset.id, asset.id));

      return { ...asset, ...info };
    }

    const [newAsset] = await db
      .insert(marketAsset)
      .values({
        symbol: info.symbol,
        name: info.name,
        marketType: info.marketType,
        dataSource: info.dataSource,
        baseCurrency: info.baseCurrency,
        quoteCurrency: info.quoteCurrency,
        sector: info.sector,
        metadata: info.metadata,
      })
      .returning();

    return newAsset as MarketAsset;
  }

  /**
   * Сохраняет свечи в БД (upsert)
   */
  async saveCandles(
    assetId: string,
    timeframe: Timeframe,
    candles: OHLCV[]
  ): Promise<number> {
    if (candles.length === 0) return 0;

    let savedCount = 0;

    for (const candle of candles) {
      const openTime = new Date(candle.timestamp);
      const closeTime = this.getCloseTime(openTime, timeframe);

      try {
        await db
          .insert(marketCandle)
          .values({
            assetId,
            timeframe,
            openTime,
            closeTime,
            open: String(candle.open),
            high: String(candle.high),
            low: String(candle.low),
            close: String(candle.close),
            volume: String(candle.volume),
            quoteVolume: candle.quoteVolume ? String(candle.quoteVolume) : null,
            trades: candle.trades ? String(candle.trades) : null,
          })
          .onConflictDoUpdate({
            target: [
              marketCandle.assetId,
              marketCandle.timeframe,
              marketCandle.openTime,
            ],
            set: {
              high: String(candle.high),
              low: String(candle.low),
              close: String(candle.close),
              volume: String(candle.volume),
              quoteVolume: candle.quoteVolume
                ? String(candle.quoteVolume)
                : null,
              trades: candle.trades ? String(candle.trades) : null,
            },
          });

        savedCount++;
      } catch (error) {
        console.error(
          `[${this.name}] Error saving candle for asset ${assetId}:`,
          error
        );
      }
    }

    return savedCount;
  }

  /**
   * Получает актив по символу и источнику
   */
  async getAsset(symbol: string): Promise<MarketAsset | null> {
    const [asset] = await db
      .select()
      .from(marketAsset)
      .where(
        and(
          eq(marketAsset.symbol, symbol),
          eq(marketAsset.dataSource, this.dataSource)
        )
      )
      .limit(1);

    return (asset as MarketAsset) || null;
  }

  /**
   * Полный цикл сбора данных для символа
   */
  async collect(
    symbol: string,
    timeframe: Timeframe,
    limit = 500
  ): Promise<{ asset: MarketAsset; candlesSaved: number }> {
    // 1. Получаем/создаем актив
    const assetInfo = await this.getAssetInfo(symbol);
    const asset = await this.upsertAsset(assetInfo);

    // 2. Получаем свечи
    const candles = await this.fetchOHLCV(symbol, timeframe, limit);

    // 3. Сохраняем свечи
    const candlesSaved = await this.saveCandles(asset.id, timeframe, candles);

    console.log(
      `[${this.name}] Collected ${candlesSaved} candles for ${symbol} (${timeframe})`
    );

    return { asset, candlesSaved };
  }

  /**
   * Сбор данных для топ символов
   */
  async collectTop(
    timeframe: Timeframe,
    topCount = 50,
    limit = 500
  ): Promise<{ totalAssets: number; totalCandles: number }> {
    const symbols = await this.fetchTopSymbols(topCount);
    let totalAssets = 0;
    let totalCandles = 0;

    for (const symbol of symbols) {
      try {
        const result = await this.collect(symbol, timeframe, limit);
        totalAssets++;
        totalCandles += result.candlesSaved;

        // Небольшая задержка чтобы не перегружать API
        await this.delay(100);
      } catch (error) {
        console.error(`[${this.name}] Error collecting ${symbol}:`, error);
      }
    }

    console.log(
      `[${this.name}] Collected ${totalCandles} candles for ${totalAssets} assets (${timeframe})`
    );

    return { totalAssets, totalCandles };
  }

  /**
   * Вспомогательный метод для расчета времени закрытия свечи
   */
  protected getCloseTime(openTime: Date, timeframe: Timeframe): Date {
    const closeTime = new Date(openTime);

    switch (timeframe) {
      case "1m":
        closeTime.setMinutes(closeTime.getMinutes() + 1);
        break;
      case "5m":
        closeTime.setMinutes(closeTime.getMinutes() + 5);
        break;
      case "15m":
        closeTime.setMinutes(closeTime.getMinutes() + 15);
        break;
      case "1h":
        closeTime.setHours(closeTime.getHours() + 1);
        break;
      case "4h":
        closeTime.setHours(closeTime.getHours() + 4);
        break;
      case "1d":
        closeTime.setDate(closeTime.getDate() + 1);
        break;
      case "1w":
        closeTime.setDate(closeTime.getDate() + 7);
        break;
    }

    return closeTime;
  }

  /**
   * Конвертация таймфрейма в формат биржи
   */
  protected abstract timeframeToExchange(timeframe: Timeframe): string;

  /**
   * Delay helper
   */
  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
