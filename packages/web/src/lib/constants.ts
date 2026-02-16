/** Feb 13, 2026 midnight UTC — base timestamp for historical data */
export const FEB13_BASE_TS = 1739404800;

/** Number of 5-min markets per day */
export const MARKETS_PER_DAY = 288;

/** Market duration in seconds */
export const MARKET_DURATION = 300;

/** Polymarket WebSocket URL (direct from browser, no CORS issue) */
export const WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

/** AOI window sizes */
export const AOI_WINDOWS = [1, 6, 12, 144, 288] as const;

/** Generate slug for a BTC 5-min market given its Unix start timestamp */
export function marketSlug(startTs: number): string {
  return `btc-updown-5m-${startTs}`;
}

/** Generate all 288 slugs for a given day's base timestamp */
export function daySlugs(baseTs: number): string[] {
  return Array.from({ length: MARKETS_PER_DAY }, (_, i) =>
    marketSlug(baseTs + i * MARKET_DURATION),
  );
}
