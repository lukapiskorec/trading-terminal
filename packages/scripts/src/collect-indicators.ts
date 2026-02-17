/**
 * BTC Indicator Collector — runs as a long-lived Node.js process.
 *
 * Connects to Binance combined WebSocket stream:
 *   - btcusdt@trade        (individual trades → CVD)
 *   - btcusdt@kline_1m     (1-min candles → RSI, MACD, EMA, VWAP, HA, POC)
 *   - btcusdt@depth20@100ms (top-20 orderbook every 100ms → OBI, Walls, mid price)
 *
 * Every 1 second, computes all 12 indicators + composite bias and upserts to
 * Supabase `btc_indicator_snapshots`.
 *
 * Run:  pnpm collectind
 * Env:  SUPABASE_URL, SUPABASE_SECRET_KEY
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

const COMBINED_STREAM =
  "wss://stream.binance.com/stream?streams=btcusdt@trade/btcusdt@kline_1m/btcusdt@depth20@100ms";
const KLINES_BOOTSTRAP =
  "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=100";

const SNAPSHOT_INTERVAL_MS = 1_000;
const TRADE_BUFFER_SEC = 600;
const TRADE_BUFFER_MAX = 5_000;
const KLINE_BUFFER_MAX = 150;
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 60_000;

// --- State ---

let mid: number | null = null;
let bids: OBLevel[] = [];
let asks: OBLevel[] = [];
const trades: Trade[] = [];
let klines: Kline[] = [];

let ws: WebSocket | null = null;
let shuttingDown = false;
let reconnectAttempts = 0;
let snapshotCount = 0;
let errorCount = 0;
let lastSnapshotAt: Date | null = null;

// --- Main ---

async function main() {
  log("Starting indicator collector...");

  await bootstrapKlines();
  connectWs();
  startSnapshotLoop();
  startHeartbeat();

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// --- Bootstrap ---

async function bootstrapKlines() {
  try {
    const res = await fetch(KLINES_BOOTSTRAP);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw: any[][] = await res.json();
    klines = raw.map((k) => ({
      t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5],
    }));
    log(`Bootstrapped ${klines.length} klines`);
  } catch (err: any) {
    log(`Kline bootstrap failed: ${err.message} — will populate from WS`);
  }
}

// --- WebSocket ---

function connectWs() {
  if (shuttingDown) return;

  log("Connecting to Binance combined stream...");
  ws = new WebSocket(COMBINED_STREAM);

  ws.on("open", () => {
    reconnectAttempts = 0;
    log("WS connected (trade + kline + depth20@100ms)");
  });

  ws.on("message", (raw: Buffer) => {
    try {
      const wrapper = JSON.parse(raw.toString());
      const { stream, data } = wrapper;
      if (!stream || !data) return;

      if (stream === "btcusdt@trade") {
        handleTrade(data);
      } else if (stream === "btcusdt@kline_1m") {
        handleKline(data);
      } else if (stream === "btcusdt@depth20@100ms") {
        handleDepth(data);
      }
    } catch { /* non-JSON frame */ }
  });

  ws.on("close", () => {
    if (shuttingDown) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempts, RECONNECT_MAX_MS);
    reconnectAttempts++;
    log(`WS closed — reconnecting in ${(delay / 1000).toFixed(0)}s (attempt ${reconnectAttempts})`);
    setTimeout(connectWs, delay);
  });

  ws.on("error", (err) => {
    log(`WS error: ${err.message}`);
  });
}

function handleTrade(data: any) {
  trades.push({
    time: data.T, price: +data.p, qty: +data.q, isBuy: !data.m,
  });
  // Prune
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

function handleDepth(data: any) {
  // depth20@100ms pushes full top-20 snapshot each time
  bids = (data.bids as string[][]).map(([p, q]) => [+p, +q] as OBLevel);
  asks = (data.asks as string[][]).map(([p, q]) => [+p, +q] as OBLevel);
  if (bids.length > 0 && asks.length > 0) {
    mid = (bids[0][0] + asks[0][0]) / 2;
  }
}

// --- Snapshot loop ---

function startSnapshotLoop() {
  setInterval(async () => {
    if (mid === null || klines.length === 0) return;

    const snapshot = computeSnapshot();
    if (!snapshot) return;

    const { error } = await supabase
      .from("btc_indicator_snapshots")
      .upsert(snapshot, { onConflict: "recorded_at" });

    if (error) {
      errorCount++;
      log(`Upsert error: ${error.message}`);
    } else {
      snapshotCount++;
      lastSnapshotAt = new Date();
    }
  }, SNAPSHOT_INTERVAL_MS);
}

function computeSnapshot() {
  if (mid === null) return null;

  const now = new Date();
  now.setMilliseconds(0); // round to nearest second

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

  // RSI
  const rsi = calcRSI(klines, 14);

  // MACD histogram
  const macdH = calcMACDHistogram(klines);

  // EMA5 / EMA20
  const closes = klines.map((k) => k.c);
  const ema5arr = calcEMA(closes, 5);
  const ema20arr = calcEMA(closes, 20);
  const ema5 = ema5arr.length > 0 ? ema5arr[ema5arr.length - 1] : null;
  const ema20 = ema20arr.length > 0 ? ema20arr[ema20arr.length - 1] : null;

  // VWAP
  let cumPV = 0, cumV = 0;
  for (const k of klines) {
    const tp = (k.h + k.l + k.c) / 3;
    cumPV += tp * k.v;
    cumV += k.v;
  }
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

  // Bollinger Bands %B
  const bbandsB = calcBBands(klines, mid);

  // Flow Toxicity
  const flowToxicity = calcFlowToxicity(trades, 300);

  // ROC
  const roc = calcROC(klines, 10);

  // Bias
  const biasScore = calcBiasScore({
    obi, cvd, rsi, macdH, ema5, ema20, vwap, haStreak, poc,
    bidWalls, askWalls, mid, bbandsB, flowToxicity, roc,
  });
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
    bbands_pct_b: bbandsB,
    flow_toxicity: flowToxicity,
    roc,
    bias_score: biasScore,
    bias_signal: biasSignal,
  };
}

// --- Indicator math (duplicated from web to avoid cross-package dep) ---

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
  const closes = klines.slice(-(period + 1)).map((k) => k.c);
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
  const closes = klines.map((k) => k.c);
  const fast = calcEMA(closes, 12);
  const slow = calcEMA(closes, 26);
  const len = Math.min(fast.length, slow.length);
  const macdLine: number[] = [];
  for (let i = 0; i < len; i++) {
    macdLine.push(fast[fast.length - len + i] - slow[slow.length - len + i]);
  }
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

function calcBBands(klines: Kline[], currentMid: number, period = 20, k = 2): number | null {
  if (klines.length < period) return null;
  const closes = klines.slice(-period).map((c) => c.c);
  let sum = 0;
  for (const c of closes) sum += c;
  const sma = sum / period;
  let sqSum = 0;
  for (const c of closes) sqSum += (c - sma) ** 2;
  const std = Math.sqrt(sqSum / period);
  const upper = sma + k * std;
  const lower = sma - k * std;
  const bw = upper - lower;
  return bw > 0 ? (currentMid - lower) / bw : 0.5;
}

function calcFlowToxicity(trades: Trade[], windowSec: number): number {
  const cutoff = Date.now() - windowSec * 1000;
  let buyVol = 0, sellVol = 0;
  for (const t of trades) {
    if (t.time >= cutoff) {
      if (t.isBuy) buyVol += t.qty; else sellVol += t.qty;
    }
  }
  const total = buyVol + sellVol;
  if (total === 0) return 0;
  const toxicity = Math.abs(buyVol - sellVol) / total;
  return buyVol > sellVol ? toxicity : -toxicity;
}

function calcROC(klines: Kline[], period: number): number | null {
  if (klines.length < period + 1) return null;
  const current = klines[klines.length - 1].c;
  const past = klines[klines.length - 1 - period].c;
  if (past === 0) return null;
  return ((current - past) / past) * 100;
}

function calcBiasScore(d: {
  obi: number; cvd: number; rsi: number | null; macdH: number | null;
  ema5: number | null; ema20: number | null; vwap: number | null;
  haStreak: number; poc: number | null; bidWalls: number; askWalls: number; mid: number;
  bbandsB: number | null; flowToxicity: number; roc: number | null;
}): number {
  const MAX = 71;
  let sum = 0;
  if (d.ema5 !== null && d.ema20 !== null) sum += d.ema5 > d.ema20 ? 10 : -10;
  sum += d.obi * 8;
  if (d.macdH !== null) sum += d.macdH > 0 ? 8 : -8;
  sum += d.cvd > 0 ? 7 : d.cvd < 0 ? -7 : 0;
  sum += Math.max(-6, Math.min(6, d.haStreak * 2));
  sum += Math.max(-6, Math.min(6, d.flowToxicity * 6));
  if (d.vwap !== null) sum += d.mid > d.vwap ? 5 : -5;
  if (d.rsi !== null) sum += ((50 - d.rsi) / 50) * 5;
  if (d.bbandsB !== null) sum += ((0.5 - d.bbandsB) / 0.5) * 5;
  sum += Math.max(-4, Math.min(4, (d.bidWalls - d.askWalls) * 2));
  if (d.roc !== null) sum += d.roc > 0.1 ? 4 : d.roc < -0.1 ? -4 : 0;
  if (d.poc !== null) sum += d.mid > d.poc ? 3 : -3;
  return Math.max(-100, Math.min(100, (sum / MAX) * 100));
}

// --- Heartbeat ---

function startHeartbeat() {
  setInterval(() => {
    const midStr = mid !== null ? `$${mid.toFixed(2)}` : "waiting";
    log(
      `Heartbeat — mid: ${midStr} | ` +
      `snapshots: ${snapshotCount} | errors: ${errorCount} | ` +
      `trades buffered: ${trades.length} | klines: ${klines.length} | ` +
      `last: ${lastSnapshotAt?.toISOString() ?? "none"}`,
    );
  }, HEARTBEAT_INTERVAL_MS);
}

// --- Logging ---

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

// --- Shutdown ---

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`Shutting down — ${snapshotCount} snapshots written, ${errorCount} errors`);
  if (ws) ws.close();
  setTimeout(() => process.exit(0), 500);
}

main().catch((err) => {
  console.error("[indicator-collector] Fatal:", err);
  process.exit(1);
});
