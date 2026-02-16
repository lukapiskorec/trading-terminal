/**
 * Polymarket REST API client — all calls go through the Vite dev proxy → Hono proxy → Polymarket.
 * In production, replace /api with the deployed proxy URL.
 */

const GAMMA = "/api/gamma";
const CLOB = "/api/clob";

// ---------------------------------------------------------------------------
// Generic fetch helper
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${res.statusText} — ${url}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Gamma API — market discovery & metadata
// ---------------------------------------------------------------------------

/** Raw shape returned by Gamma `/events` endpoint */
export interface GammaEvent {
  id: string;
  slug: string;
  title: string;
  markets: GammaMarket[];
}

export interface GammaMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  tokens: { token_id: string; outcome: string }[];
  startDate: string;
  endDate: string;
  closed: boolean;
  volume: string;
  outcomePrices: string; // JSON string: e.g. "[0.50,0.50]"
  outcome?: string;
}

/** Fetch a single event by slug (e.g. "btc-updown-5m-1739404800") */
export async function getEventBySlug(slug: string): Promise<GammaEvent | null> {
  const data = await fetchJson<GammaEvent[]>(`${GAMMA}/events?slug=${slug}`);
  return data[0] ?? null;
}

/** Fetch resolved markets (paginated) */
export async function getResolvedMarkets(limit = 100, offset = 0): Promise<GammaMarket[]> {
  return fetchJson<GammaMarket[]>(
    `${GAMMA}/markets?closed=true&limit=${limit}&offset=${offset}`,
  );
}

// ---------------------------------------------------------------------------
// CLOB API — prices, order books, fees
// ---------------------------------------------------------------------------

export interface PriceHistoryPoint {
  t: number; // unix timestamp
  p: string; // price as string
}

/** Fetch price history for a token (fidelity: 1 = 1-min, 60 = 1-hour) */
export async function getPriceHistory(
  tokenId: string,
  opts?: { startTs?: number; endTs?: number; fidelity?: number },
): Promise<{ history: PriceHistoryPoint[] }> {
  const params = new URLSearchParams({ market: tokenId });
  if (opts?.startTs) params.set("startTs", String(opts.startTs));
  if (opts?.endTs) params.set("endTs", String(opts.endTs));
  if (opts?.fidelity) params.set("fidelity", String(opts.fidelity));
  return fetchJson(`${CLOB}/prices-history?${params}`);
}

export interface OrderBookSide {
  price: string;
  size: string;
}

export interface OrderBook {
  market: string;
  asset_id: string;
  bids: OrderBookSide[];
  asks: OrderBookSide[];
  hash: string;
}

/** Fetch current order book snapshot */
export async function getOrderBook(tokenId: string): Promise<OrderBook> {
  return fetchJson(`${CLOB}/book?token_id=${tokenId}`);
}

/** Fetch current midpoint price */
export async function getMidpoint(tokenId: string): Promise<{ mid: string }> {
  return fetchJson(`${CLOB}/midpoint?token_id=${tokenId}`);
}

/** Fetch fee rate in basis points */
export async function getFeeRate(tokenId: string): Promise<{ fee_rate_bps: string }> {
  return fetchJson(`${CLOB}/fee-rate-bps?token_id=${tokenId}`);
}
