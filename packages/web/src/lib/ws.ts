/**
 * Browser-side WebSocket manager for Polymarket CLOB real-time data.
 *
 * Connects to wss://ws-subscriptions-clob.polymarket.com/ws/market
 *
 * Message formats from Polymarket WS:
 * - Book snapshot:      [{asset_id, bids: [{price,size},...], asks: [...]}]
 * - Price changes:      {price_changes: [{asset_id, price, best_bid, best_ask, side, size},...]}
 * - Last trade price:   {event_type: "last_trade_price", asset_id, price, size, side}
 */

import { WS_URL } from "./constants";

export type PriceUpdate = {
  event: "price_change" | "last_trade_price" | "book";
  assetId?: string;
  price?: number;
  bestBid?: number;
  bestAsk?: number;
  size?: number;
};

export type ConnectionStatus = "disconnected" | "connecting" | "connected";
export type StatusListener = (status: ConnectionStatus) => void;
export type PriceListener = (update: PriceUpdate) => void;

const PING_INTERVAL = 10_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

let socket: WebSocket | null = null;
let status: ConnectionStatus = "disconnected";
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;

/** Currently subscribed asset IDs */
let subscribedIds: string[] = [];

const statusListeners = new Set<StatusListener>();
const priceListeners = new Set<PriceListener>();

// --- 1-second price smoothing ---
type PriceBuffer = {
  prices: number[];
  bids: number[];
  asks: number[];
  totalSize: number;
};
const priceBuffers = new Map<string, PriceBuffer>();
let flushTimer: ReturnType<typeof setInterval> | null = null;
const FLUSH_INTERVAL = 1_000;

function getBuffer(assetId: string): PriceBuffer {
  let buf = priceBuffers.get(assetId);
  if (!buf) {
    buf = { prices: [], bids: [], asks: [], totalSize: 0 };
    priceBuffers.set(assetId, buf);
  }
  return buf;
}

function avg(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function flushBuffers() {
  for (const [assetId, buf] of priceBuffers) {
    if (buf.prices.length === 0 && buf.bids.length === 0 && buf.asks.length === 0) continue;
    const update: PriceUpdate = { event: "price_change", assetId };
    if (buf.prices.length > 0) update.price = avg(buf.prices);
    if (buf.bids.length > 0) update.bestBid = avg(buf.bids);
    if (buf.asks.length > 0) update.bestAsk = avg(buf.asks);
    if (buf.totalSize > 0) update.size = buf.totalSize;
    emitToListeners(update);
    buf.prices.length = 0;
    buf.bids.length = 0;
    buf.asks.length = 0;
    buf.totalSize = 0;
  }
}

function startFlush() {
  if (flushTimer) return;
  flushTimer = setInterval(flushBuffers, FLUSH_INTERVAL);
}

function stopFlush() {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  priceBuffers.clear();
}

function setStatus(s: ConnectionStatus) {
  status = s;
  for (const fn of statusListeners) fn(s);
}

// --- Public API ---

export function getStatus(): ConnectionStatus {
  return status;
}

export function onStatus(fn: StatusListener): () => void {
  statusListeners.add(fn);
  return () => { statusListeners.delete(fn); };
}

export function onPrice(fn: PriceListener): () => void {
  priceListeners.add(fn);
  return () => { priceListeners.delete(fn); };
}

export function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  setStatus("connecting");

  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    setStatus("connected");
    reconnectAttempts = 0;
    startPing();
    startFlush();

    // Re-subscribe to any asset IDs from before reconnect
    if (subscribedIds.length > 0) {
      sendSubscribe(subscribedIds);
    }
  };

  socket.onmessage = (e) => {
    try {
      const data = JSON.parse(typeof e.data === "string" ? e.data : "");
      handleRawMessage(data);
    } catch {
      // Non-JSON (pong frames, etc.)
    }
  };

  socket.onclose = () => {
    setStatus("disconnected");
    stopPing();
    stopFlush();
    scheduleReconnect();
  };

  socket.onerror = () => {
    // onclose will fire after this
  };
}

export function disconnect() {
  reconnectAttempts = 999; // prevent auto-reconnect
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  stopPing();
  stopFlush();
  subscribedIds = [];
  if (socket) { socket.close(); socket = null; }
  setStatus("disconnected");
  reconnectAttempts = 0;
}

/**
 * Force a fresh WS connection. Detaches old socket handlers to prevent
 * interference, then immediately opens a new connection.
 * Used for market transitions where Polymarket's WS doesn't respond
 * to mid-session resubscriptions.
 */
export function reconnect() {
  // Detach old socket handlers to prevent onclose from interfering
  const oldSocket = socket;
  socket = null;
  if (oldSocket) {
    oldSocket.onclose = null;
    oldSocket.onerror = null;
    oldSocket.onmessage = null;
    oldSocket.close();
  }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  stopPing();
  stopFlush();
  subscribedIds = [];
  reconnectAttempts = 0;
  // Immediately open fresh connection
  connect();
}

export function subscribe(assetIds: string[]) {
  // Unsubscribe from previous tokens first
  if (socket && socket.readyState === WebSocket.OPEN && subscribedIds.length > 0) {
    socket.send(JSON.stringify({ assets_ids: subscribedIds, type: "unsubscribe" }));
  }
  // Clear stale price buffers
  priceBuffers.clear();

  subscribedIds = assetIds;
  if (socket && socket.readyState === WebSocket.OPEN) {
    sendSubscribe(assetIds);
  }
}

export function unsubscribe() {
  if (socket && socket.readyState === WebSocket.OPEN && subscribedIds.length > 0) {
    socket.send(JSON.stringify({ assets_ids: subscribedIds, type: "unsubscribe" }));
  }
  subscribedIds = [];
}

// --- Internal ---

function sendSubscribe(ids: string[]) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  console.log("[WS] Sending subscribe for", ids.length, "assets");
  socket.send(JSON.stringify({ auth: {}, assets_ids: ids, type: "market" }));
}

function emitToListeners(update: PriceUpdate) {
  for (const fn of priceListeners) fn(update);
}

/**
 * Route incoming JSON to the right handler based on its shape.
 */
function handleRawMessage(data: any) {
  // 1. Book snapshot: arrives as an array of orderbook objects
  //    [{asset_id, bids: [{price, size},...], asks: [{price, size},...], ...}]
  if (Array.isArray(data)) {
    for (const entry of data) {
      if (entry.bids || entry.asks) {
        const id = entry.asset_id;
        if (id) {
          const buf = getBuffer(id);
          if (entry.bids?.[0]) buf.bids.push(parseFloat(entry.bids[0].price));
          if (entry.asks?.[0]) buf.asks.push(parseFloat(entry.asks[0].price));
        }
      }
    }
    return;
  }

  if (!data || typeof data !== "object") return;

  // 2. Price changes: {price_changes: [{asset_id, price, best_bid, best_ask, ...}]}
  if (data.price_changes && Array.isArray(data.price_changes)) {
    for (const pc of data.price_changes) {
      const id = pc.asset_id;
      if (!id) continue;
      const buf = getBuffer(id);
      const price = parseFloat(pc.price);
      if (!isNaN(price)) buf.prices.push(price);
      if (pc.best_bid) buf.bids.push(parseFloat(pc.best_bid));
      if (pc.best_ask) buf.asks.push(parseFloat(pc.best_ask));
      const size = parseFloat(pc.size);
      if (!isNaN(size)) buf.totalSize += size;
    }
    return;
  }

  // 3. Last trade price: {event_type: "last_trade_price", asset_id, price, ...}
  //    NOTE: size is NOT accumulated here — price_changes already includes
  //    trade sizes. Counting both would double-count every trade.
  if (data.event_type === "last_trade_price") {
    const id = data.asset_id;
    if (id) {
      const price = parseFloat(data.price);
      if (!isNaN(price)) {
        const buf = getBuffer(id);
        buf.prices.push(price);
      }
    }
    return;
  }

  // Unknown message shape — log for debugging
  const keys = Object.keys(data).join(",");
  console.debug("[WS] Unhandled message shape:", keys, data);
}

function startPing() {
  stopPing();
  pingTimer = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send("ping");
    }
  }, PING_INTERVAL);
}

function stopPing() {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
}

function scheduleReconnect() {
  if (reconnectAttempts >= 999) return; // manually disconnected
  const delayMs = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempts, RECONNECT_MAX_MS);
  reconnectAttempts++;
  reconnectTimer = setTimeout(connect, delayMs);
}
