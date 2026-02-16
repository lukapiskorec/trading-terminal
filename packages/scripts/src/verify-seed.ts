/** Quick verification of seeded data */
import "dotenv/config";
import { supabase } from "./utils/supabase.js";

async function main() {
  const { data: outcomes } = await supabase.from("market_outcomes").select("outcome, outcome_binary");
  if (!outcomes || outcomes.length === 0) {
    console.error("No outcomes found!");
    return;
  }

  const up = outcomes.filter((o) => o.outcome === "Up").length;
  const down = outcomes.filter((o) => o.outcome === "Down").length;
  const avg = outcomes.reduce((s, o) => s + o.outcome_binary, 0) / outcomes.length;

  console.log(`Outcomes: ${up} Up, ${down} Down (${((up / outcomes.length) * 100).toFixed(1)}% / ${((down / outcomes.length) * 100).toFixed(1)}%)`);
  console.log(`AOI-288 (full day): ${avg.toFixed(4)}`);

  const { data: first } = await supabase
    .from("price_snapshots")
    .select("recorded_at")
    .order("recorded_at", { ascending: true })
    .limit(1);
  const { data: last } = await supabase
    .from("price_snapshots")
    .select("recorded_at")
    .order("recorded_at", { ascending: false })
    .limit(1);
  console.log(`Price data range: ${first![0].recorded_at} → ${last![0].recorded_at}`);
}

main().catch(console.error);
