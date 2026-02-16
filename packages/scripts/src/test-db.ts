/**
 * Smoke test: verifies Supabase connection, table access, and CRUD on markets + price_snapshots.
 * Run: pnpm --filter scripts tsx src/test-db.ts
 */

import "dotenv/config";
import { supabase } from "./utils/supabase.js";

async function main() {
  console.log("1. Testing connection...");
  // A simple query to verify we can talk to Supabase at all
  const { error: pingError } = await supabase.from("markets").select("id").limit(1);
  if (pingError) {
    console.error("   FAIL — cannot query markets table:", pingError.message);
    process.exit(1);
  }
  console.log("   OK — connected to Supabase, markets table is accessible.");

  // -----------------------------------------------------------------
  console.log("2. Inserting a test market row...");
  const testSlug = `__test-smoke-${Date.now()}`;
  const { data: inserted, error: insertErr } = await supabase
    .from("markets")
    .insert({
      slug: testSlug,
      condition_id: "test-condition",
      token_id_yes: "test-yes",
      token_id_no: "test-no",
      question: "Smoke test market",
      start_time: new Date().toISOString(),
      end_time: new Date(Date.now() + 300_000).toISOString(),
      outcome: "Up",
      outcome_yes_price: 1.0,
      volume: 0,
    })
    .select()
    .single();

  if (insertErr || !inserted) {
    console.error("   FAIL — insert into markets:", insertErr?.message);
    process.exit(1);
  }
  console.log(`   OK — inserted market id=${inserted.id}, slug=${inserted.slug}`);

  // -----------------------------------------------------------------
  console.log("3. Inserting a test price_snapshot...");
  const { error: snapErr } = await supabase.from("price_snapshots").insert({
    market_id: inserted.id,
    recorded_at: new Date().toISOString(),
    mid_price_yes: 0.5,
    best_bid_yes: 0.49,
    best_ask_yes: 0.51,
    last_trade_price: 0.5,
    source: "api",
  });

  if (snapErr) {
    console.error("   FAIL — insert into price_snapshots:", snapErr.message);
    process.exit(1);
  }
  console.log("   OK — inserted price snapshot.");

  // -----------------------------------------------------------------
  console.log("4. Reading from market_outcomes view...");
  const { data: outcomes, error: viewErr } = await supabase
    .from("market_outcomes")
    .select("*")
    .eq("slug", testSlug);

  if (viewErr) {
    console.error("   FAIL — query market_outcomes view:", viewErr.message);
    process.exit(1);
  }
  if (!outcomes || outcomes.length === 0) {
    console.error("   FAIL — market_outcomes view returned no rows for test slug.");
    process.exit(1);
  }
  console.log(`   OK — view returned ${outcomes.length} row(s), outcome_binary=${outcomes[0].outcome_binary}`);

  // -----------------------------------------------------------------
  console.log("5. Cleaning up test data...");
  await supabase.from("price_snapshots").delete().eq("market_id", inserted.id);
  await supabase.from("markets").delete().eq("id", inserted.id);
  console.log("   OK — test rows deleted.");

  // Verify cleanup
  const { data: remaining } = await supabase.from("markets").select("id").eq("slug", testSlug);
  if (remaining && remaining.length > 0) {
    console.warn("   WARN — cleanup may have failed, test row still exists.");
  } else {
    console.log("   OK — cleanup verified, no residual rows.");
  }

  console.log("\nAll checks passed.");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
