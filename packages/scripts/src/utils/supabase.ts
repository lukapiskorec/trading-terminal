import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;

if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY environment variables.");
  console.error("Set them in packages/scripts/.env or export them in your shell.");
  process.exit(1);
}

export const supabase = createClient(url, key);
