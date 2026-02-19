# Virtual Private Server — Hosting Comparison

Research and decision log for hosting the data collection scripts and future trading bots. Compiled on 19.02.2026

**Decision: AWS Lightsail $10/mo** — see rationale at the bottom.

---

## Workload Profile

Two always-on Node.js processes combined into a single script, plus one scheduled job:

| Process | Type | Resource profile |
|---|---|---|
| BTC indicator collector | Always-on WebSocket (Binance depth 100ms + trades + klines), 1 Supabase write/sec | ~100–150 MB RAM |
| Polymarket live collector | Always-on WebSocket (Polymarket CLOB), 1 Supabase write/5s | ~50–80 MB RAM |
| PolyBackTest sync | Cron job every 8 hours, runs ~2–5 min then exits | ~50–80 MB RAM briefly |
| **Total** | | **~200–300 MB RAM sustained** |

Other requirements:

- Network inbound: ~100–500 KB/s sustained from Binance WebSocket streams (~1–1.5 GB/day)
- Network outbound: minimal — small Supabase upserts, ~50 MB/day
- CPU: near zero (simple indicator math, no heavy computation)
- Disk: nothing stored locally — all data goes to Supabase
- Uptime: must run 24/7; WebSocket reconnect stability is critical
- No inbound public IP required — script is purely an outbound client

---

## Option 1: AWS Lightsail

Lightsail is AWS's simplified VPS product. Pricing bundles compute + storage + transfer into a flat monthly fee with no hidden costs.

### Pricing tiers

| Plan | Monthly | RAM | vCPU | Storage | Bundled transfer (out) |
|---|---|---|---|---|---|
| $3.50 | $3.50 | 512 MB | 2 | 20 GB SSD | 1 TB |
| **$5.00** | $5.00 | 512 MB | 2 | 20 GB SSD | 1 TB |
| **$7.00** | $7.00 | 1 GB | 2 | 40 GB SSD | 2 TB |
| **$10.00** | $10.00 | 2 GB | 2 | 60 GB SSD | 3 TB |
| $20.00 | $20.00 | 4 GB | 2 | 80 GB SSD | 4 TB |
| $40.00 | $40.00 | 8 GB | 2 | 160 GB SSD | 5 TB |

Notes:
- $3.50 plan is IPv6-only — works for outbound clients but some endpoints have limited IPv6 support; avoid for production
- Inbound data transfer is always free (Binance stream inbound is not charged)
- Overage on bundled transfer: $0.09/GB — irrelevant for this workload (minimal outbound)
- No separate EBS charge unlike raw EC2
- x86 architecture — full npm ecosystem compatibility, no ARM gotchas

### AWS Free Tier

As of July 15, 2025, AWS changed free tier terms:
- Accounts created **before** July 15, 2025: 12 months of t2.micro (1 GB RAM, EC2)
- Accounts created **after** July 15, 2025: 6 months on newer instance types
- Lightsail also offers 3 months free on select bundles for new accounts

Free tier is useful for initial setup and validation but should not be relied on for production continuity.

### Headroom for trading bots

A typical Node.js trading bot (Polymarket CLOB API, Supabase reads, order execution) uses **100–200 MB RAM** depending on state held in memory.

| Plan | RAM | After scripts (~300 MB) | Bot capacity |
|---|---|---|---|
| $7/mo | 1 GB | ~700 MB free | 2–3 simple bots, tight |
| **$10/mo** | **2 GB** | **~1.7 GB free** | **5–8 bots comfortably** |
| $20/mo | 4 GB | ~3.7 GB free | 10+ bots, very comfortable |
| $40/mo | 8 GB | ~7.7 GB free | Same RAM as Contabo's $5 plan |

### Strengths

- Enterprise-grade network — predictable routing for persistent WebSocket connections
- No freeze incidents on record
- Flat pricing, no billing surprises
- Scales linearly with clear upgrade path

### Weaknesses

- RAM costs money — $40/mo to reach 8 GB (vs Contabo's $5/mo)
- Support is self-serve (documentation + community); no phone/chat for low tiers

---

## Option 2: Contabo Cloud VPS

Contabo is a budget European provider with US data centres. Known for extremely high RAM-per-dollar ratios.

### Pricing tiers

| Plan | Monthly | RAM | vCPU | Storage | Transfer |
|---|---|---|---|---|---|
| **VPS 10** | ~$4.95 | 8 GB | 4 | 75 GB NVMe | Unlimited (fair use) |
| VPS 20 | ~$7.95 | 12 GB | 6 | 200 GB SSD | Unlimited |
| VPS 30 | ~$13.95 | 16 GB | 8 | 300 GB NVMe | Unlimited |

Notes:
- One-time setup fee: ~$5.36 USD on monthly contracts (waived on quarterly/annual)
- "Unlimited" traffic is subject to a fair use policy; guaranteed minimum port speed is 200 Mbps
- KVM virtualisation; x86 AMD EPYC processors
- Three US locations: Central, East, West

### Reliability concerns (documented)

- **2024 server freeze incident**: widespread ZRAM/swap bug caused servers to freeze, requiring manual reboots by Contabo staff or customers. Bug was patched but required intervention.
- **February 2026**: disruption in US Central Object Storage and Auto Backup services.
- **Community reputation**: mixed — many users report years of stable operation; others report intermittent network routing issues and slow support (10+ hour ticket response times).
- **VPSBenchmarks December 2025**: rated Cloud VPS 10 an "E" grade for web performance and stability.
- Support is not 24/7 fast-response. If a server freezes at 3am, it may stay down until a ticket is resolved.

### Mitigation

With `systemd Restart=always` + `pm2`, crashes and normal reboots are handled automatically. The documented freeze issue (needing manual reboot) is the hard case that `systemd` cannot solve — it requires SSH access and manual intervention.

### Strengths

- Extraordinary RAM-per-dollar: 8 GB for $4.95/mo
- Unlimited traffic — no transfer billing concerns
- Adding more trading bots costs nothing in RAM headroom

### Weaknesses

- Network routing variability reported by multiple users
- Slow support — not acceptable if a trading bot has open positions during an outage
- Freeze incidents require manual intervention, not just auto-restart

---

## Cost Comparison at Scale

This table shows where Contabo's value proposition becomes compelling:

| Workload | AWS Lightsail | Contabo VPS 10 |
|---|---|---|
| Scripts only | $7/mo (1 GB) | $5/mo (8 GB) |
| Scripts + 3 bots | $10/mo (2 GB) | $5/mo (8 GB) |
| Scripts + 8 bots | $20/mo (4 GB) | $5/mo (8 GB) |
| Scripts + 20 bots | **$40/mo (8 GB)** | **$5/mo (8 GB)** |

At low scale, AWS and Contabo are within $2–5/month of each other. At high scale (8+ GB RAM), Contabo is 8× cheaper for equivalent RAM.

---

## Decision

**AWS Lightsail $10/mo to start.**

Rationale:

1. **$10/mo (2 GB RAM) covers the current scripts plus 5–8 trading bots** — enough headroom for the near-term roadmap without paying for unused capacity.

2. **Reliability matters more for trading bots than for data collectors.** A collector going down for 2 hours loses some data rows — annoying but recoverable. A trading bot going down mid-position with no monitoring is a real financial risk. AWS's enterprise network and absence of freeze incidents justify the premium at this stage.

3. **Lightsail's flat pricing has no billing surprises.** Inbound transfer is free, bundled outbound is more than enough, no separate EBS charge.

4. **Revisit Contabo when running 5+ stable, tested bots.** Once the workload is well understood, `systemd` auto-restart configs are in place, and RAM demand justifies 8 GB, the $30–35/month AWS cost difference becomes meaningful. Contabo's risk profile is more acceptable for a mature, monitored production system than for active development.

---

## Recommended Setup on AWS Lightsail

1. Launch a **$10/mo Lightsail instance** (2 GB RAM, Ubuntu 24.04 LTS)
2. Install Node.js via `nvm`
3. Clone the repo, install dependencies, create `.env` with Supabase + API keys
4. Run the combined collector script under **`pm2`** with `pm2 startup` so it auto-restarts on reboot
5. Add a `cron` entry or use `node-cron` inside the script to trigger the PolyBackTest sync every 8 hours
6. Monitor via `pm2 logs` and the script's built-in 60-second heartbeat output

If you later need more RAM (e.g. 10+ bots), upgrade to the $20/mo plan in the Lightsail console — takes ~2 minutes with no data loss.
