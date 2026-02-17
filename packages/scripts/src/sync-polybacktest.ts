/**
 * Sync recent BTC 5-min markets from PolyBackTest into Supabase.
 *
 * Fetches the last 100 resolved 5-min markets with sub-second snapshot data,
 * downsamples to 1-second intervals, and upserts into our database.
 *
 * Run:  pnpm --filter scripts sync:pbt
 *
 * Designed to be run every ~8 hours to keep the database populated with
 * high-resolution price data as new markets resolve.
 *
 * Env vars required in packages/scripts/.env:
 *   POLYBACKTEST_API_KEY=your_key_here
 *   SUPABASE_URL=https://your-project.supabase.co
 *   SUPABASE_SECRET_KEY=your_service_role_key
 */

import "dotenv/config";
import { supabase } from "./utils/supabase.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PBT_BASE = "https://api.polybacktest.com";
const PBT_KEY = process.env.POLYBACKTEST_API_KEY;

if (!PBT_KEY) {
  console.error("Missing POLYBACKTEST_API_KEY in .env");
  process.exit(1);
}

const PBT_HEADERS = {
  "X-API-Key": PBT_KEY,
  Accept: "application/json",
};

/** Max snapshots per page (API caps at 1000). */
const SNAPSHOT_PAGE_SIZE = 1000;

/** Delay between API calls to stay friendly with rate limits. */
const API_DELAY_MS = 150;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PbtMarket {
  market_id: string;
  slug: string;
  market_type: string;
  start_time: string;
  end_time: string;
  btc_price_start: number | string;
  condition_id: string;
  clob_token_up: string;
  clob_token_down: string;
  winner: string | null;
  final_volume: number | null;
  resolved_at: string | null;
}

interface PbtSnapshot {
  id: number;
  time: string;
  market_id: string;
  btc_price: string;
  price_up: string;
  price_down: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pbtFetch<T>(path: string): Promise<T> {
  const url = `${PBT_BASE}${path}`;
  const res = await fetch(url, { headers: PBT_HEADERS });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PBT ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Downsample sub-second snapshots to 1-second intervals.
 * For each whole second within the market window, pick the snapshot closest
 * to that timestamp. Returns exactly one point per second.
 */
function downsampleTo1s(snapshots: PbtSnapshot[], startIso: string, endIso: string) {
  if (snapshots.length === 0) return [];

  const startSec = Math.floor(new Date(startIso).getTime() / 1000);
  const endSec = Math.floor(new Date(endIso).getTime() / 1000);

  // Pre-parse timestamps once
  const parsed = snapshots.map((s) => ({
    ...s,
    epochMs: new Date(s.time).getTime(),
  }));

  const result: { epochSec: number; snap: (typeof parsed)[0] }[] = [];

  let cursor = 0;
  for (let sec = startSec; sec <= endSec; sec++) {
    const targetMs = sec * 1000;

    // Advance cursor to nearest snapshot
    while (
      cursor < parsed.length - 1 &&
      Math.abs(parsed[cursor + 1].epochMs - targetMs) <=
        Math.abs(parsed[cursor].epochMs - targetMs)
    ) {
      cursor++;
    }

    // Only include if the snapshot is within 2 seconds of the target
    if (Math.abs(parsed[cursor].epochMs - targetMs) <= 2000) {
      result.push({ epochSec: sec, snap: parsed[cursor] });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== PolyBackTest → Supabase Sync ===");
  console.log(`Started at ${new Date().toISOString()}\n`);

  // ------------------------------------------------------------------
  // 1. Fetch last 100 resolved 5-min markets from PolyBackTest
  // ------------------------------------------------------------------
  console.log("Fetching market list from PolyBackTest...");
  const { markets: pbtMarkets } = await pbtFetch<{
    markets: PbtMarket[];
    total: number;
  }>("/v1/markets?market_type=5m&limit=100");

  const resolved = pbtMarkets.filter((m) => m.winner !== null);
  console.log(
    `  Got ${pbtMarkets.length} markets, ${resolved.length} resolved, ${pbtMarkets.length - resolved.length} unresolved (skipped)\n`
  );

  if (resolved.length === 0) {
    console.log("No resolved markets to sync. Exiting.");
    return;
  }

  // Show time range
  const slugs = resolved.map((m) => m.slug);
  console.log(`  Earliest: ${resolved[resolved.length - 1].slug}  (${resolved[resolved.length - 1].start_time})`);
  console.log(`  Latest:   ${resolved[0].slug}  (${resolved[0].start_time})\n`);

  // ------------------------------------------------------------------
  // 2. Check which markets we already have with polybacktest data
  // ------------------------------------------------------------------
  console.log("Checking existing markets in Supabase...");
  const { data: existingMarkets } = await supabase
    .from("markets")
    .select("id, slug")
    .in("slug", slugs);

  const existingSlugToId = new Map<string, number>();
  for (const m of existingMarkets ?? []) {
    existingSlugToId.set(m.slug, m.id);
  }

  // Check which existing markets already have polybacktest snapshots
  const existingIds = [...existingSlugToId.values()];
  const marketsWithPbtData = new Set<number>();
  if (existingIds.length > 0) {
    const { data: pbtSnapRows } = await supabase
      .from("price_snapshots")
      .select("market_id")
      .in("market_id", existingIds)
      .eq("source", "polybacktest")
      .limit(1000);

    for (const row of pbtSnapRows ?? []) {
      marketsWithPbtData.add(row.market_id);
    }
  }

  console.log(
    `  ${existingSlugToId.size} already in DB, ${marketsWithPbtData.size} already have PBT snapshots\n`
  );

  // ------------------------------------------------------------------
  // 3. Process each market
  // ------------------------------------------------------------------
  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < resolved.length; i++) {
    const pbt = resolved[i];
    const label = `[${i + 1}/${resolved.length}]`;

    // Skip if we already have polybacktest data for this market
    const existingId = existingSlugToId.get(pbt.slug);
    if (existingId && marketsWithPbtData.has(existingId)) {
      skipped++;
      if (skipped <= 5) {
        console.log(`  ${label} SKIP ${pbt.slug} (already has PBT data)`);
      } else if (skipped === 6) {
        console.log(`  ... suppressing further skip messages`);
      }
      continue;
    }

    // ------- Fetch all snapshots (paginated) -------
    let allSnapshots: PbtSnapshot[] = [];
    let offset = 0;
    let total = Infinity;

    try {
      while (offset < total) {
        const page = await pbtFetch<{
          market: PbtMarket;
          snapshots: PbtSnapshot[];
          total: number;
          limit: number;
          offset: number;
        }>(
          `/v1/markets/${pbt.market_id}/snapshots?include_orderbook=false&limit=${SNAPSHOT_PAGE_SIZE}&offset=${offset}`
        );

        total = page.total;
        allSnapshots = allSnapshots.concat(page.snapshots);
        offset += page.snapshots.length;

        if (page.snapshots.length === 0) break; // safety
        await delay(API_DELAY_MS);
      }
    } catch (err: any) {
      console.error(`  ${label} FAIL ${pbt.slug} — snapshot fetch: ${err.message}`);
      failed++;
      await delay(API_DELAY_MS);
      continue;
    }

    // ------- Downsample to 1-second intervals -------
    const sampled = downsampleTo1s(allSnapshots, pbt.start_time, pbt.end_time);

    // ------- Upsert market row -------
    let marketId: number;

    const outcome = pbt.winner === "Up" ? "Up" : pbt.winner === "Down" ? "Down" : null;
    const yesPrice = outcome === "Up" ? 1.0 : outcome === "Down" ? 0.0 : null;

    if (existingId) {
      // Update outcome/volume if needed
      await supabase
        .from("markets")
        .update({
          outcome,
          outcome_yes_price: yesPrice,
          volume: pbt.final_volume,
        })
        .eq("id", existingId);
      marketId = existingId;
    } else {
      // Insert new market
      const { data: row, error: insertErr } = await supabase
        .from("markets")
        .insert({
          slug: pbt.slug,
          condition_id: pbt.condition_id,
          token_id_yes: pbt.clob_token_up,
          token_id_no: pbt.clob_token_down,
          question: `Bitcoin Up or Down - ${new Date(pbt.start_time).toUTCString()}`,
          start_time: pbt.start_time,
          end_time: pbt.end_time,
          outcome,
          outcome_yes_price: yesPrice,
          volume: pbt.final_volume,
        })
        .select("id")
        .single();

      if (insertErr || !row) {
        console.error(`  ${label} FAIL ${pbt.slug} — DB insert: ${insertErr?.message}`);
        failed++;
        continue;
      }
      marketId = row.id;
    }

    // ------- Insert snapshots -------
    if (sampled.length > 0) {
      const snapRows = sampled.map((s) => ({
        market_id: marketId,
        recorded_at: new Date(s.epochSec * 1000).toISOString(),
        mid_price_yes: parseFloat(s.snap.price_up),
        best_bid_yes: null,
        best_ask_yes: null,
        last_trade_price: parseFloat(s.snap.price_up),
        source: "polybacktest",
      }));

      // Insert in batches of 500 (Supabase has payload limits)
      for (let b = 0; b < snapRows.length; b += 500) {
        const batch = snapRows.slice(b, b + 500);
        const { error: snapErr } = await supabase
          .from("price_snapshots")
          .insert(batch);

        if (snapErr) {
          console.error(
            `  ${label} WARN ${pbt.slug} — snapshot insert batch ${b}: ${snapErr.message}`
          );
        }
      }
    }

    synced++;
    console.log(
      `  ${label} OK ${pbt.slug} → ${outcome}  (${allSnapshots.length} raw → ${sampled.length} @1s, vol $${Math.round(pbt.final_volume ?? 0)})`
    );

    await delay(API_DELAY_MS);
  }

  // ------------------------------------------------------------------
  // 4. Summary
  // ------------------------------------------------------------------
  console.log(`\n=== Done ===`);
  console.log(`  Synced: ${synced}   Skipped: ${skipped}   Failed: ${failed}`);

  const { count: mktCount } = await supabase
    .from("markets")
    .select("*", { count: "exact", head: true });
  const { count: snapCount } = await supabase
    .from("price_snapshots")
    .select("*", { count: "exact", head: true });
  console.log(`  Database totals: ${mktCount} markets, ${snapCount} price snapshots`);
  console.log(`  Finished at ${new Date().toISOString()}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
