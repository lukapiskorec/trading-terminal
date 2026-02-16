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
// CLOB API
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
