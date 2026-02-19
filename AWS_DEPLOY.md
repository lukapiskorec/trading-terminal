# AWS Lightsail — Deployment Guide

How to deploy the combined data collector (`collect-combined.ts`) to AWS Lightsail so it runs 24/7 without manual intervention.

**Script:** `packages/scripts/src/collect-combined.ts`
**What it does:** Binance BTC indicators every second + PolyBackTest sync every 7 hours, in a single always-on process.

---

## Step 1 — Create a Lightsail instance

1. Go to [lightsail.aws.amazon.com](https://lightsail.aws.amazon.com)
2. Click **Create instance**
3. Select:
   - **Platform:** Linux/Unix
   - **Blueprint:** Ubuntu 24.04 LTS
   - **Instance plan:** $10/month (2 GB RAM, 2 vCPU, 60 GB SSD)
4. Give it a name, e.g. `trading-collector`
5. Click **Create instance** — it will be ready in ~60 seconds

---

## Step 2 — Connect to the instance

In the Lightsail console, click your instance → click **Connect using SSH** (opens a browser terminal).

Or, for a proper terminal: download the SSH key from the Account page, then:

```bash
ssh -i ~/your-key.pem ubuntu@YOUR_INSTANCE_IP
```

---

## Step 3 — Install Node.js

```bash
# Install nvm (Node version manager)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Reload shell so nvm is available
source ~/.bashrc

# Install Node.js 22 LTS
nvm install 22
nvm use 22
node --version   # should print v22.x.x
```

---

## Step 4 — Install pnpm

```bash
npm install -g pnpm
pnpm --version
```

---

## Step 5 — Clone the repository

```bash
# Install git if not present
sudo apt-get update && sudo apt-get install -y git

# Clone (use HTTPS — no SSH key needed on the server)
git clone https://github.com/YOUR_USERNAME/trading-terminal.git
cd trading-terminal
```

If the repo is private, create a GitHub Personal Access Token (Settings → Developer settings → Personal access tokens → Fine-grained) with read access to the repo, then clone with:

```bash
git clone https://YOUR_TOKEN@github.com/YOUR_USERNAME/trading-terminal.git
```

---

## Step 6 — Install dependencies

```bash
cd trading-terminal
pnpm install
```

---

## Step 7 — Create the environment file

```bash
nano packages/scripts/.env
```

Paste the following and fill in your values:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your-service-role-key
POLYBACKTEST_API_KEY=your-pbt-api-key
```

Save with `Ctrl+O`, `Enter`, then `Ctrl+X`.

**Verify it works before proceeding:**

```bash
cd packages/scripts
pnpm collect:combined
```

You should see startup logs from both the Binance connector and the PBT sync. Wait 10–15 seconds to confirm indicator snapshots are flowing. Press `Ctrl+C` to stop — you'll set up auto-restart next.

---

## Step 8 — Install pm2 (process manager)

pm2 keeps the script running after you disconnect and automatically restarts it if it crashes or the server reboots.

```bash
npm install -g pm2
```

---

## Step 9 — Start the script under pm2

```bash
# From the repo root
cd ~/trading-terminal

pm2 start \
  --name "collector" \
  --interpreter "node" \
  --node-args "--import tsx/esm" \
  -- packages/scripts/src/collect-combined.ts

# Check it started correctly
pm2 logs collector --lines 30
```

You should see the same startup logs as the manual test in Step 7.

---

## Step 10 — Enable auto-start on server reboot

```bash
# Generate and run the startup command pm2 tells you
pm2 startup

# Run the command it prints — it will look like:
# sudo env PATH=$PATH:/home/ubuntu/.nvm/versions/node/v22.x.x/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu

# Then save the current pm2 process list
pm2 save
```

Now if the server ever reboots, pm2 will restart the collector automatically.

---

## Useful pm2 commands

```bash
pm2 status                   # show all running processes
pm2 logs collector           # live log output (Ctrl+C to exit)
pm2 logs collector --lines 100  # last 100 lines
pm2 restart collector        # restart after a code update
pm2 stop collector           # stop without removing
pm2 delete collector         # remove from pm2
```

---

## Updating the script

When you push changes to GitHub:

```bash
cd ~/trading-terminal
git pull
pnpm install          # only needed if dependencies changed
pm2 restart collector
pm2 logs collector --lines 20   # verify clean restart
```

---

## Monitoring

The script logs a heartbeat every 60 seconds:

```
[14:30:00] [ind] Heartbeat — mid: $97,432.15 | snapshots: 3600 | errors: 0 | trades: 2841 | klines: 150 | last: 2026-02-19T14:30:00.000Z
```

And logs each PBT sync run:

```
[08:00:00] [pbt] === PolyBackTest sync starting ===
[08:00:02] [pbt] Fetched 100 markets, 98 resolved
[08:01:45] [pbt] === Sync done — synced: 12  skipped: 86  failed: 0 ===
```

If `errors` climbs in the heartbeat, check `pm2 logs collector` for details.

---

## Checking Supabase data

After ~5 minutes running, verify rows are appearing:

```sql
-- Latest BTC indicator snapshots
SELECT recorded_at, btc_mid, bias_signal
FROM btc_indicator_snapshots
ORDER BY recorded_at DESC
LIMIT 10;

-- Latest PolyBackTest market sync
SELECT slug, outcome, start_time
FROM markets
WHERE outcome IS NOT NULL
ORDER BY start_time DESC
LIMIT 10;
```

---

## Instance IP / networking

No inbound firewall rules needed — the script only makes outbound connections (Binance WebSocket, PolyBackTest REST API, Supabase REST API). The default Lightsail firewall blocks all inbound traffic except SSH (port 22), which is fine.

If you later add a web UI or API on this instance, open the relevant port in the Lightsail **Networking** tab.

---

## Cost

| Item | Monthly |
|---|---|
| Lightsail 2 GB instance | $10.00 |
| Data transfer (inbound from Binance ~1.5 GB/day) | Free |
| Data transfer (outbound to Supabase ~50 MB/day) | Included in 3 TB bundle |
| **Total** | **$10.00** |
