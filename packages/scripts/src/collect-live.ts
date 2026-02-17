/**
 * Live WebSocket data collector — runs as a long-lived Node.js process.
 *
 * Connects to Polymarket's CLOB WebSocket, subscribes to the current
 * BTC 5-min market, and snapshots prices into Supabase every 5 seconds.
 *
 * Run: pnpm --filter scripts collect
 *
 * Requires env vars: SUPABASE_URL, SUPABASE_SECRET_KEY
 * Optional: GAMMA_API=https://gamma-api.polymarket.com (default)
 */

import "dotenv/config";
import { WebSocket } from "ws";
import { supabase } from "./utils/supabase.js";
import { getEventBySlug, delay } from "./utils/polymarket.js";

const WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
const MARKET_DURATION = 300; // 5 minutes in seconds
const SNAPSHOT_INTERVAL = 5_000; // 5 seconds → 60 snapshots per 5-min market
const PING_INTERVAL = 10_000; // required by Polymarket
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

// --- State ---

let ws: WebSocket | null = null;
let currentSlug: string | null = null;
let currentMarketDbId: number | null = null;
let currentTokenIdYes: string | null = null;
let currentTokenIdNo: string | null = null;

/** Latest prices from WebSocket messages */
let latestPrice: {
  midYes: number | null;
  bestBidYes: number | null;
  bestAskYes: number | null;
  lastTradePrice: number | null;
} = { midYes: null, bestBidYes: null, bestAskYes: null, lastTradePrice: null };

let snapshotTimer: ReturnType<typeof setInterval> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let marketCheckTimer: ReturnType<typeof setInterval> | null = null;
let reconnectAttempts = 0;
let shuttingDown = false;

// --- Helpers ---

/** Get the current BTC 5-min market slug based on current time */
function currentMarketSlug(): string {
  const nowSec = Math.floor(Date.now() / 1000);
  // Markets start at multiples of 300 seconds from epoch
  const marketStart = nowSec - (nowSec % MARKET_DURATION);
  return `btc-updown-5m-${marketStart}`;
}

/** Get the next market's start timestamp */
function nextMarketStartMs(): number {
  const nowSec = Math.floor(Date.now() / 1000);
  const currentStart = nowSec - (nowSec % MARKET_DURATION);
  return (currentStart + MARKET_DURATION) * 1000;
}

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

// --- Supabase operations ---

/** Ensure market row exists in DB, return its id */
async function ensureMarketInDb(slug: string): Promise<number | null> {
  // Check if exists
  const { data: existing } = await supabase
    .from("markets")
    .select("id")
    .eq("slug", slug)
    .limit(1);

  if (existing && existing.length > 0) {
    return existing[0].id;
  }

  // Fetch from Gamma API
  const event = await getEventBySlug(slug);
  if (!event || event.markets.length === 0) {
    log(`WARN: Market ${slug} not found on Gamma API`);
    return null;
  }

  const market = event.markets[0];
  const tokenIds: string[] = JSON.parse(market.clobTokenIds);
  const tsMatch = slug.match(/(\d+)$/);
  const ts = tsMatch ? parseInt(tsMatch[1]) : 0;

  const { data: row, error } = await supabase
    .from("markets")
    .insert({
      slug,
      condition_id: market.conditionId,
      token_id_yes: tokenIds[0],
      token_id_no: tokenIds[1],
      question: market.question,
      start_time: new Date(ts * 1000).toISOString(),
      end_time: new Date((ts + MARKET_DURATION) * 1000).toISOString(),
      outcome: null,
      outcome_yes_price: null,
      volume: market.volumeNum ?? parseFloat(market.volume) ?? null,
    })
    .select("id")
    .single();

  if (error) {
    log(`ERROR inserting market: ${error.message}`);
    return null;
  }

  return row?.id ?? null;
}

/** Write a price snapshot to Supabase */
async function writeSnapshot() {
  if (!currentMarketDbId) return;
  if (latestPrice.midYes === null && latestPrice.lastTradePrice === null) return;

  const { error } = await supabase.from("price_snapshots").insert({
    market_id: currentMarketDbId,
    recorded_at: new Date().toISOString(),
    mid_price_yes: latestPrice.midYes,
    best_bid_yes: latestPrice.bestBidYes,
    best_ask_yes: latestPrice.bestAskYes,
    last_trade_price: latestPrice.lastTradePrice,
    source: "ws",
  });

  if (error) {
    log(`ERROR writing snapshot: ${error.message}`);
  }
}

/** Update market outcome when it resolves */
async function updateMarketOutcome(slug: string, outcome: "Up" | "Down") {
  const yesPrice = outcome === "Up" ? 1.0 : 0.0;
  const { error } = await supabase
    .from("markets")
    .update({ outcome, outcome_yes_price: yesPrice })
    .eq("slug", slug);

  if (error) {
    log(`ERROR updating outcome for ${slug}: ${error.message}`);
  } else {
    log(`Market ${slug} resolved: ${outcome}`);
  }
}

// --- WebSocket ---

function connect() {
  if (shuttingDown) return;

  log("Connecting to WebSocket...");
  ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    log("WebSocket connected");
    reconnectAttempts = 0;
    startPingTimer();
    subscribeToCurrentMarket();
  });

  ws.on("message", (data: Buffer) => {
    try {
      const messages = JSON.parse(data.toString());
      // Polymarket sends arrays of messages
      const msgArray = Array.isArray(messages) ? messages : [messages];

      for (const msg of msgArray) {
        handleMessage(msg);
      }
    } catch {
      // Non-JSON message (pong, etc.)
    }
  });

  ws.on("close", (code, reason) => {
    log(`WebSocket closed: ${code} ${reason.toString()}`);
    stopTimers();
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    log(`WebSocket error: ${err.message}`);
  });
}

function handleMessage(msg: any) {
  if (!msg || typeof msg !== "object") return;

  const event = msg.event_type ?? msg.type;

  switch (event) {
    case "price_change": {
      // msg.price is YES token price
      const price = parseFloat(msg.price);
      if (!isNaN(price)) {
        latestPrice.midYes = price;
      }
      break;
    }
    case "last_trade_price": {
      const price = parseFloat(msg.price);
      if (!isNaN(price)) {
        latestPrice.lastTradePrice = price;
      }
      break;
    }
    case "book": {
      // Order book update — extract best bid/ask
      if (msg.bids && msg.bids.length > 0) {
        latestPrice.bestBidYes = parseFloat(msg.bids[0].price);
      }
      if (msg.asks && msg.asks.length > 0) {
        latestPrice.bestAskYes = parseFloat(msg.asks[0].price);
      }
      break;
    }
  }
}

function subscribe(assetIds: string[]) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    auth: {},
    assets_ids: assetIds,
    type: "market",
  }));
}

function unsubscribe(assetIds: string[]) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    assets_ids: assetIds,
    type: "unsubscribe",
  }));
}

async function subscribeToCurrentMarket() {
  const slug = currentMarketSlug();

  if (slug === currentSlug) return; // already subscribed

  // Unsubscribe from old market
  if (currentTokenIdYes && currentTokenIdNo) {
    unsubscribe([currentTokenIdYes, currentTokenIdNo]);

    // Write final snapshot for old market
    await writeSnapshot();

    // Check if old market resolved
    if (currentSlug) {
      await checkAndUpdateOutcome(currentSlug);
    }
  }

  log(`Switching to market: ${slug}`);

  // Reset price state
  latestPrice = { midYes: null, bestBidYes: null, bestAskYes: null, lastTradePrice: null };

  // Ensure market exists in DB
  const dbId = await ensureMarketInDb(slug);
  if (!dbId) {
    log(`WARN: Could not ensure market ${slug} in DB, will retry next cycle`);
    currentSlug = null;
    currentMarketDbId = null;
    currentTokenIdYes = null;
    currentTokenIdNo = null;
    return;
  }

  // Fetch token IDs from DB
  const { data: marketRow } = await supabase
    .from("markets")
    .select("token_id_yes, token_id_no")
    .eq("id", dbId)
    .single();

  if (!marketRow || !marketRow.token_id_yes || !marketRow.token_id_no) {
    log(`WARN: Market ${slug} missing token IDs in DB`);
    return;
  }

  const yesId = marketRow.token_id_yes as string;
  const noId = marketRow.token_id_no as string;

  currentSlug = slug;
  currentMarketDbId = dbId;
  currentTokenIdYes = yesId;
  currentTokenIdNo = noId;

  // Subscribe
  subscribe([yesId, noId]);
  log(`Subscribed to ${slug} (YES: ${yesId.slice(0, 8)}...)`);

  // Start snapshot timer
  startSnapshotTimer();
}

async function checkAndUpdateOutcome(slug: string) {
  try {
    const event = await getEventBySlug(slug);
    if (!event || event.markets.length === 0) return;

    const market = event.markets[0];
    const outcomes: string[] = JSON.parse(market.outcomes);
    const prices: string[] = JSON.parse(market.outcomePrices);
    const upIdx = outcomes.indexOf("Up");
    if (upIdx === -1) return;

    const upPrice = parseFloat(prices[upIdx]);
    if (upPrice === 1) {
      await updateMarketOutcome(slug, "Up");
    } else if (upPrice === 0) {
      await updateMarketOutcome(slug, "Down");
    }
  } catch (err: any) {
    log(`WARN: Could not check outcome for ${slug}: ${err.message}`);
  }
}

// --- Timers ---

function startSnapshotTimer() {
  if (snapshotTimer) clearInterval(snapshotTimer);
  snapshotTimer = setInterval(async () => {
    await writeSnapshot();
  }, SNAPSHOT_INTERVAL);
}

function startPingTimer() {
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, PING_INTERVAL);
}

function startMarketCheckTimer() {
  if (marketCheckTimer) clearInterval(marketCheckTimer);
  // Check every 5 seconds if we need to switch markets
  marketCheckTimer = setInterval(() => {
    const expected = currentMarketSlug();
    if (expected !== currentSlug) {
      subscribeToCurrentMarket();
    }
  }, 5_000);
}

function stopTimers() {
  if (snapshotTimer) { clearInterval(snapshotTimer); snapshotTimer = null; }
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
}

function scheduleReconnect() {
  if (shuttingDown) return;
  const delayMs = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempts, RECONNECT_MAX_MS);
  reconnectAttempts++;
  log(`Reconnecting in ${delayMs}ms (attempt ${reconnectAttempts})...`);
  setTimeout(connect, delayMs);
}

// --- Main ---

async function main() {
  log("BTC 5-min market live collector starting...");
  log(`Current market: ${currentMarketSlug()}`);

  connect();
  startMarketCheckTimer();

  // Graceful shutdown
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("Shutting down...");
    stopTimers();
    if (marketCheckTimer) clearInterval(marketCheckTimer);
    if (ws) ws.close();
    // Allow final snapshot write
    setTimeout(() => process.exit(0), 1_000);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
