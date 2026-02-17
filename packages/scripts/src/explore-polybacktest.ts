/**
 * Explore PolyBackTest API to check data granularity.
 *
 * Tests against our first market (btc-updown-5m-1770940800) to see:
 *   - Does their slug format match ours?
 *   - What snapshot interval do they capture (10s? 30s? 1min?)
 *   - What fields are in each snapshot?
 *
 * Run: pnpm --filter scripts explore:pbt
 */

import "dotenv/config";

const BASE_URL = "https://api.polybacktest.com";
const API_KEY = process.env.POLYBACKTEST_API_KEY;

if (!API_KEY) {
  console.error("Missing POLYBACKTEST_API_KEY in .env");
  process.exit(1);
}

const headers = {
  "X-API-Key": API_KEY,
  Accept: "application/json",
};

async function fetchJson(path: string) {
  const url = `${BASE_URL}${path}`;
  console.log(`→ GET ${url}`);
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json();
}

async function main() {
  // 1. Health check
  console.log("=== Health Check ===");
  try {
    const health = await fetchJson("/health");
    console.log(health);
  } catch (err: any) {
    console.error("Health check failed:", err.message);
  }

  // 2. Try to find our first market by slug
  const ourSlug = "btc-updown-5m-1770940800";
  console.log(`\n=== Lookup market by slug: ${ourSlug} ===`);
  let marketId: string | null = null;

  try {
    const market = await fetchJson(`/v1/markets/by-slug/${ourSlug}`);
    console.log("Market found:");
    console.log(JSON.stringify(market, null, 2));
    marketId = market.id ?? market.market_id;
  } catch (err: any) {
    console.error("Slug lookup failed:", err.message);

    // Maybe their slug format is different — try listing markets to discover format
    console.log("\n=== Listing recent markets to discover slug format ===");
    try {
      const list = await fetchJson("/v1/markets?limit=5");
      console.log(JSON.stringify(list, null, 2));

      // Try to find a btc-updown-5m market in the list
      const markets = Array.isArray(list) ? list : list.data ?? list.markets ?? [];
      if (markets.length > 0) {
        marketId = markets[0].id ?? markets[0].market_id;
        console.log(`\nUsing first listed market: ${marketId}`);
      }
    } catch (listErr: any) {
      console.error("List failed:", listErr.message);
    }
  }

  if (!marketId) {
    console.error("\nCould not find a market to query snapshots for.");
    process.exit(1);
  }

  // 3. Fetch snapshots for the market
  console.log(`\n=== Snapshots for market ${marketId} ===`);
  try {
    const snapshots = await fetchJson(
      `/v1/markets/${marketId}/snapshots?include_orderbook=false`
    );
    const items = Array.isArray(snapshots)
      ? snapshots
      : snapshots.data ?? snapshots.snapshots ?? [];

    console.log(`Total snapshots returned: ${items.length}`);

    if (items.length > 0) {
      // Show first snapshot to see all fields
      console.log("\nFirst snapshot (full):");
      console.log(JSON.stringify(items[0], null, 2));

      // Show last snapshot
      console.log("\nLast snapshot (full):");
      console.log(JSON.stringify(items[items.length - 1], null, 2));

      // Analyze intervals between snapshots
      if (items.length >= 2) {
        const timestamps = items
          .map((s: any) => {
            const t = s.timestamp ?? s.recorded_at ?? s.created_at ?? s.time;
            return typeof t === "number" ? t : new Date(t).getTime() / 1000;
          })
          .sort((a: number, b: number) => a - b);

        const intervals: number[] = [];
        for (let i = 1; i < Math.min(timestamps.length, 50); i++) {
          intervals.push(timestamps[i] - timestamps[i - 1]);
        }

        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const minInterval = Math.min(...intervals);
        const maxInterval = Math.max(...intervals);

        console.log(`\n=== Interval Analysis (first ${intervals.length} gaps) ===`);
        console.log(`  Average: ${avgInterval.toFixed(1)}s`);
        console.log(`  Min:     ${minInterval}s`);
        console.log(`  Max:     ${maxInterval}s`);
        console.log(`  Unique intervals: ${[...new Set(intervals)].sort((a, b) => a - b).join(", ")}s`);
        console.log(`  → ${avgInterval <= 15 ? "YES — 10s intervals achievable!" : `Granularity is ~${Math.round(avgInterval)}s`}`);
      }
    }
  } catch (err: any) {
    console.error("Snapshots fetch failed:", err.message);
  }

  // 4. Try snapshot-at for a specific timestamp (market start)
  const marketStartTs = 1770940800; // Feb 13 00:00:00 UTC
  console.log(`\n=== Snapshot-at timestamp ${marketStartTs} ===`);
  try {
    const snap = await fetchJson(
      `/v1/markets/${marketId}/snapshot-at/${marketStartTs}`
    );
    console.log(JSON.stringify(snap, null, 2));
  } catch (err: any) {
    console.error("Snapshot-at failed:", err.message);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
