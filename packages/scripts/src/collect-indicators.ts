/**
 * BTC Indicator Collector — runs as a long-lived Node.js process.
 *
 * Connects to Binance WebSocket (trades + klines) and polls the orderbook,
 * computes all 9 indicators every second, and upserts snapshots to Supabase.
 *
 * Run: pnpm --filter scripts collect-indicators
 *
 * Requires env vars: SUPABASE_URL, SUPABASE_SECRET_KEY
 *
 * Supabase table must exist first — see schema in plan docs:
 *   btc_indicator_snapshots (recorded_at, btc_mid, obi, cvd_5m, rsi, ...)
 */

import "dotenv/config";
import { WebSocket } from "ws";
import { supabase } from "./utils/supabase.js";

// --- Types ---

interface Kline {
  t: number; o: number; h: number; l: number; c: number; v: number;
}
interface Trade {
  time: number; price: number; qty: number; isBuy: boolean;
}
type OBLevel = [number, number];

// --- Constants ---

const COMBINED_STREAM = "wss://stream.binance.com/stream?streams=btcusdt@trade/btcusdt@kline_1m";
const OB_URL = "https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=20";
const KLINES_BOOTSTRAP = "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=100";
const SNAPSHOT_INTERVAL_MS = 1_000;
const OB_POLL_MS = 2_000;
const TRADE_BUFFER_SEC = 600;
const TRADE_BUFFER_MAX = 5_000;
const KLINE_BUFFER_MAX = 150;

// --- State ---

let mid: number | null = null;
let bids: OBLevel[] = [];
let asks: OBLevel[] = [];
const trades: Trade[] = [];
let klines: Kline[] = [];
let ws: WebSocket | null = null;
let shuttingDown = false;

// --- Main ---

async function main() {
  console.log("[indicator-collector] Starting...");

  // Bootstrap klines
  try {
    const res = await fetch(KLINES_BOOTSTRAP);
    const raw: any[][] = await res.json();
    klines = raw.map((k) => ({
      t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5],
    }));
    console.log(`[indicator-collector] Bootstrapped ${klines.length} klines`);
  } catch (err) {
    console.error("[indicator-collector] Kline bootstrap failed:", err);
  }

  connectWs();
  startObPoll();
  startSnapshotLoop();

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// --- WebSocket ---

function connectWs() {
  ws = new WebSocket(COMBINED_STREAM);

  ws.on("open", () => console.log("[indicator-collector] WS connected"));

  ws.on("message", (raw: Buffer) => {
    try {
      const wrapper = JSON.parse(raw.toString());
      const { stream, data } = wrapper;
      if (stream === "btcusdt@trade") handleTrade(data);
      else if (stream === "btcusdt@kline_1m") handleKline(data);
    } catch { /* ignore */ }
  });

  ws.on("close", () => {
    if (!shuttingDown) {
      console.log("[indicator-collector] WS closed, reconnecting in 2s...");
      setTimeout(connectWs, 2000);
    }
  });

  ws.on("error", (err) => console.error("[indicator-collector] WS error:", err.message));
}

function handleTrade(data: any) {
  trades.push({
    time: data.T, price: +data.p, qty: +data.q, isBuy: !data.m,
  });
  const cutoff = Date.now() - TRADE_BUFFER_SEC * 1000;
  while (trades.length > 0 && trades[0].time < cutoff) trades.shift();
  if (trades.length > TRADE_BUFFER_MAX) trades.splice(0, trades.length - TRADE_BUFFER_MAX);
}

function handleKline(data: any) {
  const k = data.k;
  if (!k) return;
  const kline: Kline = { t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v };
  const last = klines[klines.length - 1];
  if (last && last.t === kline.t) {
    klines[klines.length - 1] = kline;
  } else {
    klines.push(kline);
  }
  if (klines.length > KLINE_BUFFER_MAX) klines.splice(0, klines.length - KLINE_BUFFER_MAX);
}

// --- Orderbook poll ---

let obTimer: ReturnType<typeof setInterval> | null = null;

function startObPoll() {
  pollOb();
  obTimer = setInterval(pollOb, OB_POLL_MS);
}

async function pollOb() {
  try {
    const res = await fetch(OB_URL);
    const data = await res.json();
    bids = (data.bids as string[][]).map(([p, q]) => [+p, +q] as OBLevel);
    asks = (data.asks as string[][]).map(([p, q]) => [+p, +q] as OBLevel);
    if (bids.length > 0 && asks.length > 0) mid = (bids[0][0] + asks[0][0]) / 2;
  } catch { /* retry next tick */ }
}

// --- Snapshot loop ---

function startSnapshotLoop() {
  setInterval(async () => {
    if (mid === null || klines.length === 0) return;

    // Import indicator functions inline (they are pure, same logic as web)
    // We duplicate the minimal logic here to avoid cross-package dependency
    const snapshot = computeSnapshot();
    if (!snapshot) return;

    const { error } = await supabase
      .from("btc_indicator_snapshots")
      .upsert(snapshot, { onConflict: "recorded_at" });

    if (error) console.error("[indicator-collector] Upsert error:", error.message);
  }, SNAPSHOT_INTERVAL_MS);
}

function computeSnapshot() {
  if (mid === null) return null;

  const now = new Date();
  // Round to nearest second
  now.setMilliseconds(0);

  // OBI
  const obiBand = mid * 0.01;
  let bidVol = 0, askVol = 0;
  for (const [p, q] of bids) if (p >= mid - obiBand) bidVol += q;
  for (const [p, q] of asks) if (p <= mid + obiBand) askVol += q;
  const obiTotal = bidVol + askVol;
  const obi = obiTotal > 0 ? (bidVol - askVol) / obiTotal : 0;

  // CVD (5 min window)
  const cvdCutoff = Date.now() - 300_000;
  let cvd = 0;
  for (const t of trades) if (t.time >= cvdCutoff) cvd += t.isBuy ? t.qty : -t.qty;

  // RSI (14 period)
  const rsi = calcRSI(klines, 14);

  // MACD histogram
  const macdH = calcMACDHistogram(klines);

  // EMA5 / EMA20
  const closes = klines.map(k => k.c);
  const ema5arr = calcEMA(closes, 5);
  const ema20arr = calcEMA(closes, 20);
  const ema5 = ema5arr.length > 0 ? ema5arr[ema5arr.length - 1] : null;
  const ema20 = ema20arr.length > 0 ? ema20arr[ema20arr.length - 1] : null;

  // VWAP
  let cumPV = 0, cumV = 0;
  for (const k of klines) { const tp = (k.h + k.l + k.c) / 3; cumPV += tp * k.v; cumV += k.v; }
  const vwap = cumV > 0 ? cumPV / cumV : null;

  // Heikin Ashi streak
  const haStreak = calcHAStreak(klines);

  // POC
  const poc = calcPOC(klines);

  // Walls
  const allQtys = [...bids, ...asks].map(([, q]) => q).sort((a, b) => a - b);
  const median = allQtys.length > 0 ? allQtys[Math.floor(allQtys.length / 2)] : 0;
  const wallThreshold = median * 5;
  let bidWalls = 0, askWalls = 0;
  for (const [, q] of bids) if (q >= wallThreshold) bidWalls++;
  for (const [, q] of asks) if (q >= wallThreshold) askWalls++;

  // Bias score (simplified)
  const biasScore = calcBiasScore({ obi, cvd, rsi, macdH, ema5, ema20, vwap, haStreak, poc, bidWalls, askWalls, mid });
  const biasSignal = biasScore > 10 ? "BULLISH" : biasScore < -10 ? "BEARISH" : "NEUTRAL";

  return {
    recorded_at: now.toISOString(),
    btc_mid: mid,
    obi,
    cvd_5m: cvd,
    rsi,
    macd_histogram: macdH,
    ema5,
    ema20,
    vwap,
    ha_streak: haStreak,
    poc,
    bid_walls: bidWalls,
    ask_walls: askWalls,
    bias_score: biasScore,
    bias_signal: biasSignal,
  };
}

// --- Minimal indicator math (duplicated to avoid cross-package imports) ---

function calcEMA(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  result.push(sum / period);
  for (let i = period; i < values.length; i++) {
    result.push(values[i] * k + result[result.length - 1] * (1 - k));
  }
  return result;
}

function calcRSI(klines: Kline[], period: number): number | null {
  if (klines.length < period + 1) return null;
  const closes = klines.slice(-(period + 1)).map(k => k.c);
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gainSum += d; else lossSum += -d;
  }
  const avgLoss = lossSum / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + gainSum / period / avgLoss);
}

function calcMACDHistogram(klines: Kline[]): number | null {
  if (klines.length < 35) return null;
  const closes = klines.map(k => k.c);
  const fast = calcEMA(closes, 12);
  const slow = calcEMA(closes, 26);
  const len = Math.min(fast.length, slow.length);
  const macdLine: number[] = [];
  for (let i = 0; i < len; i++) macdLine.push(fast[fast.length - len + i] - slow[slow.length - len + i]);
  const sig = calcEMA(macdLine, 9);
  if (sig.length === 0) return null;
  return macdLine[macdLine.length - 1] - sig[sig.length - 1];
}

function calcHAStreak(klines: Kline[]): number {
  if (klines.length < 2) return 0;
  const ha: { o: number; c: number }[] = [];
  for (let i = 0; i < klines.length; i++) {
    const k = klines[i];
    const c = (k.o + k.h + k.l + k.c) / 4;
    const o = i === 0 ? (k.o + k.c) / 2 : (ha[i - 1].o + ha[i - 1].c) / 2;
    ha.push({ o, c });
  }
  const lastGreen = ha[ha.length - 1].c > ha[ha.length - 1].o;
  let streak = 0;
  for (let i = ha.length - 1; i >= 0; i--) {
    if ((ha[i].c > ha[i].o) === lastGreen) streak++;
    else break;
  }
  return lastGreen ? streak : -streak;
}

function calcPOC(klines: Kline[]): number | null {
  if (klines.length === 0) return null;
  let lo = Infinity, hi = -Infinity;
  for (const k of klines) { if (k.l < lo) lo = k.l; if (k.h > hi) hi = k.h; }
  if (hi === lo) return hi;
  const bins = 30;
  const binSize = (hi - lo) / bins;
  const vols = new Float64Array(bins);
  for (const k of klines) {
    const tp = (k.h + k.l + k.c) / 3;
    vols[Math.min(Math.floor((tp - lo) / binSize), bins - 1)] += k.v;
  }
  let maxI = 0;
  for (let i = 1; i < bins; i++) if (vols[i] > vols[maxI]) maxI = i;
  return lo + (maxI + 0.5) * binSize;
}

function calcBiasScore(d: {
  obi: number; cvd: number; rsi: number | null; macdH: number | null;
  ema5: number | null; ema20: number | null; vwap: number | null;
  haStreak: number; poc: number | null; bidWalls: number; askWalls: number; mid: number;
}): number {
  const MAX = 56;
  let sum = 0;
  if (d.ema5 !== null && d.ema20 !== null) sum += d.ema5 > d.ema20 ? 10 : -10;
  sum += d.obi * 8;
  if (d.macdH !== null) sum += d.macdH > 0 ? 8 : -8;
  sum += d.cvd > 0 ? 7 : d.cvd < 0 ? -7 : 0;
  sum += Math.max(-6, Math.min(6, d.haStreak * 2));
  if (d.vwap !== null) sum += d.mid > d.vwap ? 5 : -5;
  if (d.rsi !== null) sum += ((50 - d.rsi) / 50) * 5;
  sum += Math.max(-4, Math.min(4, (d.bidWalls - d.askWalls) * 2));
  if (d.poc !== null) sum += d.mid > d.poc ? 3 : -3;
  return Math.max(-100, Math.min(100, (sum / MAX) * 100));
}

// --- Shutdown ---

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[indicator-collector] Shutting down...");
  if (obTimer) clearInterval(obTimer);
  if (ws) ws.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("[indicator-collector] Fatal:", err);
  process.exit(1);
});
