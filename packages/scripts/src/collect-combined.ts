/**
 * Combined data collector — single long-running process that handles both:
 *
 *   1. BTC Indicators (Binance)
 *      Persistent WebSocket → depth20@100ms + trades + kline_1m
 *      Computes all 12 indicators + bias score every second
 *      Upserts to `btc_indicator_snapshots`
 *
 *   2. PolyBackTest Sync
 *      Fetches the last 100 resolved BTC 5-min markets from polybacktest.com
 *      Upserts market rows + downsampled price snapshots to `markets` / `price_snapshots`
 *      Runs once on startup, then every 7 hours automatically
 *
 * Run:  pnpm collect:combined   (or: tsx src/collect-combined.ts)
 *
 * Env (packages/scripts/.env):
 *   SUPABASE_URL=https://your-project.supabase.co
 *   SUPABASE_SECRET_KEY=your-service-role-key
 *   POLYBACKTEST_API_KEY=your-pbt-key
 */

import "dotenv/config";
import { WebSocket } from "ws";
import { supabase } from "./utils/supabase.js";

// ============================================================================
// Shared helpers
// ============================================================================

function log(tag: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${tag}] ${msg}`);
}

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ============================================================================
// SECTION 1 — BTC Indicator Collector (Binance)
// ============================================================================

interface Kline { t: number; o: number; h: number; l: number; c: number; v: number; }
interface Trade { time: number; price: number; qty: number; isBuy: boolean; }
type OBLevel = [number, number];

const BINANCE_STREAM =
  "wss://stream.binance.com/stream?streams=btcusdt@trade/btcusdt@kline_1m/btcusdt@depth20@100ms";
const BINANCE_KLINES_BOOTSTRAP =
  "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=100";

const IND_SNAPSHOT_MS   = 1_000;
const TRADE_BUFFER_SEC  = 600;
const TRADE_BUFFER_MAX  = 5_000;
const KLINE_BUFFER_MAX  = 150;
const BINANCE_RECONNECT_BASE = 2_000;
const BINANCE_RECONNECT_MAX  = 30_000;
const HEARTBEAT_MS      = 60_000;

let mid: number | null = null;
let bids: OBLevel[] = [];
let asks: OBLevel[] = [];
const trades: Trade[] = [];
let klines: Kline[] = [];

let binanceWs: WebSocket | null = null;
let binanceReconnectAttempts = 0;
let indSnapshotCount = 0;
let indErrorCount = 0;
let lastSnapshotAt: Date | null = null;

async function bootstrapKlines() {
  try {
    const res = await fetch(BINANCE_KLINES_BOOTSTRAP);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw: any[][] = await res.json();
    klines = raw.map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
    log("ind", `Bootstrapped ${klines.length} klines from Binance REST`);
  } catch (err: any) {
    log("ind", `Kline bootstrap failed: ${err.message} — will populate from WS`);
  }
}

function connectBinance() {
  if (shuttingDown) return;
  log("ind", "Connecting to Binance combined stream...");
  binanceWs = new WebSocket(BINANCE_STREAM);

  binanceWs.on("open", () => {
    binanceReconnectAttempts = 0;
    log("ind", "Binance WS connected (trade + kline + depth20@100ms)");
  });

  binanceWs.on("message", (raw: Buffer) => {
    try {
      const { stream, data } = JSON.parse(raw.toString());
      if (!stream || !data) return;
      if (stream === "btcusdt@trade")          handleTrade(data);
      else if (stream === "btcusdt@kline_1m")  handleKline(data);
      else if (stream === "btcusdt@depth20@100ms") handleDepth(data);
    } catch { /* non-JSON frame */ }
  });

  binanceWs.on("close", () => {
    if (shuttingDown) return;
    const ms = Math.min(BINANCE_RECONNECT_BASE * 2 ** binanceReconnectAttempts, BINANCE_RECONNECT_MAX);
    binanceReconnectAttempts++;
    log("ind", `Binance WS closed — reconnecting in ${(ms / 1000).toFixed(0)}s (attempt ${binanceReconnectAttempts})`);
    setTimeout(connectBinance, ms);
  });

  binanceWs.on("error", (err) => log("ind", `Binance WS error: ${err.message}`));
}

function handleTrade(data: any) {
  trades.push({ time: data.T, price: +data.p, qty: +data.q, isBuy: !data.m });
  const cutoff = Date.now() - TRADE_BUFFER_SEC * 1000;
  while (trades.length > 0 && trades[0].time < cutoff) trades.shift();
  if (trades.length > TRADE_BUFFER_MAX) trades.splice(0, trades.length - TRADE_BUFFER_MAX);
}

function handleKline(data: any) {
  const k = data.k;
  if (!k) return;
  const kline: Kline = { t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v };
  const last = klines[klines.length - 1];
  if (last && last.t === kline.t) klines[klines.length - 1] = kline;
  else klines.push(kline);
  if (klines.length > KLINE_BUFFER_MAX) klines.splice(0, klines.length - KLINE_BUFFER_MAX);
}

function handleDepth(data: any) {
  bids = (data.bids as string[][]).map(([p, q]) => [+p, +q] as OBLevel);
  asks = (data.asks as string[][]).map(([p, q]) => [+p, +q] as OBLevel);
  if (bids.length > 0 && asks.length > 0) mid = (bids[0][0] + asks[0][0]) / 2;
}

function startIndicatorLoop() {
  setInterval(async () => {
    if (mid === null || klines.length === 0) return;
    const snapshot = computeSnapshot();
    if (!snapshot) return;
    const { error } = await supabase
      .from("btc_indicator_snapshots")
      .upsert(snapshot, { onConflict: "recorded_at" });
    if (error) { indErrorCount++; log("ind", `Upsert error: ${error.message}`); }
    else { indSnapshotCount++; lastSnapshotAt = new Date(); }
  }, IND_SNAPSHOT_MS);
}

function computeSnapshot() {
  if (mid === null) return null;
  const now = new Date();
  now.setMilliseconds(0);

  const obiBand = mid * 0.01;
  let bidVol = 0, askVol = 0;
  for (const [p, q] of bids) if (p >= mid - obiBand) bidVol += q;
  for (const [p, q] of asks) if (p <= mid + obiBand) askVol += q;
  const obiTotal = bidVol + askVol;
  const obi = obiTotal > 0 ? (bidVol - askVol) / obiTotal : 0;

  const cvdCutoff = Date.now() - 300_000;
  let cvd = 0;
  for (const t of trades) if (t.time >= cvdCutoff) cvd += t.isBuy ? t.qty : -t.qty;

  const rsi = calcRSI(klines, 14);
  const macdH = calcMACDHistogram(klines);
  const closes = klines.map((k) => k.c);
  const ema5arr = calcEMA(closes, 5);
  const ema20arr = calcEMA(closes, 20);
  const ema5 = ema5arr.length > 0 ? ema5arr[ema5arr.length - 1] : null;
  const ema20 = ema20arr.length > 0 ? ema20arr[ema20arr.length - 1] : null;

  let cumPV = 0, cumV = 0;
  for (const k of klines) { const tp = (k.h + k.l + k.c) / 3; cumPV += tp * k.v; cumV += k.v; }
  const vwap = cumV > 0 ? cumPV / cumV : null;

  const haStreak = calcHAStreak(klines);
  const poc = calcPOC(klines);

  const allQtys = [...bids, ...asks].map(([, q]) => q).sort((a, b) => a - b);
  const median = allQtys.length > 0 ? allQtys[Math.floor(allQtys.length / 2)] : 0;
  const wallThreshold = median * 5;
  let bidWalls = 0, askWalls = 0;
  for (const [, q] of bids) if (q >= wallThreshold) bidWalls++;
  for (const [, q] of asks) if (q >= wallThreshold) askWalls++;

  const bbandsB = calcBBands(klines, mid);
  const flowToxicity = calcFlowToxicity(trades, 300);
  const roc = calcROC(klines, 10);

  const biasScore = calcBiasScore({
    obi, cvd, rsi, macdH, ema5, ema20, vwap, haStreak, poc,
    bidWalls, askWalls, mid, bbandsB, flowToxicity, roc,
  });
  const biasSignal = biasScore > 10 ? "BULLISH" : biasScore < -10 ? "BEARISH" : "NEUTRAL";

  return {
    recorded_at: now.toISOString(), btc_mid: mid, obi, cvd_5m: cvd, rsi,
    macd_histogram: macdH, ema5, ema20, vwap, ha_streak: haStreak, poc,
    bid_walls: bidWalls, ask_walls: askWalls, bbands_pct_b: bbandsB,
    flow_toxicity: flowToxicity, roc, bias_score: biasScore, bias_signal: biasSignal,
  };
}

// --- Indicator math ---

function calcEMA(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  result.push(sum / period);
  for (let i = period; i < values.length; i++)
    result.push(values[i] * k + result[result.length - 1] * (1 - k));
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
  for (let i = 0; i < len; i++)
    macdLine.push(fast[fast.length - len + i] - slow[slow.length - len + i]);
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
    if (t.time >= cutoff) { if (t.isBuy) buyVol += t.qty; else sellVol += t.qty; }
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

function startHeartbeat() {
  setInterval(() => {
    const midStr = mid !== null ? `$${mid.toFixed(2)}` : "waiting";
    log("ind",
      `Heartbeat — mid: ${midStr} | snapshots: ${indSnapshotCount} | ` +
      `errors: ${indErrorCount} | trades: ${trades.length} | klines: ${klines.length} | ` +
      `last: ${lastSnapshotAt?.toISOString() ?? "none"}`,
    );
  }, HEARTBEAT_MS);
}

// ============================================================================
// SECTION 2 — PolyBackTest Sync (scheduled every 7 hours)
// ============================================================================

const PBT_BASE = "https://api.polybacktest.com";
const PBT_KEY = process.env.POLYBACKTEST_API_KEY;
const PBT_HEADERS = { "X-API-Key": PBT_KEY ?? "", Accept: "application/json" };
const PBT_PAGE_SIZE = 1000;
const PBT_API_DELAY_MS = 150;
const PBT_SYNC_INTERVAL_MS = 7 * 60 * 60 * 1000; // 7 hours

interface PbtMarket {
  market_id: string; slug: string; market_type: string;
  start_time: string; end_time: string; btc_price_start: number | string;
  condition_id: string; clob_token_up: string; clob_token_down: string;
  winner: string | null; final_volume: number | null; resolved_at: string | null;
}
interface PbtSnapshot {
  id: number; time: string; market_id: string;
  btc_price: string; price_up: string; price_down: string;
}

async function pbtFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${PBT_BASE}${path}`, { headers: PBT_HEADERS });
  if (!res.ok) throw new Error(`PBT ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

function downsampleTo1s(snapshots: PbtSnapshot[], startIso: string, endIso: string) {
  if (snapshots.length === 0) return [];
  const startSec = Math.floor(new Date(startIso).getTime() / 1000);
  const endSec   = Math.floor(new Date(endIso).getTime()   / 1000);
  const parsed = snapshots.map((s) => ({ ...s, epochMs: new Date(s.time).getTime() }));
  const result: { epochSec: number; snap: (typeof parsed)[0] }[] = [];
  let cursor = 0;
  for (let sec = startSec; sec <= endSec; sec++) {
    const targetMs = sec * 1000;
    while (
      cursor < parsed.length - 1 &&
      Math.abs(parsed[cursor + 1].epochMs - targetMs) <= Math.abs(parsed[cursor].epochMs - targetMs)
    ) cursor++;
    if (Math.abs(parsed[cursor].epochMs - targetMs) <= 2000)
      result.push({ epochSec: sec, snap: parsed[cursor] });
  }
  return result;
}

async function runPbtSync() {
  log("pbt", "=== PolyBackTest sync starting ===");

  if (!PBT_KEY) {
    log("pbt", "POLYBACKTEST_API_KEY not set — skipping sync");
    return;
  }

  let synced = 0, skipped = 0, failed = 0;

  try {
    const { markets: pbtMarkets } = await pbtFetch<{ markets: PbtMarket[]; total: number }>(
      "/v1/markets?market_type=5m&limit=100",
    );
    const resolved = pbtMarkets.filter((m) => m.winner !== null);
    log("pbt", `Fetched ${pbtMarkets.length} markets, ${resolved.length} resolved`);

    if (resolved.length === 0) { log("pbt", "Nothing to sync."); return; }

    const slugs = resolved.map((m) => m.slug);
    const { data: existingMarkets } = await supabase
      .from("markets").select("id, slug").in("slug", slugs);

    const existingSlugToId = new Map<string, number>();
    for (const m of existingMarkets ?? []) existingSlugToId.set(m.slug, m.id);

    const existingIds = [...existingSlugToId.values()];
    const marketsWithPbtData = new Set<number>();
    if (existingIds.length > 0) {
      const { data: pbtSnapRows } = await supabase
        .from("price_snapshots").select("market_id")
        .in("market_id", existingIds).eq("source", "polybacktest").limit(1000);
      for (const row of pbtSnapRows ?? []) marketsWithPbtData.add(row.market_id);
    }

    for (let i = 0; i < resolved.length; i++) {
      const pbt = resolved[i];
      const label = `[${i + 1}/${resolved.length}]`;

      const existingId = existingSlugToId.get(pbt.slug);
      if (existingId && marketsWithPbtData.has(existingId)) {
        skipped++;
        if (skipped <= 3) log("pbt", `${label} SKIP ${pbt.slug} (already synced)`);
        else if (skipped === 4) log("pbt", "... suppressing further skip messages");
        continue;
      }

      let allSnapshots: PbtSnapshot[] = [];
      let offset = 0, total = Infinity;
      try {
        while (offset < total) {
          const page = await pbtFetch<{
            market: PbtMarket; snapshots: PbtSnapshot[];
            total: number; limit: number; offset: number;
          }>(`/v1/markets/${pbt.market_id}/snapshots?include_orderbook=false&limit=${PBT_PAGE_SIZE}&offset=${offset}`);
          total = page.total;
          allSnapshots = allSnapshots.concat(page.snapshots);
          offset += page.snapshots.length;
          if (page.snapshots.length === 0) break;
          await delay(PBT_API_DELAY_MS);
        }
      } catch (err: any) {
        log("pbt", `${label} FAIL ${pbt.slug} — snapshot fetch: ${err.message}`);
        failed++;
        await delay(PBT_API_DELAY_MS);
        continue;
      }

      const sampled = downsampleTo1s(allSnapshots, pbt.start_time, pbt.end_time);
      const outcome = pbt.winner === "Up" ? "Up" : pbt.winner === "Down" ? "Down" : null;
      const yesPrice = outcome === "Up" ? 1.0 : outcome === "Down" ? 0.0 : null;

      let marketId: number;
      if (existingId) {
        await supabase.from("markets")
          .update({ outcome, outcome_yes_price: yesPrice, volume: pbt.final_volume })
          .eq("id", existingId);
        marketId = existingId;
      } else {
        const { data: row, error: insertErr } = await supabase.from("markets").insert({
          slug: pbt.slug,
          condition_id: pbt.condition_id,
          token_id_yes: pbt.clob_token_up,
          token_id_no: pbt.clob_token_down,
          question: `Bitcoin Up or Down - ${new Date(pbt.start_time).toUTCString()}`,
          start_time: pbt.start_time,
          end_time: pbt.end_time,
          outcome, outcome_yes_price: yesPrice, volume: pbt.final_volume,
        }).select("id").single();
        if (insertErr || !row) {
          log("pbt", `${label} FAIL ${pbt.slug} — DB insert: ${insertErr?.message}`);
          failed++;
          continue;
        }
        marketId = row.id;
      }

      if (sampled.length > 0) {
        const snapRows = sampled.map((s) => ({
          market_id: marketId,
          recorded_at: new Date(s.epochSec * 1000).toISOString(),
          mid_price_yes: parseFloat(s.snap.price_up),
          best_bid_yes: null, best_ask_yes: null,
          last_trade_price: parseFloat(s.snap.price_up),
          source: "polybacktest",
        }));
        for (let b = 0; b < snapRows.length; b += 500) {
          const { error: snapErr } = await supabase
            .from("price_snapshots").insert(snapRows.slice(b, b + 500));
          if (snapErr) log("pbt", `${label} WARN snapshot batch: ${snapErr.message}`);
        }
      }

      synced++;
      log("pbt", `${label} OK ${pbt.slug} → ${outcome} (${allSnapshots.length} raw → ${sampled.length} @1s)`);
      await delay(PBT_API_DELAY_MS);
    }
  } catch (err: any) {
    log("pbt", `Sync failed: ${err.message}`);
  }

  log("pbt", `=== Sync done — synced: ${synced}  skipped: ${skipped}  failed: ${failed} ===`);
}

function schedulePbtSync() {
  // Run immediately on startup, then every 7 hours
  runPbtSync();
  setInterval(runPbtSync, PBT_SYNC_INTERVAL_MS);
  log("pbt", `Scheduled — will sync every ${PBT_SYNC_INTERVAL_MS / 3_600_000}h`);
}

// ============================================================================
// Main + shutdown
// ============================================================================

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log("main", `Shutting down — ${indSnapshotCount} indicator snapshots written, ${indErrorCount} errors`);
  if (binanceWs) binanceWs.close();
  setTimeout(() => process.exit(0), 500);
}

async function main() {
  log("main", "=== Combined collector starting ===");

  if (!PBT_KEY) {
    log("main", "WARN: POLYBACKTEST_API_KEY not set — PBT sync will be skipped");
  }

  // Start Binance indicator collector
  await bootstrapKlines();
  connectBinance();
  startIndicatorLoop();
  startHeartbeat();

  // Schedule PolyBackTest sync (runs immediately, then every 7h)
  schedulePbtSync();

  process.on("SIGINT",  shutdown);
  process.on("SIGTERM", shutdown);

  log("main", "All collectors running. Ctrl+C to stop.");
}

main().catch((err) => {
  console.error("[combined] Fatal:", err);
  process.exit(1);
});
