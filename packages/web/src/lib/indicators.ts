/**
 * Pure indicator calculation functions for BTC price analysis.
 * No side effects — each function takes data, returns value + signal.
 */

import type { Kline, Trade, OrderbookLevel } from "./binanceWs";

export type Signal = "BULLISH" | "NEUTRAL" | "BEARISH";

export interface IndicatorResult {
  value: number | string;
  signal: Signal;
}

// --- 1. Order Book Imbalance (OBI) ---

export function computeOBI(
  bids: OrderbookLevel[],
  asks: OrderbookLevel[],
  mid: number,
  band = 0.01,
): IndicatorResult {
  const lo = mid * (1 - band);
  const hi = mid * (1 + band);

  let bidVol = 0;
  for (const [p, q] of bids) {
    if (p >= lo) bidVol += q;
  }
  let askVol = 0;
  for (const [p, q] of asks) {
    if (p <= hi) askVol += q;
  }

  const total = bidVol + askVol;
  const obi = total > 0 ? (bidVol - askVol) / total : 0;
  const signal: Signal = obi > 0.1 ? "BULLISH" : obi < -0.1 ? "BEARISH" : "NEUTRAL";

  return { value: +obi.toFixed(4), signal };
}

// --- 2. Cumulative Volume Delta (CVD) ---

export function computeCVD(
  trades: Trade[],
  windowSec = 300,
): IndicatorResult {
  const cutoff = Date.now() - windowSec * 1000;
  let delta = 0;
  for (const t of trades) {
    if (t.time >= cutoff) {
      delta += t.isBuy ? t.qty : -t.qty;
    }
  }

  const signal: Signal = delta > 0 ? "BULLISH" : delta < 0 ? "BEARISH" : "NEUTRAL";
  return { value: +delta.toFixed(4), signal };
}

// --- 3. RSI ---

export function computeRSI(
  klines: Kline[],
  period = 14,
): IndicatorResult {
  if (klines.length < period + 1) return { value: 50, signal: "NEUTRAL" };

  const closes = klines.slice(-(period + 1)).map((k) => k.c);
  let gainSum = 0;
  let lossSum = 0;

  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gainSum += diff;
    else lossSum += -diff;
  }

  const avgGain = gainSum / period;
  const avgLoss = lossSum / period;

  if (avgLoss === 0) return { value: 100, signal: "BEARISH" };
  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);

  // RSI < 30 = oversold = BULLISH bounce expected; RSI > 70 = overbought = BEARISH
  const signal: Signal = rsi < 30 ? "BULLISH" : rsi > 70 ? "BEARISH" : "NEUTRAL";
  return { value: +rsi.toFixed(2), signal };
}

// --- 4. MACD ---

export function computeMACD(
  klines: Kline[],
  fast = 12,
  slow = 26,
  sigPeriod = 9,
): IndicatorResult {
  if (klines.length < slow + sigPeriod) return { value: 0, signal: "NEUTRAL" };

  const closes = klines.map((k) => k.c);
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);

  // MACD line for each bar where both EMAs exist
  const macdLine: number[] = [];
  const offset = closes.length - Math.min(emaFast.length, emaSlow.length);
  const fastOffset = emaFast.length - Math.min(emaFast.length, emaSlow.length);
  const slowOffset = emaSlow.length - Math.min(emaFast.length, emaSlow.length);

  for (let i = 0; i < Math.min(emaFast.length, emaSlow.length); i++) {
    macdLine.push(emaFast[fastOffset + i] - emaSlow[slowOffset + i]);
  }

  const signalLine = ema(macdLine, sigPeriod);
  const histogram = macdLine[macdLine.length - 1] - signalLine[signalLine.length - 1];

  const signal: Signal = histogram > 0 ? "BULLISH" : histogram < 0 ? "BEARISH" : "NEUTRAL";
  return { value: +histogram.toFixed(2), signal };
}

// --- 5. EMA Cross ---

export function computeEMACross(
  klines: Kline[],
  shortPeriod = 5,
  longPeriod = 20,
): IndicatorResult {
  if (klines.length < longPeriod) return { value: "N/A", signal: "NEUTRAL" };

  const closes = klines.map((k) => k.c);
  const emaShort = ema(closes, shortPeriod);
  const emaLong = ema(closes, longPeriod);

  const shortVal = emaShort[emaShort.length - 1];
  const longVal = emaLong[emaLong.length - 1];
  const diff = shortVal - longVal;

  const signal: Signal = diff > 0 ? "BULLISH" : "BEARISH";
  return { value: +diff.toFixed(2), signal };
}

// --- 6. VWAP ---

export function computeVWAP(
  klines: Kline[],
  currentMid: number,
): IndicatorResult {
  if (klines.length === 0) return { value: 0, signal: "NEUTRAL" };

  let cumPV = 0;
  let cumV = 0;
  for (const k of klines) {
    const typical = (k.h + k.l + k.c) / 3;
    cumPV += typical * k.v;
    cumV += k.v;
  }

  const vwap = cumV > 0 ? cumPV / cumV : currentMid;
  const signal: Signal = currentMid > vwap ? "BULLISH" : currentMid < vwap ? "BEARISH" : "NEUTRAL";
  return { value: +vwap.toFixed(2), signal };
}

// --- 7. Heikin Ashi ---

export function computeHeikinAshi(
  klines: Kline[],
  streakThreshold = 3,
): IndicatorResult {
  if (klines.length < 2) return { value: 0, signal: "NEUTRAL" };

  // Build HA candles
  const ha: { o: number; c: number }[] = [];
  for (let i = 0; i < klines.length; i++) {
    const k = klines[i];
    const haClose = (k.o + k.h + k.l + k.c) / 4;
    const haOpen = i === 0 ? (k.o + k.c) / 2 : (ha[i - 1].o + ha[i - 1].c) / 2;
    ha.push({ o: haOpen, c: haClose });
  }

  // Count streak from end
  let streak = 0;
  const lastGreen = ha[ha.length - 1].c > ha[ha.length - 1].o;
  for (let i = ha.length - 1; i >= 0; i--) {
    const green = ha[i].c > ha[i].o;
    if (green === lastGreen) streak++;
    else break;
  }

  const directedStreak = lastGreen ? streak : -streak;
  const signal: Signal =
    streak >= streakThreshold
      ? lastGreen
        ? "BULLISH"
        : "BEARISH"
      : "NEUTRAL";

  return { value: directedStreak, signal };
}

// --- 8. Volume Profile — Point of Control (POC) ---

export function computePOC(
  klines: Kline[],
  currentMid: number,
  bins = 30,
): IndicatorResult {
  if (klines.length === 0) return { value: 0, signal: "NEUTRAL" };

  let lo = Infinity;
  let hi = -Infinity;
  for (const k of klines) {
    if (k.l < lo) lo = k.l;
    if (k.h > hi) hi = k.h;
  }

  if (hi === lo) return { value: currentMid, signal: "NEUTRAL" };

  const binSize = (hi - lo) / bins;
  const volumes = new Float64Array(bins);

  for (const k of klines) {
    const typical = (k.h + k.l + k.c) / 3;
    const idx = Math.min(Math.floor((typical - lo) / binSize), bins - 1);
    volumes[idx] += k.v;
  }

  let maxIdx = 0;
  for (let i = 1; i < bins; i++) {
    if (volumes[i] > volumes[maxIdx]) maxIdx = i;
  }

  const poc = lo + (maxIdx + 0.5) * binSize;
  const signal: Signal = currentMid > poc ? "BULLISH" : currentMid < poc ? "BEARISH" : "NEUTRAL";
  return { value: +poc.toFixed(2), signal };
}

// --- 9. Bid/Ask Walls ---

export function computeWalls(
  bids: OrderbookLevel[],
  asks: OrderbookLevel[],
  mult = 5,
): IndicatorResult {
  // A "wall" is a level with qty >= mult × median qty
  const allQtys = [...bids, ...asks].map(([, q]) => q);
  if (allQtys.length === 0) return { value: 0, signal: "NEUTRAL" };

  allQtys.sort((a, b) => a - b);
  const median = allQtys[Math.floor(allQtys.length / 2)];
  const threshold = median * mult;

  let bidWalls = 0;
  let askWalls = 0;
  for (const [, q] of bids) {
    if (q >= threshold) bidWalls++;
  }
  for (const [, q] of asks) {
    if (q >= threshold) askWalls++;
  }

  const net = bidWalls - askWalls;
  const signal: Signal = net > 0 ? "BULLISH" : net < 0 ? "BEARISH" : "NEUTRAL";
  return { value: net, signal };
}

// --- Composite Bias Score ---

interface AllIndicators {
  obi: IndicatorResult;
  cvd: IndicatorResult;
  rsi: IndicatorResult;
  macd: IndicatorResult;
  emaCross: IndicatorResult;
  vwap: IndicatorResult;
  heikinAshi: IndicatorResult;
  poc: IndicatorResult;
  walls: IndicatorResult;
}

export function computeBias(ind: AllIndicators): { score: number; signal: Signal } {
  const MAX_WEIGHT = 56;

  let sum = 0;

  // EMA Cross: weight 10, binary
  sum += (ind.emaCross.signal === "BULLISH" ? 10 : -10);

  // OBI: weight 8, linear
  sum += (typeof ind.obi.value === "number" ? ind.obi.value : 0) * 8;

  // MACD: weight 8, binary
  sum += (ind.macd.signal === "BULLISH" ? 8 : ind.macd.signal === "BEARISH" ? -8 : 0);

  // CVD: weight 7, binary
  sum += (ind.cvd.signal === "BULLISH" ? 7 : ind.cvd.signal === "BEARISH" ? -7 : 0);

  // Heikin Ashi: weight 6, streak-scaled
  const haStreak = typeof ind.heikinAshi.value === "number" ? ind.heikinAshi.value : 0;
  sum += Math.max(-6, Math.min(6, haStreak * 2));

  // VWAP: weight 5, binary
  sum += (ind.vwap.signal === "BULLISH" ? 5 : ind.vwap.signal === "BEARISH" ? -5 : 0);

  // RSI: weight 5, linear ramp
  const rsiVal = typeof ind.rsi.value === "number" ? ind.rsi.value : 50;
  const rsiNorm = (50 - rsiVal) / 50; // -1 (overbought) to +1 (oversold → bullish bounce)
  sum += rsiNorm * 5;

  // Walls: weight 4, wall-count-scaled
  const wallNet = typeof ind.walls.value === "number" ? ind.walls.value : 0;
  sum += Math.max(-4, Math.min(4, wallNet * 2));

  // POC: weight 3, binary
  sum += (ind.poc.signal === "BULLISH" ? 3 : ind.poc.signal === "BEARISH" ? -3 : 0);

  const score = Math.max(-100, Math.min(100, (sum / MAX_WEIGHT) * 100));
  const signal: Signal = score > 10 ? "BULLISH" : score < -10 ? "BEARISH" : "NEUTRAL";

  return { score: +score.toFixed(1), signal };
}

// --- Helpers ---

/** Simple EMA over a series of values */
function ema(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];

  // Seed with SMA
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  result.push(sum / period);

  for (let i = period; i < values.length; i++) {
    result.push(values[i] * k + result[result.length - 1] * (1 - k));
  }

  return result;
}
