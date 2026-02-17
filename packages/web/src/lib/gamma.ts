/**
 * Browser-side Gamma API helper for fetching live market token IDs.
 *
 * Used when the current 5-min market isn't in Supabase yet (it's live and
 * hasn't been collected). Fetches from Polymarket's public Gamma API to get
 * the clobTokenIds needed for WS subscription.
 */

// Proxied through Vite dev server to avoid CORS (see vite.config.ts)
const GAMMA = "/api/gamma";

export interface GammaMarket {
  clobTokenIds: string; // JSON string: '["yesTokenId", "noTokenId"]'
  outcomes: string;
  outcomePrices: string;
  question: string; // e.g. "Will BTC go up between 4:25PM–4:30PM ET?"
  closed: boolean;
}

export interface GammaEvent {
  id: string;
  slug: string;
  markets: GammaMarket[];
}

/**
 * Fetch a Polymarket event by slug from the Gamma API.
 * Returns null if not found or on error.
 */
export async function getEventBySlug(slug: string): Promise<GammaEvent | null> {
  try {
    const res = await fetch(`${GAMMA}/events?slug=${slug}`);
    if (!res.ok) return null;
    const data: GammaEvent[] = await res.json();
    return data[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Parse clobTokenIds JSON string → [yesTokenId, noTokenId]
 */
export function parseTokenIds(market: GammaMarket): { yes: string; no: string } | null {
  try {
    const ids: string[] = JSON.parse(market.clobTokenIds);
    if (ids.length >= 2) return { yes: ids[0], no: ids[1] };
  } catch { /* malformed */ }
  return null;
}
