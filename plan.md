# Trading Terminal — Project Plan

## 1. Recommended Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| **Frontend** | Vite + React 19 | SPA — no SSR needed. Fastest dev server, largest ecosystem for trading UIs |
| **Charting** | TradingView [lightweight-charts](https://github.com/tradingview/lightweight-charts) | 45 KB, Canvas-based, 60fps with thousands of data points, native real-time `series.update()` API. Purpose-built for financial data |
| **Secondary charts** | Recharts | Portfolio pie charts, P&L bar charts — SVG-based, React-native |
| **State management** | Zustand | ~1 KB, works outside React (critical for WebSocket handlers), built-in `persist` middleware |
| **Database** | [Supabase](https://supabase.com/) (PostgreSQL) | Cloud-hosted. Native SQL aggregations (`AVG`, `GROUP BY`, window functions) — critical for AOI calculations. No per-query billing. Free tier: 500 MB |
| **Styling** | TailwindCSS v4 + [shadcn/ui](https://ui.shadcn.com/) | Utility-first, dark mode out of the box, accessible component primitives |
| **Backtesting** | Web Workers | Runs in browser, keeps UI responsive, no backend compute needed |
| **Backend proxy** | [Hono](https://hono.dev/) on Node.js | ~50 LOC. Needed to bypass CORS on Polymarket REST APIs. Built-in CORS middleware, TypeScript-first |
| **Dev tooling** | pnpm workspaces + concurrently | Monorepo. Single `pnpm dev` starts Vite + proxy |
| **Language** | TypeScript throughout | Type safety for financial data, shared types between proxy and client |

### Why Supabase over Firebase

Both were evaluated. Supabase wins for analytics workloads:

| Concern | Supabase | Firebase (Firestore) |
|---|---|---|
| **Aggregation queries** | Native SQL: `SELECT AVG(outcome) FROM markets WHERE ...` — computed server-side, only the result travels over the wire | No server-side aggregation. Must fetch all documents to client, aggregate in JS. `count()`/`average()` exist but have 60s timeout and still bill for scanned entries |
| **Cost model** | Pay for storage + compute. Query 8,640 rows 100 times = $0 | Pay per read. Query 288 markets = 288 reads. Dashboard page load with prices = ~8,640 reads. Free tier (50k reads/day) exhausted in ~6 page loads |
| **Free tier** | 500 MB storage, 2 GB egress/month. ~4 months of data at our volume | 1 GB storage, but 50k reads/day is the real bottleneck |
| **Estimated monthly cost** | $0 for months 1-4. $25/month Pro after that | ~$10-25/month from day 1 due to read costs |
| **Time-series queries** | B-tree indexes on timestamps. Optional TimescaleDB extension | Range queries return full documents. No JOIN, no GROUP BY |
| **JOINs** | Yes — `markets JOIN prices ON market_id` | No. Must denormalize or do client-side joins |
| **Lock-in risk** | Standard PostgreSQL — migrate to any managed Postgres | Proprietary Firestore format |

**Supabase also provides:** Real-time subscriptions (subscribe to table INSERT/UPDATE via WebSocket), Row-Level Security, auto-generated TypeScript types from schema, `@supabase/supabase-js` SDK.

**Caveat:** Free tier pauses after 7 days of inactivity — solvable with a weekly cron ping (GitHub Actions).

### Why a proxy is needed

Polymarket's REST APIs (`clob.polymarket.com`, `gamma-api.polymarket.com`) do not set permissive CORS headers for arbitrary browser origins. The community [polymarket-kit](https://github.com/HuakunShen/polymarket-kit) project exists specifically to solve this with a proxy. Our proxy is ~50 lines — zero state, zero database, just request forwarding + CORS headers. WebSocket connections (`wss://`) are **not** subject to CORS and can connect directly from the browser.

---

## 2. File Structure

```
trading-terminal/
├── package.json                    # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json              # shared TS config
│
├── packages/
│   ├── proxy/                      # Hono proxy server
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── index.ts            # ~50 lines: CORS proxy to Polymarket APIs
│   │
│   ├── scripts/                    # Data collection & seeding scripts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── seed-feb13.ts       # Fetch & store Feb 13 historical data
│   │       ├── collect-live.ts     # Real-time WebSocket data collector
│   │       └── utils/
│   │           ├── polymarket.ts   # Polymarket API helpers
│   │           └── supabase.ts     # DB insert helpers
│   │
│   └── web/                        # Vite + React SPA
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── index.html
│       └── src/
│           ├── main.tsx            # app entry
│           ├── App.tsx             # router + layout shell
│           │
│           ├── components/
│           │   ├── layout/
│           │   │   ├── Sidebar.tsx
│           │   │   ├── Header.tsx
│           │   │   └── Shell.tsx
│           │   ├── dashboard/
│           │   │   ├── MarketCard.tsx
│           │   │   ├── MarketGrid.tsx
│           │   │   └── PriceChart.tsx
│           │   ├── analytics/
│           │   │   ├── AOIChart.tsx         # Average Outcome Index line chart
│           │   │   ├── PriceOverlay.tsx     # All 288 markets on one chart
│           │   │   ├── OutcomeTimeline.tsx  # Green/red arrow timeline
│           │   │   ├── MarketStats.tsx      # Summary statistics
│           │   │   └── TradingHours.tsx     # US/Asia session markers
│           │   ├── trading/                 # (Phase 5 — later)
│           │   │   ├── OrderPanel.tsx
│           │   │   ├── PositionList.tsx
│           │   │   └── TradeHistory.tsx
│           │   ├── rules/
│           │   │   ├── RuleEditor.tsx
│           │   │   ├── RuleList.tsx
│           │   │   └── RuleStatus.tsx
│           │   ├── backtest/
│           │   │   ├── BacktestConfig.tsx
│           │   │   ├── BacktestResults.tsx
│           │   │   └── BacktestChart.tsx
│           │   └── ui/             # shadcn/ui components
│           │       ├── button.tsx
│           │       ├── card.tsx
│           │       └── ...
│           │
│           ├── pages/
│           │   ├── Dashboard.tsx
│           │   ├── Analytics.tsx       # AOI charts, price overlay, timeline
│           │   ├── Trade.tsx           # (Phase 5)
│           │   ├── Rules.tsx
│           │   └── Backtest.tsx
│           │
│           ├── stores/
│           │   ├── marketStore.ts      # live prices, order books
│           │   ├── portfolioStore.ts   # virtual balance, positions (Phase 5)
│           │   ├── tradeStore.ts       # trade history (Phase 5)
│           │   └── rulesStore.ts       # trading rule definitions
│           │
│           ├── lib/
│           │   ├── api.ts              # REST client (via proxy)
│           │   ├── ws.ts               # WebSocket manager
│           │   ├── supabase.ts         # Supabase client init + typed queries
│           │   ├── rulesEngine.ts      # evaluates rules on price updates
│           │   ├── fees.ts             # Polymarket fee calculation
│           │   ├── aoi.ts              # AOI calculation helpers
│           │   └── constants.ts
│           │
│           ├── workers/
│           │   └── backtest.worker.ts  # Web Worker for backtesting
│           │
│           └── types/
│               ├── market.ts
│               ├── trade.ts
│               ├── rule.ts
│               └── backtest.ts
│
└── CLAUDE.md
```

---

## 3. Design Considerations

### 3.1 Market Thesis

**Starting hypothesis:** BTC 5-minute Up/Down markets should resolve Up/Down with approximately 50/50 probability over time — essentially a coin flip at the 5-minute scale.

**Why this matters:** If the distribution deviates significantly from 50/50, that's a measurable market inefficiency. Possible causes:
- **Momentum bias** — BTC trends intraday, so consecutive markets may cluster (runs of Up or runs of Down)
- **Time-of-day effects** — US market open (9:30 AM ET), Asia open (9:00 PM ET) may create directional pressure
- **Sentiment/news** — macro events create multi-hour directional moves
- **Market maker pricing** — if makers systematically misprice one side

**What we're building to test:**
- AOI indicators reveal whether Up/Down is actually 50/50 across different time windows
- The outcome timeline reveals clustering patterns (runs, streaks)
- Trading hours overlay tests time-of-day effects
- Backtesting validates whether any observed pattern is tradeable after fees

**If the hypothesis is wrong** (and it probably is — that's the opportunity), the analytics dashboard should make the specific nature of the inefficiency visible and quantifiable.

### 3.2 Polymarket API Integration

**Three APIs, two protocols:**

| API | Base URL | Purpose | Access |
|---|---|---|---|
| **Gamma API** | `https://gamma-api.polymarket.com` | Market discovery, metadata, event listings | Via proxy |
| **CLOB API** | `https://clob.polymarket.com` | Prices, order books, historical data, fee rates | Via proxy |
| **CLOB WebSocket** | `wss://ws-subscriptions-clob.polymarket.com/ws/market` | Real-time prices, trades, book updates | Direct from browser |

**Key endpoints we use:**

| Endpoint | Use |
|---|---|
| `GET gamma/events?slug=btc-updown-5m-{ts}` | Get specific BTC 5-min market by timestamp |
| `GET gamma/markets?closed=true&limit=100` | List resolved markets for historical data |
| `GET clob/prices-history?market=X&fidelity=1` | Historical prices (1-min resolution — finest available) |
| `GET clob/book?token_id=X` | Order book snapshot for a market |
| `GET clob/midpoint?token_id=X` | Current midpoint price |
| `GET clob/fee-rate-bps?token_id=X` | Fee rate for accurate trade simulation |
| `WSS /ws/market` (subscribe with asset IDs) | Live `price_change`, `last_trade_price`, `book` events |

### 3.3 Data Collection Strategy

#### Historical data: Feb 13, 2026 (288 markets)

**Goal:** Populate Supabase with price data for all 288 BTC 5-min markets from Feb 13, 2026.

**Challenge:** The `prices-history` endpoint's finest granularity is `fidelity=1` (1-minute). For a 5-minute market, that gives us only ~5 data points per market — not the 30 we want at 10-second intervals.

**Two-tier approach:**

| Tier | Source | Granularity | Data points/market | Use |
|---|---|---|---|---|
| **Tier 1 (guaranteed)** | `GET clob/prices-history?fidelity=1` | 1 minute | ~5 | Price chart, AOI calculation, outcome verification |
| **Tier 2 (best-effort)** | Data API `/trades` + reconstruction | Per-trade | Varies (depends on trading activity) | Higher-resolution price curves where trade data exists |

**Tier 1 collection script** (`scripts/seed-feb13.ts`):
1. Generate all 288 slugs for Feb 13: `btc-updown-5m-{ts}` where `ts` = 1739404800 + (i * 300) for i=0..287
2. Fetch market metadata from Gamma API (condition_id, token_ids, outcomes, resolution)
3. For each market's YES token, fetch `prices-history` with `startTs`/`endTs` set to the 5-min window, `fidelity=1`
4. Insert into Supabase
5. Rate limiting: batch requests with 100ms delays (well within 350/10s Gamma limit, 1500/10s CLOB limit)

**Tier 2 enhancement** (if trade data is accessible):
1. Fetch individual trades from Data API for each market's condition_id
2. Bucket trades into 10-second intervals, take last trade price per bucket
3. Backfill the `price_snapshots` table with finer-grained data

**Estimated data volume for Feb 13:**
- Tier 1: 288 markets × 5 price points = 1,440 rows + 288 metadata rows ≈ 0.5 MB
- Tier 2: 288 markets × ~30 points = ~8,640 rows ≈ 3 MB
- With indexes: ~5 MB total — trivial for Supabase's 500 MB free tier

#### Real-time collection (going forward)

For future data at true 10-second resolution, a **WebSocket collector script** (`scripts/collect-live.ts`):
1. Connect to `wss://ws-subscriptions-clob.polymarket.com/ws/market`
2. At each 5-min boundary, subscribe to the new market's token IDs
3. Capture `price_change` and `last_trade_price` events
4. Every 10 seconds, snapshot current best bid/ask into Supabase
5. After market closes, record final resolution
6. Runs as a long-lived Node.js process (can be deployed to a cheap VPS or run locally)

**Connection limits:** Max 500 assets per WebSocket connection. Since we only track ~1 active market at a time (2 tokens), a single connection is sufficient.

### 3.4 Supabase Schema

```sql
-- Market metadata
CREATE TABLE markets (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,           -- btc-updown-5m-1739404800
  condition_id TEXT NOT NULL,
  token_id_yes TEXT NOT NULL,
  token_id_no TEXT NOT NULL,
  question TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  outcome TEXT,                        -- 'Up', 'Down', or NULL if unresolved
  outcome_yes_price NUMERIC(4,2),      -- 1.00 or 0.00 after resolution
  volume NUMERIC(12,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_markets_start ON markets(start_time);
CREATE INDEX idx_markets_slug ON markets(slug);

-- Price snapshots (L1 data: best bid/ask/mid)
CREATE TABLE price_snapshots (
  id BIGSERIAL PRIMARY KEY,
  market_id INT NOT NULL REFERENCES markets(id),
  recorded_at TIMESTAMPTZ NOT NULL,
  mid_price_yes NUMERIC(6,4),          -- 0.0000 to 1.0000
  best_bid_yes NUMERIC(6,4),
  best_ask_yes NUMERIC(6,4),
  last_trade_price NUMERIC(6,4),
  source TEXT DEFAULT 'api'            -- 'api' (historical) or 'ws' (live collected)
);

CREATE INDEX idx_snapshots_market_time ON price_snapshots(market_id, recorded_at);

-- Pre-computed daily/hourly aggregates (optional, for fast dashboard queries)
CREATE VIEW market_outcomes AS
SELECT
  m.id, m.slug, m.start_time, m.end_time, m.outcome,
  CASE WHEN m.outcome = 'Up' THEN 1 ELSE 0 END AS outcome_binary,
  m.volume
FROM markets m
WHERE m.outcome IS NOT NULL
ORDER BY m.start_time;
```

**Key queries for analytics:**

```sql
-- AOI-N: Average Outcome Index for last N markets
SELECT AVG(outcome_binary) AS aoi
FROM (
  SELECT outcome_binary FROM market_outcomes
  ORDER BY start_time DESC LIMIT :n
) sub;

-- All price curves for a date (for overlay chart)
SELECT ps.market_id, ps.recorded_at, ps.mid_price_yes
FROM price_snapshots ps
JOIN markets m ON ps.market_id = m.id
WHERE m.start_time::date = '2026-02-13'
ORDER BY ps.market_id, ps.recorded_at;

-- Outcome timeline for a date
SELECT start_time, outcome FROM markets
WHERE start_time::date = '2026-02-13'
ORDER BY start_time;

-- Running AOI-12 across a day (window function)
SELECT
  start_time, outcome,
  AVG(outcome_binary) OVER (ORDER BY start_time ROWS BETWEEN 11 PRECEDING AND CURRENT ROW) AS aoi_12
FROM market_outcomes
WHERE start_time::date = '2026-02-13';
```

### 3.5 Analytics Charts (First Priority)

#### AOI — Average Outcome Index

The AOI-N is a rolling average of the last N market outcomes, where Up=1 and Down=0. It measures directional bias over different time horizons.

| Indicator | Window | Time span | What it reveals |
|---|---|---|---|
| **AOI-1** | 1 market | 5 min | Raw outcome (Up=1.0, Down=0.0) — the baseline |
| **AOI-6** | 6 markets | 30 min | Short-term momentum — are we in a micro-trend? |
| **AOI-12** | 12 markets | 1 hour | Hourly directional bias |
| **AOI-144** | 144 markets | 12 hours | Half-day trend — morning vs afternoon |
| **AOI-288** | 288 markets | 24 hours | Full-day average — how far from 0.50 are we? |

**Chart**: Line chart (TradingView lightweight-charts) with all 5 AOI lines overlaid. X-axis = time, Y-axis = 0.0 to 1.0 with a dashed reference line at 0.50. Values consistently above 0.50 indicate bullish bias; below indicates bearish. The further from 0.50, the stronger the evidence against the 50/50 hypothesis.

#### Price Overlay Chart

**What**: All 288 markets from a day plotted on the same chart, each as a semi-transparent line. X-axis = time within market (0s to 300s), Y-axis = price of YES token (0 to 1).

**Why**: Reveals common price patterns:
- Do prices tend to start near 0.50 and diverge? (efficient opening)
- Is there a typical "shape" to the price curve? (momentum, mean reversion)
- How much variance is there across markets?

**Implementation**: TradingView lightweight-charts with 288 `LineSeries`, each with low opacity (0.1-0.2). Add a thick average line showing the mean price path across all markets. Color-code by outcome (green for Up, red for Down) for visual clustering.

#### Outcome Timeline

**What**: Horizontal timeline spanning 24 hours. Each 5-min slot is marked with an arrow:
- **Green ▲** = Up outcome
- **Red ▼** = Down outcome

**Overlays**:
- **US trading hours** (9:30 AM - 4:00 PM ET) — highlighted zone
- **Asia trading hours** (9:00 PM - 3:00 AM ET / HKT 9:00 AM - 3:00 PM) — highlighted zone
- **Streak indicators** — consecutive same-outcome runs highlighted

**Why**: Visual pattern detection. Makes runs, clustering, and time-of-day effects immediately visible. If BTC 5-min markets were truly 50/50, this should look like random noise. If there are visible patterns (e.g., more green during US open), that's signal.

**Implementation**: Custom React component using SVG or Canvas. Each of the 288 slots is ~3px wide. Hover to see market details.

#### Summary Statistics Panel

For the selected date/range:
- Total Up / Down count and percentage
- Longest streak (Up and Down)
- Chi-squared test p-value for deviation from 50/50
- Autocorrelation at lag-1 (do outcomes predict the next outcome?)
- Win rate by time-of-day bucket (US open, US close, Asia, overnight)

### 3.6 Trading Simulator (Deferred to Phase 5)

The simulator mimics real trading without touching real money:

- **Virtual balance**: Starts with configurable USDC amount (e.g., $1,000)
- **Order execution**: Uses live midpoint or best bid/ask from Polymarket as fill price
- **Fee calculation**: Applies Polymarket's parabolic fee curve: `fee = p * (1 - p) * fee_rate`
  - Peaks at 1.56% at p=0.50, drops to ~0.30% at extremes
  - Only certain markets have fees (BTC 5-min markets do)
- **Position tracking**: Long only (buy YES or NO shares). Positions resolve at $1.00 or $0.00
- **All trades persisted** to Supabase with timestamp, market, side, price, quantity, fees

### 3.7 Trading Rules Engine

Simple rule-based automation evaluated on each price update:

```typescript
interface TradingRule {
  id: string;
  name: string;
  marketFilter: string;         // e.g., "btc-updown-5m-*"
  conditions: Condition[];      // AND-combined
  action: { type: 'BUY' | 'SELL'; outcome: 'YES' | 'NO'; amount: number };
  cooldown: number;             // seconds between triggers
  enabled: boolean;
}

interface Condition {
  field: 'price' | 'spread' | 'volume' | 'timeToClose' | 'aoi';
  operator: '<' | '>' | '==' | 'between';
  value: number | [number, number];
}
```

Execution flow: WebSocket price update → rules engine evaluates all enabled rules → matching rules execute virtual trades → trades recorded to store.

Note: `aoi` as a condition field lets rules act on the directional bias — e.g., "buy YES when AOI-12 < 0.35" (betting on mean reversion after a bearish run).

### 3.8 Backtesting Engine

Runs in a Web Worker to keep UI responsive:

1. **Data source**: Reads from Supabase — all historical markets + price snapshots for the selected date range
2. **Replay**: Worker iterates through markets chronologically, applies trading rules at each price tick
3. **Output**: Trade log, total P&L, win rate, max drawdown, Sharpe ratio
4. **AOI-aware**: Backtest can use AOI-N values as inputs (computed from the historical outcome sequence)

### 3.9 WebSocket Architecture

```
Browser                                    Polymarket
┌──────────────────┐                      ┌──────────────────────────────┐
│  ws.ts manager   │───── wss:// ────────▶│  ws-subscriptions-clob       │
│                  │◀─── book, price,     │  /ws/market                  │
│  On message:     │     last_trade_price │                              │
│  → update store  │     market_resolved  │                              │
│  → eval rules    │                      └──────────────────────────────┘
└──────────────────┘
```

- Single WebSocket connection, subscribe/unsubscribe to asset IDs dynamically
- Auto-reconnect with exponential backoff
- PING heartbeat every 10 seconds (required by Polymarket)
- Connection status indicator in UI

### 3.10 Dark-First UI

Trading terminals are dark. Default to dark theme with:
- Dense data display (tables, numbers, small charts)
- Green/red color coding for Up/Down outcomes and gains/losses
- Responsive but desktop-optimized (primary use case)
- AOI charts use a gradient from red (0.0) through neutral (0.5) to green (1.0)

---

## 4. Step-by-Step Implementation Plan

### Phase 1: Project Scaffolding
1. Initialize pnpm workspace with `packages/web`, `packages/proxy`, and `packages/scripts`
2. Set up Vite + React + TypeScript in `packages/web`
3. Set up Hono proxy in `packages/proxy`
4. Configure TailwindCSS v4 + shadcn/ui
5. Add `concurrently` so `pnpm dev` starts both Vite + proxy
6. Verify proxy forwards a test request to `gamma-api.polymarket.com`

### Phase 2: Database & Data Layer
7. Create Supabase project, set up `markets` and `price_snapshots` tables (schema from §3.4)
8. Create `market_outcomes` view for fast AOI queries
9. Initialize `@supabase/supabase-js` client in the web app
10. Define TypeScript types for markets, snapshots, trades, rules
11. Build REST API client (`lib/api.ts`) for Polymarket endpoints via proxy
12. Create Zustand stores (market, portfolio, rules) wired to Supabase for reads

### Phase 3: Historical Data Seed (Feb 13)
13. Write `scripts/seed-feb13.ts`:
    - Generate 288 slugs for Feb 13 (starting at midnight UTC: `btc-updown-5m-1739404800`)
    - Fetch metadata from Gamma API for each market (batch with rate limiting)
    - Fetch `prices-history` (fidelity=1) for each market's YES token
    - Insert into Supabase `markets` + `price_snapshots`
14. Run the seed script, verify data in Supabase dashboard
15. (Optional Tier 2) Attempt trade-level data reconstruction from Data API `/trades` for finer resolution

### Phase 4: Analytics Dashboard
16. Build app shell — sidebar navigation, dark theme, header with date picker
17. **AOI Chart** (`AOIChart.tsx`):
    - Query Supabase for outcome sequence, compute AOI-1/6/12/144/288 client-side
    - Render 5 lines on TradingView lightweight-charts with 0.50 reference line
18. **Price Overlay Chart** (`PriceOverlay.tsx`):
    - Query all price snapshots for the selected date
    - Render 288 semi-transparent lines (normalized x-axis: 0-300s)
    - Color by outcome (green=Up, red=Down), thick average line
19. **Outcome Timeline** (`OutcomeTimeline.tsx`):
    - Query outcome sequence for the selected date
    - Render horizontal timeline with green ▲ / red ▼ arrows
    - Overlay US trading hours (9:30 AM - 4:00 PM ET) and Asia hours (9:00 AM - 3:00 PM HKT)
    - Highlight consecutive streaks
20. **Summary Stats** (`MarketStats.tsx`):
    - Up/Down counts and percentages
    - Longest streaks, autocorrelation, chi-squared p-value
    - Win rate by session (US open, Asia, overnight)
21. Combine charts into the Analytics page with responsive grid layout

### Phase 5: Trading Simulator
22. Implement virtual portfolio (starting balance, positions, P&L) in Supabase
23. Build `OrderPanel` — buy/sell interface using live prices
24. Implement fee calculation matching Polymarket's curve
25. Build `PositionList` — open positions with live mark-to-market
26. Build `TradeHistory` — table of all executed trades
27. Handle market resolution — auto-settle positions when markets resolve

### Phase 6: Trading Rules
28. Design rule data model and persistence (Supabase `rules` table)
29. Build `RuleEditor` — form UI to create/edit rules (including AOI-based conditions)
30. Build `RuleList` — overview of all rules with enable/disable toggles
31. Implement `rulesEngine.ts` — evaluates rules on each price tick
32. Wire rules engine into WebSocket price update flow
33. Add execution log showing when rules trigger and what trades they made

### Phase 7: Backtesting
34. Build data fetcher — load historical data from Supabase into Web Worker
35. Create backtest Web Worker — accepts strategy config, replays historical data with AOI computation
36. Build `BacktestConfig` — UI to select date range, strategy params
37. Build `BacktestResults` — P&L curve, trade table, summary stats (win rate, drawdown, Sharpe)
38. Build `BacktestChart` — overlay strategy signals on historical price chart

### Phase 8: Live Data Collection & Polish
39. Deploy `scripts/collect-live.ts` — WebSocket collector for real-time 10-sec snapshots
40. Error handling — API failures, WebSocket disconnects, empty states
41. Loading states and skeleton screens
42. Export trade history / analytics as CSV
43. Settings page — starting balance, preferred markets, theme

---

## Appendix A: Polymarket API Quick Reference

### Fee Formula
```
fee_per_share = price * (1 - price) * fee_rate_multiplier
```
| Price | Fee/Share | Effective Rate |
|-------|-----------|----------------|
| 0.05 | $0.003 | 0.30% |
| 0.20 | $0.010 | 1.00% |
| 0.50 | $0.016 | 1.56% (max) |
| 0.80 | $0.010 | 1.00% |
| 0.95 | $0.003 | 0.30% |

### BTC 5-Min Market Slug Pattern
```typescript
// Feb 13, 2026 midnight UTC = 1739404800
// 288 markets: i=0..287, each 300s apart
const baseTs = 1739404800;
const slug = `btc-updown-5m-${baseTs + (i * 300)}`;
```

### WebSocket Subscribe Message
```json
{
  "auth": {},
  "assets_ids": ["<token_id_yes>", "<token_id_no>"],
  "type": "market"
}
```

### Rate Limits (Key Endpoints)
| Endpoint | Limit |
|---|---|
| Gamma `/markets` | 350/10s |
| Gamma `/events` | 500-900/10s |
| CLOB single queries | 1,500/10s |
| CLOB `/prices-history` | 1,500/10s |
| CLOB batch queries | 500/10s |

### Key API URLs
- Gamma API: `https://gamma-api.polymarket.com`
- CLOB API: `https://clob.polymarket.com`
- WebSocket: `wss://ws-subscriptions-clob.polymarket.com/ws/market`
- Docs: `https://docs.polymarket.com`

## Appendix B: Historical Data Resolution

| Source | Granularity | Available for historical? | Notes |
|---|---|---|---|
| `GET /prices-history` (fidelity=1) | 1 minute | Yes | 5 points per 5-min market. Known issue: resolved markets may return empty at fine granularity — use `startTs/endTs` not `interval` |
| Data API `/trades` | Per-trade | Yes | Paginated (max 500/request). Can reconstruct price series from trades |
| CLOB WebSocket | Sub-second | Forward only | Best for live collection. PING every 10s required |
| polymarketdata.co | 1 minute | Yes (if they cover BTC 5-min) | Third-party paid service. 5B+ rows, Parquet/CSV/ClickHouse access |
| Polygon on-chain indexing | Per-block (~2s) | Yes | High effort — requires custom indexer |

**Recommended path:** Start with Tier 1 (prices-history at 1-min) for Feb 13 historical data. This gives us enough to build all analytics charts. Enhance to 10-sec resolution via the live WebSocket collector for future dates.
