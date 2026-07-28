import type {
  DotEvaluationInput,
  WifEvaluationInput,
} from "./consensus-wif-dot.service";

const FUTURES_API = "https://fapi.binance.com";
const FIFTEEN_MINUTES = 15 * 60_000;

interface BinanceKline extends Array<number | string> {
  0: number;
  1: string;
  2: string;
  3: string;
  4: string;
  5: string;
  6: number;
  7: string;
  8: number;
  9: string;
  10: string;
  11: string;
}

interface OpenInterestPoint {
  symbol: string;
  sumOpenInterest: string;
  sumOpenInterestValue: string;
  timestamp: number;
}

interface FundingPoint {
  symbol: string;
  fundingTime: number;
  fundingRate: string;
  markPrice?: string;
}

interface PricePoint {
  symbol: string;
  price: string;
  time?: number;
}

interface NumericKline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  quoteVolume: number;
  takerBuyQuote: number;
  closeTime: number;
}

export interface ConsensusMarketScan {
  scannedAt: string;
  wif?: WifEvaluationInput;
  dot?: DotEvaluationInput;
  diagnostics: {
    wifKlines: number;
    wifPremiumKlines: number;
    wifOpenInterestPoints: number;
    dotFundingTime?: string;
  };
}

async function fetchJson<T>(
  path: string,
  params: Record<string, string>
): Promise<T> {
  const url = new URL(path, FUTURES_API);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Binance USD-M public API ${response.status}: ${await response.text()}`
    );
  }
  return (await response.json()) as T;
}

function numericKlines(rows: BinanceKline[], now: number): NumericKline[] {
  return rows
    .map((row) => ({
      openTime: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      quoteVolume: Number(row[7]),
      takerBuyQuote: Number(row[10]),
      closeTime: Number(row[6]),
    }))
    .filter(
      (row) =>
        row.closeTime < now &&
        [
          row.open,
          row.high,
          row.low,
          row.close,
          row.quoteVolume,
          row.takerBuyQuote,
        ].every(Number.isFinite)
    )
    .sort((a, b) => a.openTime - b.openTime);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

function zScore(values: number[]): number {
  if (values.length < 20) return Number.NaN;
  const latest = values.at(-1)!;
  const sample = values.slice(0, -1);
  const deviation = standardDeviation(sample);
  return deviation > 0 ? (latest - mean(sample)) / deviation : 0;
}

function atr14(rows: NumericKline[]): number {
  const sample = rows.slice(-80);
  if (sample.length < 15) return Number.NaN;
  const trueRanges: number[] = [];
  for (let index = 1; index < sample.length; index += 1) {
    const row = sample[index]!;
    const previous = sample[index - 1]!;
    trueRanges.push(
      Math.max(
        row.high - row.low,
        Math.abs(row.high - previous.close),
        Math.abs(row.low - previous.close)
      )
    );
  }
  let value = mean(trueRanges.slice(0, 14));
  for (const range of trueRanges.slice(14)) {
    value = (value * 13 + range) / 14;
  }
  return value;
}

async function fetchOpenInterestHistory(
  symbol: string
): Promise<OpenInterestPoint[]> {
  const all: OpenInterestPoint[] = [];
  let endTime = Date.now();
  for (let batch = 0; batch < 4; batch += 1) {
    const rows = await fetchJson<OpenInterestPoint[]>(
      "/futures/data/openInterestHist",
      {
        symbol,
        period: "5m",
        limit: "500",
        endTime: String(endTime),
      }
    );
    if (rows.length === 0) break;
    all.unshift(...rows);
    const firstTimestamp = Math.min(
      ...rows.map((row) => Number(row.timestamp))
    );
    if (!Number.isFinite(firstTimestamp) || firstTimestamp <= 0) break;
    endTime = firstTimestamp - 1;
  }
  return Array.from(
    new Map(
      all
        .filter((row) => Number.isFinite(Number(row.timestamp)))
        .map((row) => [Number(row.timestamp), row])
    ).values()
  ).sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
}

function oiChangeZ(rows: OpenInterestPoint[]): number {
  const points = rows
    .map((row) => ({
      timestamp: Number(row.timestamp),
      oi: Number(row.sumOpenInterest),
    }))
    .filter((row) => Number.isFinite(row.timestamp) && row.oi > 0);
  const changes: number[] = [];
  for (let index = 9; index < points.length; index += 1) {
    const current = points[index]!.oi;
    const previous = points[index - 9]!.oi;
    changes.push(current / previous - 1);
  }
  return zScore(changes.slice(-1000));
}

async function fetchPrice(symbol: string): Promise<number> {
  const row = await fetchJson<PricePoint>("/fapi/v1/ticker/price", { symbol });
  const price = Number(row.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Invalid ${symbol} price`);
  }
  return price;
}

async function scanWif(now: number): Promise<{
  input?: WifEvaluationInput;
  klines: number;
  premiumKlines: number;
  openInterestPoints: number;
}> {
  const [rawKlines, rawPremium, oiRows, entryPrice] = await Promise.all([
    fetchJson<BinanceKline[]>("/fapi/v1/klines", {
      symbol: "WIFUSDT",
      interval: "15m",
      limit: "700",
    }),
    fetchJson<BinanceKline[]>("/fapi/v1/premiumIndexKlines", {
      symbol: "WIFUSDT",
      interval: "15m",
      limit: "700",
    }),
    fetchOpenInterestHistory("WIFUSDT"),
    fetchPrice("WIFUSDT"),
  ]);

  const klines = numericKlines(rawKlines, now);
  const premium = numericKlines(rawPremium, now);
  if (klines.length < 673 || premium.length < 673) {
    return {
      klines: klines.length,
      premiumKlines: premium.length,
      openInterestPoints: oiRows.length,
    };
  }

  const latest = klines.at(-1)!;
  const moveStart = klines.at(-4)!;
  const atr = atr14(klines);
  const volumeSeries = klines
    .slice(-673)
    .map((row) => Math.log1p(Math.max(0, row.quoteVolume)));
  const premiumSeries = premium.slice(-673).map((row) => row.close);
  const volumeZ = zScore(volumeSeries);
  const premiumZ = zScore(premiumSeries);
  const oiZ = oiChangeZ(oiRows);
  const takerImbalance =
    latest.quoteVolume > 0
      ? (2 * latest.takerBuyQuote) / latest.quoteVolume - 1
      : 0;
  const move45mAtr =
    Number.isFinite(atr) && atr > 0
      ? (latest.close - moveStart.close) / atr
      : Number.NaN;

  if (![atr, volumeZ, premiumZ, oiZ, move45mAtr].every(Number.isFinite)) {
    return {
      klines: klines.length,
      premiumKlines: premium.length,
      openInterestPoints: oiRows.length,
    };
  }

  return {
    input: {
      symbol: "WIFUSDT",
      signalClosedAt: new Date(latest.closeTime).toISOString(),
      entryPrice,
      open: latest.open,
      high: latest.high,
      low: latest.low,
      close: latest.close,
      atr,
      move45mAtr,
      volumeZ,
      takerImbalance,
      oiZ,
      premiumZ,
    },
    klines: klines.length,
    premiumKlines: premium.length,
    openInterestPoints: oiRows.length,
  };
}

async function scanDot(now: number): Promise<{
  input?: DotEvaluationInput;
  fundingTime?: string;
}> {
  const [fundingRows, rawKlines, entryPrice] = await Promise.all([
    fetchJson<FundingPoint[]>("/fapi/v1/fundingRate", {
      symbol: "DOTUSDT",
      limit: "1",
    }),
    fetchJson<BinanceKline[]>("/fapi/v1/klines", {
      symbol: "DOTUSDT",
      interval: "15m",
      limit: "100",
    }),
    fetchPrice("DOTUSDT"),
  ]);
  const funding = fundingRows.at(-1);
  const klines = numericKlines(rawKlines, now);
  const atr = atr14(klines);
  if (!funding || !Number.isFinite(atr)) return {};
  const fundingTime = new Date(Number(funding.fundingTime)).toISOString();
  return {
    fundingTime,
    input: {
      symbol: "DOTUSDT",
      fundingTime,
      evaluatedAt: new Date(now).toISOString(),
      fundingRateBps: Number(funding.fundingRate) * 10_000,
      entryPrice,
      atr,
    },
  };
}

export const consensusMarketService = {
  async scan(now = Date.now()): Promise<ConsensusMarketScan> {
    const [wif, dot] = await Promise.all([scanWif(now), scanDot(now)]);
    return {
      scannedAt: new Date(now).toISOString(),
      wif: wif.input,
      dot: dot.input,
      diagnostics: {
        wifKlines: wif.klines,
        wifPremiumKlines: wif.premiumKlines,
        wifOpenInterestPoints: wif.openInterestPoints,
        dotFundingTime: dot.fundingTime,
      },
    };
  },

  getExpectedNextScan(now = Date.now()): string {
    const next = Math.ceil(now / FIFTEEN_MINUTES) * FIFTEEN_MINUTES + 5_000;
    return new Date(next).toISOString();
  },
};
