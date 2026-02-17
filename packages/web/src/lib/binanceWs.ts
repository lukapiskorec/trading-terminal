/**
 * Binance BTCUSDT data client — orderbook (REST poll), trades + klines (WebSocket).
 *
 * Separate from ws.ts (Polymarket). Same listener pattern.
 */

// --- Types ---

export type BinanceStatus = "disconnected" | "connecting" | "connected";
export type OrderbookLevel = [number, number]; // [price, qty]

export interface Kline {
  t: number; // open time (ms)
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface Trade {
  time: number; // ms
  price: number;
  qty: number;
  isBuy: boolean;
}

export interface BinanceState {
  mid: number | null;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  trades: Trade[];
  klines: Kline[];
}

type StatusListener = (status: BinanceStatus) => void;
type UpdateListener = () => void;

// --- Constants ---

const COMBINED_STREAM_URL =
  "wss://stream.binance.com/stream?streams=btcusdt@trade/btcusdt@kline_1m";
const ORDERBOOK_URL =
  "https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=20";
const KLINES_BOOTSTRAP_URL =
  "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=100";

const ORDERBOOK_POLL_MS = 2_000;
const TRADE_BUFFER_SEC = 600;
const TRADE_BUFFER_MAX = 5_000;
const KLINE_BUFFER_MAX = 150;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

// --- State ---

let socket: WebSocket | null = null;
let status: BinanceStatus = "disconnected";
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let orderbookTimer: ReturnType<typeof setInterval> | null = null;

const state: BinanceState = {
  mid: null,
  bids: [],
  asks: [],
  trades: [],
  klines: [],
};

const statusListeners = new Set<StatusListener>();
const updateListeners = new Set<UpdateListener>();

function setStatus(s: BinanceStatus) {
  status = s;
  for (const fn of statusListeners) fn(s);
}

function notifyUpdate() {
  for (const fn of updateListeners) fn();
}

// --- Public API ---

export function getStatus(): BinanceStatus {
  return status;
}

export function onStatus(fn: StatusListener): () => void {
  statusListeners.add(fn);
  return () => { statusListeners.delete(fn); };
}

export function getState(): BinanceState {
  return state;
}

export function onUpdate(fn: UpdateListener): () => void {
  updateListeners.add(fn);
  return () => { updateListeners.delete(fn); };
}

export function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  setStatus("connecting");

  // Bootstrap historical klines before opening WS
  bootstrapKlines().then(() => {
    openSocket();
    startOrderbookPoll();
  });
}

export function disconnect() {
  reconnectAttempts = 999; // prevent auto-reconnect
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  stopOrderbookPoll();
  if (socket) { socket.close(); socket = null; }
  setStatus("disconnected");
  reconnectAttempts = 0;
}

// --- Bootstrap ---

async function bootstrapKlines() {
  try {
    const res = await fetch(KLINES_BOOTSTRAP_URL);
    if (!res.ok) return;
    const raw: any[][] = await res.json();
    state.klines = raw.map((k) => ({
      t: k[0] as number,
      o: parseFloat(k[1] as string),
      h: parseFloat(k[2] as string),
      l: parseFloat(k[3] as string),
      c: parseFloat(k[4] as string),
      v: parseFloat(k[5] as string),
    }));
    notifyUpdate();
  } catch {
    // will populate from WS stream
  }
}

// --- WebSocket ---

function openSocket() {
  socket = new WebSocket(COMBINED_STREAM_URL);

  socket.onopen = () => {
    setStatus("connected");
    reconnectAttempts = 0;
  };

  socket.onmessage = (e) => {
    try {
      const wrapper = JSON.parse(typeof e.data === "string" ? e.data : "");
      const stream: string = wrapper.stream;
      const data = wrapper.data;
      if (!stream || !data) return;

      if (stream === "btcusdt@trade") {
        handleTrade(data);
      } else if (stream === "btcusdt@kline_1m") {
        handleKline(data);
      }
    } catch {
      // ignore non-JSON
    }
  };

  socket.onclose = () => {
    setStatus("disconnected");
    scheduleReconnect();
  };

  socket.onerror = () => {
    // onclose fires after
  };
}

function handleTrade(data: any) {
  const trade: Trade = {
    time: data.T as number,
    price: parseFloat(data.p),
    qty: parseFloat(data.q),
    isBuy: !(data.m as boolean), // m = buyer is maker → seller initiated; !m = buyer initiated
  };
  state.trades.push(trade);

  // Prune old trades
  const cutoff = Date.now() - TRADE_BUFFER_SEC * 1000;
  while (state.trades.length > 0 && state.trades[0].time < cutoff) {
    state.trades.shift();
  }
  if (state.trades.length > TRADE_BUFFER_MAX) {
    state.trades.splice(0, state.trades.length - TRADE_BUFFER_MAX);
  }

  notifyUpdate();
}

function handleKline(data: any) {
  const k = data.k;
  if (!k) return;

  const kline: Kline = {
    t: k.t as number,
    o: parseFloat(k.o),
    h: parseFloat(k.h),
    l: parseFloat(k.l),
    c: parseFloat(k.c),
    v: parseFloat(k.v),
  };

  const isClosed = k.x as boolean;
  const last = state.klines[state.klines.length - 1];

  if (last && last.t === kline.t) {
    // Update in-progress candle
    state.klines[state.klines.length - 1] = kline;
  } else if (isClosed || !last || kline.t > last.t) {
    state.klines.push(kline);
  }

  // Trim buffer
  if (state.klines.length > KLINE_BUFFER_MAX) {
    state.klines.splice(0, state.klines.length - KLINE_BUFFER_MAX);
  }

  notifyUpdate();
}

// --- Orderbook REST poll ---

function startOrderbookPoll() {
  stopOrderbookPoll();
  pollOrderbook(); // immediate first fetch
  orderbookTimer = setInterval(pollOrderbook, ORDERBOOK_POLL_MS);
}

function stopOrderbookPoll() {
  if (orderbookTimer) { clearInterval(orderbookTimer); orderbookTimer = null; }
}

async function pollOrderbook() {
  try {
    const res = await fetch(ORDERBOOK_URL);
    if (!res.ok) return;
    const data = await res.json();

    state.bids = (data.bids as string[][]).map(([p, q]) => [parseFloat(p), parseFloat(q)]);
    state.asks = (data.asks as string[][]).map(([p, q]) => [parseFloat(p), parseFloat(q)]);

    if (state.bids.length > 0 && state.asks.length > 0) {
      state.mid = (state.bids[0][0] + state.asks[0][0]) / 2;
    }

    notifyUpdate();
  } catch {
    // retry on next poll
  }
}

// --- Reconnect ---

function scheduleReconnect() {
  if (reconnectAttempts >= 999) return;
  stopOrderbookPoll();
  const delayMs = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempts, RECONNECT_MAX_MS);
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => {
    openSocket();
    startOrderbookPoll();
  }, delayMs);
}
