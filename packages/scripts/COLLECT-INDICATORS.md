# BTC Indicator Collector

Long-running Node.js process that connects to Binance, computes BTC price indicators every second, and writes them to Supabase.

## Prerequisites

1. **Environment variables** in `packages/scripts/.env`:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SECRET_KEY=your-service-role-key
   ```

2. **Supabase table** — run this once in the Supabase SQL editor:
   ```sql
   CREATE TABLE btc_indicator_snapshots (
     id BIGSERIAL PRIMARY KEY,
     recorded_at TIMESTAMPTZ NOT NULL,
     btc_mid NUMERIC,
     obi NUMERIC,
     cvd_5m NUMERIC,
     rsi NUMERIC,
     macd_histogram NUMERIC,
     ema5 NUMERIC,
     ema20 NUMERIC,
     vwap NUMERIC,
     ha_streak INTEGER,
     poc NUMERIC,
     bid_walls INTEGER,
     ask_walls INTEGER,
     bbands_pct_b NUMERIC,
     flow_toxicity NUMERIC,
     roc NUMERIC,
     bias_score NUMERIC,
     bias_signal TEXT,
     UNIQUE(recorded_at)
   );

   CREATE INDEX idx_indicator_snapshots_time ON btc_indicator_snapshots(recorded_at);
   ```

## Running

```bash
pnpm collectind
```

The script runs indefinitely until you stop it with `Ctrl+C`.

## What it does

1. **Bootstraps** 100 historical 1-minute candles from Binance REST (so indicators like RSI and MACD have data immediately)
2. **Opens a single WebSocket** to Binance with three combined streams:
   - `btcusdt@depth20@100ms` — top-20 orderbook, pushed every 100ms
   - `btcusdt@trade` — every individual trade in real-time
   - `btcusdt@kline_1m` — 1-minute candle updates
3. **Every 1 second**, computes a snapshot of all 12 indicators + composite bias score
4. **Upserts** that snapshot to the `btc_indicator_snapshots` table (conflict on `recorded_at`, so restarts don't create duplicates)

## What gets stored per row

| Column | Type | Description |
|--------|------|-------------|
| `recorded_at` | timestamptz | Timestamp rounded to the second |
| `btc_mid` | numeric | Orderbook mid price (best bid + best ask) / 2 |
| `obi` | numeric | Order Book Imbalance (-1 to +1) |
| `cvd_5m` | numeric | Cumulative Volume Delta over last 5 minutes (BTC qty) |
| `rsi` | numeric | RSI(14) value (0–100), null if <15 candles |
| `macd_histogram` | numeric | MACD histogram (12/26/9), null if <35 candles |
| `ema5` | numeric | EMA(5) of close prices |
| `ema20` | numeric | EMA(20) of close prices |
| `vwap` | numeric | Volume-Weighted Average Price |
| `ha_streak` | integer | Heikin Ashi streak (positive = green, negative = red) |
| `poc` | numeric | Point of Control price (volume profile peak) |
| `bid_walls` | integer | Count of bid levels >= 5× median qty |
| `ask_walls` | integer | Count of ask levels >= 5× median qty |
| `bbands_pct_b` | numeric | Bollinger Bands %B (0–1, price position in band) |
| `flow_toxicity` | numeric | Signed flow toxicity (-1 to +1, informed flow imbalance) |
| `roc` | numeric | Rate of Change % over 10 candles |
| `bias_score` | numeric | Composite bias (-100 to +100) |
| `bias_signal` | text | BULLISH, NEUTRAL, or BEARISH |

**18 indicator columns per row, 1 row per second.**

## Data volume

| Period | Rows | Approx size |
|--------|------|-------------|
| 1 hour | 3,600 | ~1.5 MB |
| 1 day | 86,400 | ~30 MB |
| 1 week | 604,800 | ~210 MB |
| 1 month | ~2,592,000 | ~900 MB |

Supabase free tier allows 500 MB database. If running 24/7, you'll want to either prune old data or be on a paid plan.

## How often to run it

**It should run continuously.** It's designed as an always-on process, not a periodic job. The script:

- Auto-reconnects to Binance on disconnection (exponential backoff, 2s → 30s max)
- Logs a heartbeat every 60 seconds with mid price, snapshot count, error count, and buffer sizes
- Handles `SIGINT`/`SIGTERM` for clean shutdown
- Uses upsert with `recorded_at` uniqueness — safe to restart at any time without duplicates

**If the script is not running, no data is collected.** There's no way to backfill OBI, CVD, Walls, or Flow Toxicity historically since those require live orderbook and trade streams. The kline-based indicators (RSI, MACD, EMA, VWAP, HA, POC, BBands, ROC) can be backfilled from Binance REST, but that's a separate operation.

## Monitoring

Watch the console output. Every 60 seconds you'll see:

```
[14:30:00] Heartbeat — mid: $97,432.15 | snapshots: 3600 | errors: 0 | trades buffered: 2841 | klines: 150 | last: 2026-02-17T14:30:00.000Z
```

If `errors` climbs or `mid` shows "waiting", something is wrong with the Binance connection or Supabase credentials.

## Running alongside collect-live

This script is independent from `collect-live.ts` (the Polymarket price collector). You can run both simultaneously — they use different Supabase tables and different WebSocket connections:

```bash
# Terminal 1 — Polymarket prices
pnpm --filter scripts collect

# Terminal 2 — BTC indicators
pnpm collectind
```

## Querying the data

Match indicators to Polymarket 5-minute markets:

```sql
SELECT m.slug, m.outcome, i.*
FROM markets m
JOIN btc_indicator_snapshots i
  ON i.recorded_at BETWEEN m.start_time AND m.end_time
WHERE m.outcome IS NOT NULL
ORDER BY m.start_time, i.recorded_at;
```

This gives ~300 indicator rows per 5-minute market window (1 per second).

## Stopping

`Ctrl+C` — the script logs a summary and exits cleanly:

```
[14:35:12] Shutting down — 312 snapshots written, 0 errors
```
