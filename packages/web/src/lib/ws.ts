/**
 * Browser-side WebSocket manager for Polymarket CLOB real-time data.
 *
 * - Connects to wss://ws-subscriptions-clob.polymarket.com/ws/market
 * - Auto-reconnect with exponential backoff
 * - PING heartbeat every 10 seconds (required by Polymarket)
 * - Exposes subscribe/unsubscribe for asset IDs
 * - Calls listeners on price updates
 */

import { WS_URL } from "./constants";

export type PriceUpdate = {
  event: "price_change" | "last_trade_price" | "book";
  price?: number;
  bestBid?: number;
  bestAsk?: number;
};

export type ConnectionStatus = "disconnected" | "connecting" | "connected";
export type StatusListener = (status: ConnectionStatus) => void;
export type PriceListener = (update: PriceUpdate) => void;

const PING_INTERVAL = 10_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

let ws: WebSocket | null = null;
let status: ConnectionStatus = "disconnected";
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;

/** Currently subscribed asset IDs */
let subscribedIds: string[] = [];

const statusListeners = new Set<StatusListener>();
const priceListeners = new Set<PriceListener>();

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
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  setStatus("connecting");

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    setStatus("connected");
    reconnectAttempts = 0;
    startPing();

    // Re-subscribe to any asset IDs from before reconnect
    if (subscribedIds.length > 0) {
      sendSubscribe(subscribedIds);
    }
  };

  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(typeof e.data === "string" ? e.data : "");
      const messages = Array.isArray(data) ? data : [data];

      for (const msg of messages) {
        handleMessage(msg);
      }
    } catch {
      // Non-JSON (pong frames, etc.)
    }
  };

  ws.onclose = () => {
    setStatus("disconnected");
    stopPing();
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose will fire after this
  };
}

export function disconnect() {
  reconnectAttempts = 999; // prevent auto-reconnect
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  stopPing();
  subscribedIds = [];
  if (ws) { ws.close(); ws = null; }
  setStatus("disconnected");
  reconnectAttempts = 0;
}

export function subscribe(assetIds: string[]) {
  subscribedIds = assetIds;
  if (ws && ws.readyState === WebSocket.OPEN) {
    sendSubscribe(assetIds);
  }
}

export function unsubscribe() {
  if (ws && ws.readyState === WebSocket.OPEN && subscribedIds.length > 0) {
    ws.send(JSON.stringify({ assets_ids: subscribedIds, type: "unsubscribe" }));
  }
  subscribedIds = [];
}

// --- Internal ---

function sendSubscribe(ids: string[]) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ auth: {}, assets_ids: ids, type: "market" }));
}

function handleMessage(msg: any) {
  if (!msg || typeof msg !== "object") return;
  const event = msg.event_type ?? msg.type;

  switch (event) {
    case "price_change": {
      const price = parseFloat(msg.price);
      if (!isNaN(price)) {
        for (const fn of priceListeners) fn({ event: "price_change", price });
      }
      break;
    }
    case "last_trade_price": {
      const price = parseFloat(msg.price);
      if (!isNaN(price)) {
        for (const fn of priceListeners) fn({ event: "last_trade_price", price });
      }
      break;
    }
    case "book": {
      const update: PriceUpdate = { event: "book" };
      if (msg.bids?.[0]) update.bestBid = parseFloat(msg.bids[0].price);
      if (msg.asks?.[0]) update.bestAsk = parseFloat(msg.asks[0].price);
      for (const fn of priceListeners) fn(update);
      break;
    }
  }
}

function startPing() {
  stopPing();
  pingTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Browser WebSocket doesn't have .ping() — send a text frame instead
      ws.send("ping");
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
