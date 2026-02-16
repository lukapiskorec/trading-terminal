/**
 * Seed Supabase with all 288 BTC 5-min markets from Feb 13, 2026 (UTC day).
 *
 * For each market:
 *   1. Fetch event metadata from Gamma API
 *   2. Fetch YES token price history from CLOB API (fidelity=1 → ~5 points)
 *   3. Insert into `markets` + `price_snapshots`
 *
 * Run: pnpm --filter scripts seed
 */

import "dotenv/config";
import { supabase } from "./utils/supabase.js";
import { getEventBySlug, getPriceHistory, delay } from "./utils/polymarket.js";

// Feb 13, 2026 00:00:00 UTC
const BASE_TS = 1770940800;
const MARKETS_PER_DAY = 288;
const MARKET_DURATION = 300; // 5 minutes

function slug(ts: number): string {
  return `btc-updown-5m-${ts}`;
}

/** Derive outcome from outcomePrices JSON. outcomes=["Up","Down"], prices=["1","0"] → "Up" */
function resolveOutcome(
  outcomesJson: string,
  pricesJson: string,
): { outcome: "Up" | "Down" | null; yesPrice: number | null } {
  try {
    const outcomes: string[] = JSON.parse(outcomesJson);
    const prices: string[] = JSON.parse(pricesJson);
    const upIdx = outcomes.indexOf("Up");
    if (upIdx === -1) return { outcome: null, yesPrice: null };
    const upPrice = parseFloat(prices[upIdx]);
    if (upPrice === 1) return { outcome: "Up", yesPrice: 1.0 };
    if (upPrice === 0) return { outcome: "Down", yesPrice: 0.0 };
    // Not yet resolved
    return { outcome: null, yesPrice: null };
  } catch {
    return { outcome: null, yesPrice: null };
  }
}

async function main() {
  console.log(`Seeding ${MARKETS_PER_DAY} markets for Feb 13, 2026 (UTC day)...\n`);

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < MARKETS_PER_DAY; i++) {
    const ts = BASE_TS + i * MARKET_DURATION;
    const marketSlug = slug(ts);
    const startTime = new Date(ts * 1000).toISOString();
    const endTime = new Date((ts + MARKET_DURATION) * 1000).toISOString();

    // Check if already seeded
    const { data: existing } = await supabase
      .from("markets")
      .select("id")
      .eq("slug", marketSlug)
      .limit(1);

    if (existing && existing.length > 0) {
      skipped++;
      if (skipped <= 3) console.log(`  [${i + 1}/288] SKIP ${marketSlug} (already exists)`);
      else if (skipped === 4) console.log(`  ... (suppressing further skip messages)`);
      continue;
    }

    // Fetch event from Gamma API
    let event;
    try {
      event = await getEventBySlug(marketSlug);
    } catch (err: any) {
      console.error(`  [${i + 1}/288] FAIL ${marketSlug} — Gamma fetch: ${err.message}`);
      failed++;
      await delay(200);
      continue;
    }

    if (!event || event.markets.length === 0) {
      console.error(`  [${i + 1}/288] FAIL ${marketSlug} — not found on Gamma`);
      failed++;
      await delay(100);
      continue;
    }

    const market = event.markets[0];
    const tokenIds: string[] = JSON.parse(market.clobTokenIds);
    const yesTokenId = tokenIds[0];
    const noTokenId = tokenIds[1];
    const { outcome, yesPrice } = resolveOutcome(market.outcomes, market.outcomePrices);

    // Insert market row
    const { data: row, error: insertErr } = await supabase
      .from("markets")
      .insert({
        slug: marketSlug,
        condition_id: market.conditionId,
        token_id_yes: yesTokenId,
        token_id_no: noTokenId,
        question: market.question,
        start_time: startTime,
        end_time: endTime,
        outcome,
        outcome_yes_price: yesPrice,
        volume: market.volumeNum ?? parseFloat(market.volume) ?? null,
      })
      .select("id")
      .single();

    if (insertErr || !row) {
      console.error(`  [${i + 1}/288] FAIL ${marketSlug} — DB insert: ${insertErr?.message}`);
      failed++;
      await delay(100);
      continue;
    }

    // Fetch price history for YES token
    try {
      const { history } = await getPriceHistory(yesTokenId, {
        startTs: ts,
        endTs: ts + MARKET_DURATION,
        fidelity: 1,
      });

      if (history.length > 0) {
        const snapshots = history.map((point) => ({
          market_id: row.id,
          recorded_at: new Date(point.t * 1000).toISOString(),
          mid_price_yes: point.p,
          best_bid_yes: null,
          best_ask_yes: null,
          last_trade_price: point.p,
          source: "api" as const,
        }));

        const { error: snapErr } = await supabase
          .from("price_snapshots")
          .insert(snapshots);

        if (snapErr) {
          console.error(`  [${i + 1}/288] WARN ${marketSlug} — snapshots insert: ${snapErr.message}`);
        }
      }

      inserted++;
      const outcomeStr = outcome ? `→ ${outcome}` : "(unresolved)";
      const priceCount = history.length;
      console.log(`  [${i + 1}/288] OK ${marketSlug} ${outcomeStr} (${priceCount} prices, vol $${Math.round(market.volumeNum)})`);
    } catch (err: any) {
      // Market row inserted, but price history failed — still count as inserted
      inserted++;
      console.warn(`  [${i + 1}/288] WARN ${marketSlug} — prices fetch: ${err.message}`);
    }

    // Rate limit: 100ms between requests (well within API limits)
    await delay(100);
  }

  console.log(`\nDone. Inserted: ${inserted}, Skipped: ${skipped}, Failed: ${failed}`);

  // Summary query
  const { count } = await supabase
    .from("markets")
    .select("*", { count: "exact", head: true });
  const { count: snapCount } = await supabase
    .from("price_snapshots")
    .select("*", { count: "exact", head: true });
  console.log(`Database totals: ${count} markets, ${snapCount} price snapshots`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
