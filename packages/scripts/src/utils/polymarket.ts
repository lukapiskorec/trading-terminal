import { createHmac } from "crypto";

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";

/** Delay helper for rate limiting */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} — ${url}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// CLOB L2 Auth — HMAC-SHA256 signed requests
// ---------------------------------------------------------------------------

export interface ClobCredentials {
  apiKey: string;
  secret: string;
  passphrase: string;
}

/**
 * Build L2 auth headers for an authenticated CLOB request.
 *
 * Signature = HMAC-SHA256(base64decode(secret), timestamp + method + path + body)
 */
function buildAuthHeaders(
  creds: ClobCredentials,
  method: string,
  path: string,
  body = "",
): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const message = timestamp + method + path + body;
  const signature = createHmac("sha256", Buffer.from(creds.secret, "base64"))
    .update(message)
    .digest("base64");

  return {
    POLY_API_KEY: creds.apiKey,
    POLY_SIGNATURE: signature,
    POLY_TIMESTAMP: timestamp,
    POLY_PASSPHRASE: creds.passphrase,
  };
}

/** Authenticated fetch for CLOB endpoints that require L2 auth */
async function fetchJsonAuth<T>(url: string, creds: ClobCredentials): Promise<T> {
  const parsed = new URL(url);
  const path = parsed.pathname + parsed.search;
  const headers = buildAuthHeaders(creds, "GET", path);

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} — ${url}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Gamma API
// ---------------------------------------------------------------------------

export interface GammaEvent {
  id: string;
  slug: string;
  title: string;
  markets: GammaMarket[];
}

/** Matches the actual Gamma API response for BTC 5-min markets */
export interface GammaMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  clobTokenIds: string;     // JSON string: '["yesTokenId", "noTokenId"]'
  outcomes: string;          // JSON string: '["Up", "Down"]'
  outcomePrices: string;     // JSON string: '["1", "0"]'
  eventStartTime: string;    // actual market start (ISO)
  endDate: string;
  closed: boolean;
  volume: string;
  volumeNum: number;
}

export async function getEventBySlug(slug: string): Promise<GammaEvent | null> {
  const data = await fetchJson<GammaEvent[]>(`${GAMMA}/events?slug=${slug}`);
  return data[0] ?? null;
}

// ---------------------------------------------------------------------------
// CLOB API — public endpoints
// ---------------------------------------------------------------------------

export interface PriceHistoryPoint {
  t: number;
  p: number;
}

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

// ---------------------------------------------------------------------------
// CLOB Trades API — requires L2 auth
// ---------------------------------------------------------------------------

export interface ClobTrade {
  id: string;
  asset_id: string; // token ID
  price: string;    // e.g. "0.55"
  size: string;     // e.g. "100"
  side: string;     // "BUY" | "SELL"
  match_time: string; // ISO 8601 or unix timestamp string
}

/**
 * Fetch trades for an asset (token) ID, paginated. Requires L2 auth.
 *
 * CLOB endpoint: GET /trades?asset_id=X&before=cursor&limit=500
 * Returns up to `limit` trades per call. Pass `before` cursor for pagination.
 */
export async function getTrades(
  assetId: string,
  creds: ClobCredentials,
  opts?: { before?: string; after?: number; limit?: number },
): Promise<{ next_cursor: string; data: ClobTrade[] }> {
  const params = new URLSearchParams({ asset_id: assetId });
  if (opts?.before) params.set("before", opts.before);
  if (opts?.after) params.set("after", String(opts.after));
  if (opts?.limit) params.set("limit", String(opts.limit));

  const raw = await fetchJsonAuth<any>(`${CLOB}/trades?${params}`, creds);

  // Normalize: API may return { next_cursor, data } or just an array
  if (Array.isArray(raw)) {
    return { next_cursor: "", data: raw };
  }
  return {
    next_cursor: raw.next_cursor ?? "",
    data: Array.isArray(raw.data) ? raw.data : [],
  };
}
