/**
 * Backfill price_snapshots with 5-second fidelity from per-trade data.
 *
 * For each market in the DB for a given date:
 *   1. Fetch all trades from CLOB API (authenticated) for the YES token
 *   2. Bucket trades into 5-second intervals (60 buckets per 5-min market)
 *   3. Take last trade price per bucket, forward-fill gaps
 *   4. Delete existing 'api' source snapshots (coarse 1-min data)
 *   5. Insert new 'trades' source snapshots
 *
 * Run: pnpm --filter scripts backfill
 * Args: optional date (YYYY-MM-DD), defaults to 2026-02-13
 *
 * Requires env vars:
 *   SUPABASE_URL, SUPABASE_SECRET_KEY
 *   PRIVATE_KEY  (Ethereum wallet hex key)
 *   CLOB_API_KEY, CLOB_SECRET, CLOB_PASSPHRASE  (run derive-key first)
 */

import "dotenv/config";
import { ClobClient } from "@polymarket/clob-client";
import { ethers } from "ethers";
import { supabase } from "./utils/supabase.js";
import { delay } from "./utils/polymarket.js";

const CLOB_URL = "https://clob.polymarket.com";
const CHAIN_ID = 137; // Polygon

const MARKET_DURATION = 300; // 5 minutes in seconds
const BUCKET_SIZE = 5;       // 5-second intervals
const BUCKETS_PER_MARKET = MARKET_DURATION / BUCKET_SIZE; // 60

interface MarketRow {
  id: number;
  slug: string;
  token_id_yes: string;
  start_time: string;
  end_time: string;
}

function createClobClient(): ClobClient {
  const privateKey = process.env.PRIVATE_KEY;
  const apiKey = process.env.CLOB_API_KEY;
  const secret = process.env.CLOB_SECRET;
  const passphrase = process.env.CLOB_PASSPHRASE;

  if (!privateKey) {
    console.error("Missing PRIVATE_KEY env var.");
    console.error("Set it in packages/scripts/.env");
    process.exit(1);
  }

  if (!apiKey || !secret || !passphrase) {
    console.error("Missing CLOB API credentials.");
    console.error("");
    console.error("Required env vars: CLOB_API_KEY, CLOB_SECRET, CLOB_PASSPHRASE");
    console.error("Run this first to derive them from your wallet:");
    console.error("  pnpm --filter scripts derive-key");
    process.exit(1);
  }

  const wallet = new ethers.Wallet(privateKey);
  return new ClobClient(CLOB_URL, CHAIN_ID, wallet, {
    key: apiKey,
    secret,
    passphrase,
  });
}

async function main() {
  const client = createClobClient();
  const date = process.argv[2] || "2026-02-13";
  const dayStart = `${date}T00:00:00Z`;
  const dayEnd = `${date}T23:59:59Z`;

  console.log(`Backfilling 5-second snapshots for ${date}...\n`);

  // Fetch all markets for the date
  const { data: markets, error: fetchErr } = await supabase
    .from("markets")
    .select("id, slug, token_id_yes, start_time, end_time")
    .gte("start_time", dayStart)
    .lte("start_time", dayEnd)
    .order("start_time", { ascending: true });

  if (fetchErr || !markets) {
    console.error("Failed to fetch markets:", fetchErr?.message);
    process.exit(1);
  }

  console.log(`Found ${markets.length} markets for ${date}\n`);

  let backfilled = 0;
  let skipped = 0;
  let noTrades = 0;
  let failed = 0;

  for (let i = 0; i < markets.length; i++) {
    const market = markets[i] as MarketRow;
    const startTs = Math.floor(new Date(market.start_time).getTime() / 1000);
    const endTs = Math.floor(new Date(market.end_time).getTime() / 1000);

    // Check if already backfilled (has 'trades' source snapshots)
    const { count } = await supabase
      .from("price_snapshots")
      .select("*", { count: "exact", head: true })
      .eq("market_id", market.id)
      .eq("source", "trades");

    if (count && count >= BUCKETS_PER_MARKET / 2) {
      skipped++;
      if (skipped <= 3) console.log(`  [${i + 1}/${markets.length}] SKIP ${market.slug} (already backfilled, ${count} pts)`);
      else if (skipped === 4) console.log(`  ... (suppressing further skip messages)`);
      continue;
    }

    // Fetch trades from CLOB API using official client (L2 auth)
    let allTrades: { time: number; price: number }[] = [];

    try {
      const rawTrades = await client.getTrades(
        { asset_id: market.token_id_yes },
        true, // only first page (up to default limit)
      );

      for (const trade of rawTrades) {
        const tradeTime = parseTradeTime(trade.match_time);
        const tradePrice = parseFloat(trade.price);

        if (tradeTime >= startTs && tradeTime <= endTs && !isNaN(tradePrice)) {
          allTrades.push({ time: tradeTime, price: tradePrice });
        }
      }
    } catch (err: any) {
      failed++;
      console.error(`  [${i + 1}/${markets.length}] FAIL ${market.slug} — ${err.message}`);
      await delay(100);
      continue;
    }

    if (allTrades.length === 0) {
      noTrades++;
      if (noTrades <= 5) console.log(`  [${i + 1}/${markets.length}] EMPTY ${market.slug} (no trades found)`);
      else if (noTrades === 6) console.log(`  ... (suppressing further empty messages)`);
      await delay(50);
      continue;
    }

    // Sort trades by time ascending
    allTrades.sort((a, b) => a.time - b.time);

    // Bucket into 5-second intervals with forward-fill
    const snapshots = bucketTrades(allTrades, startTs, endTs, market.id);

    // Delete old coarse 'api' snapshots for this market
    await supabase
      .from("price_snapshots")
      .delete()
      .eq("market_id", market.id)
      .eq("source", "api");

    // Also delete any previous 'trades' snapshots (in case of re-run)
    await supabase
      .from("price_snapshots")
      .delete()
      .eq("market_id", market.id)
      .eq("source", "trades");

    // Insert new snapshots
    const batchSize = 60;
    for (let b = 0; b < snapshots.length; b += batchSize) {
      const batch = snapshots.slice(b, b + batchSize);
      const { error: insertErr } = await supabase
        .from("price_snapshots")
        .insert(batch);

      if (insertErr) {
        console.error(`  [${i + 1}/${markets.length}] WARN ${market.slug} — insert error: ${insertErr.message}`);
      }
    }

    backfilled++;
    console.log(`  [${i + 1}/${markets.length}] OK ${market.slug} — ${allTrades.length} trades → ${snapshots.length} snapshots`);

    // Rate limit: 100ms between markets
    await delay(100);
  }

  console.log(`\nDone. Backfilled: ${backfilled}, Skipped: ${skipped}, No trades: ${noTrades}, Failed: ${failed}`);

  const { count: totalSnaps } = await supabase
    .from("price_snapshots")
    .select("*", { count: "exact", head: true });
  console.log(`Total price_snapshots in DB: ${totalSnaps}`);
}

/**
 * Bucket trades into 5-second intervals and forward-fill gaps.
 * Returns one snapshot per bucket (60 total for a 5-min market).
 */
function bucketTrades(
  trades: { time: number; price: number }[],
  startTs: number,
  _endTs: number,
  marketId: number,
): {
  market_id: number;
  recorded_at: string;
  mid_price_yes: number;
  best_bid_yes: null;
  best_ask_yes: null;
  last_trade_price: number;
  source: "trades";
}[] {
  const buckets: (number | null)[] = new Array(BUCKETS_PER_MARKET).fill(null);

  for (const trade of trades) {
    const offset = trade.time - startTs;
    const bucketIdx = Math.min(Math.floor(offset / BUCKET_SIZE), BUCKETS_PER_MARKET - 1);
    if (bucketIdx >= 0) {
      buckets[bucketIdx] = trade.price;
    }
  }

  // Forward-fill
  let lastPrice: number | null = null;
  for (let i = 0; i < buckets.length; i++) {
    if (buckets[i] !== null) {
      lastPrice = buckets[i];
    } else if (lastPrice !== null) {
      buckets[i] = lastPrice;
    }
  }

  // Back-fill leading nulls from first known price
  const firstKnown = buckets.find((b) => b !== null);
  if (firstKnown !== null && firstKnown !== undefined) {
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i] === null) {
        buckets[i] = firstKnown;
      } else {
        break;
      }
    }
  }

  return buckets
    .map((price, idx) => {
      if (price === null) return null;
      const bucketTime = startTs + idx * BUCKET_SIZE;
      return {
        market_id: marketId,
        recorded_at: new Date(bucketTime * 1000).toISOString(),
        mid_price_yes: price,
        best_bid_yes: null as null,
        best_ask_yes: null as null,
        last_trade_price: price,
        source: "trades" as const,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);
}

/** Parse trade match_time — handles both ISO strings and unix timestamp strings */
function parseTradeTime(matchTime: string): number {
  const asNum = Number(matchTime);
  if (!isNaN(asNum) && asNum > 1_000_000_000) {
    return asNum > 10_000_000_000 ? Math.floor(asNum / 1000) : asNum;
  }
  return Math.floor(new Date(matchTime).getTime() / 1000);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
