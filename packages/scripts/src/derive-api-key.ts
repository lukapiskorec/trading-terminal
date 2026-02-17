/**
 * One-time script to derive CLOB API credentials from an Ethereum private key.
 *
 * Run: pnpm --filter scripts derive-key
 *
 * Requires env var: PRIVATE_KEY (hex string, with or without 0x prefix)
 *
 * Outputs: CLOB_API_KEY, CLOB_SECRET, CLOB_PASSPHRASE
 * Add these to packages/scripts/.env for authenticated API access.
 */

import "dotenv/config";
import { ClobClient } from "@polymarket/clob-client";
import { ethers } from "ethers";

const CLOB_URL = "https://clob.polymarket.com";
const CHAIN_ID = 137; // Polygon

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("Missing PRIVATE_KEY env var.");
    console.error("");
    console.error("Set it in packages/scripts/.env:");
    console.error("  PRIVATE_KEY=0xYourPrivateKeyHere");
    console.error("");
    console.error("To generate a new wallet:");
    console.error("  node -e \"const w = require('ethers').Wallet.createRandom(); console.log('Address:', w.address); console.log('PRIVATE_KEY=' + w.privateKey)\"");
    process.exit(1);
  }

  const wallet = new ethers.Wallet(privateKey);
  console.log(`Wallet address: ${wallet.address}`);
  console.log(`Deriving API credentials from CLOB...\n`);

  const client = new ClobClient(CLOB_URL, CHAIN_ID, wallet);

  const creds = await client.createOrDeriveApiKey();

  console.log("Add these to packages/scripts/.env:\n");
  console.log(`CLOB_API_KEY=${creds.key}`);
  console.log(`CLOB_SECRET=${creds.secret}`);
  console.log(`CLOB_PASSPHRASE=${creds.passphrase}`);
  console.log("");
  console.log("Done. You can now run: pnpm --filter scripts backfill");
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
