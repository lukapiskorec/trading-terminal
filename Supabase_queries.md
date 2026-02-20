# Supabase SQL Reference

Useful queries for inspecting and maintaining the trading terminal database.
Run these in the Supabase dashboard → SQL Editor.

---

## Health Checks

### Row counts per day — split by table
```sql
-- price_snapshots: total rows vs unique (market_id, recorded_at) pairs per day
-- If total_rows > unique_pairs, duplicates exist
SELECT
  DATE(recorded_at) AS day,
  COUNT(*) AS total_rows,
  COUNT(DISTINCT (market_id, recorded_at)) AS unique_pairs
FROM price_snapshots
GROUP BY DATE(recorded_at)
ORDER BY day;
```

```sql
-- market_outcomes: how many resolved markets per day
SELECT
  DATE(start_time) AS day,
  COUNT(*) AS outcomes
FROM market_outcomes
GROUP BY DATE(start_time)
ORDER BY day;
```

```sql
-- Total resolved outcomes in the view
SELECT COUNT(*) FROM market_outcomes;
```

---

## Duplicate Detection

### Find duplicate price snapshots
```sql
-- Shows (market_id, recorded_at) pairs with more than one row
-- cnt > 1 means duplicates exist for that timestamp
SELECT market_id, recorded_at, COUNT(*) AS cnt
FROM price_snapshots
GROUP BY market_id, recorded_at
HAVING COUNT(*) > 1
LIMIT 20;
```

### Count duplicates per day
```sql
-- Useful to see which days are affected before deduplication
SELECT
  DATE(recorded_at) AS day,
  COUNT(*) AS total_rows,
  COUNT(DISTINCT (market_id, recorded_at)) AS unique_pairs,
  COUNT(*) - COUNT(DISTINCT (market_id, recorded_at)) AS duplicate_rows
FROM price_snapshots
GROUP BY DATE(recorded_at)
ORDER BY day;
```

---

## Deduplication

### Delete duplicates in safe batches (run repeatedly until rows_deleted = 0)
```sql
-- Keeps the row with the lowest id for each (market_id, recorded_at) pair
-- Uses the existing index for efficient date-scoped scanning
-- LIMIT 10000 prevents statement timeouts — run until rows_deleted returns 0
WITH deleted AS (
  DELETE FROM price_snapshots
  WHERE id IN (
    SELECT id FROM (
      SELECT id,
             ROW_NUMBER() OVER (PARTITION BY market_id, recorded_at ORDER BY id) AS rn
      FROM price_snapshots
      WHERE recorded_at >= '2026-02-17T00:00:00Z'  -- adjust date range as needed
    ) ranked
    WHERE rn > 1
    LIMIT 10000
  )
  RETURNING id
)
SELECT COUNT(*) AS rows_deleted FROM deleted;
```

---

## Schema Maintenance

### Add unique constraint to prevent future duplicate snapshots
```sql
-- Run after deduplication; required for upsert (ignoreDuplicates) in collect-combined
CREATE UNIQUE INDEX idx_snapshots_unique_market_time
  ON price_snapshots(market_id, recorded_at);
```

### Create btc_indicator_snapshots table (if missing from migration)
```sql
CREATE TABLE btc_indicator_snapshots (
  recorded_at    TIMESTAMPTZ PRIMARY KEY,
  btc_mid        NUMERIC(12,2),
  obi            NUMERIC(8,6),
  cvd_5m         NUMERIC(12,4),
  rsi            NUMERIC(6,4),
  macd_histogram NUMERIC(12,6),
  ema5           NUMERIC(12,2),
  ema20          NUMERIC(12,2),
  vwap           NUMERIC(12,2),
  ha_streak      INT,
  poc            NUMERIC(12,2),
  bid_walls      INT,
  ask_walls      INT,
  bbands_pct_b   NUMERIC(8,6),
  flow_toxicity  NUMERIC(8,6),
  roc            NUMERIC(8,6),
  bias_score     NUMERIC(6,2),
  bias_signal    TEXT
);

ALTER TABLE btc_indicator_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous read on btc_indicator_snapshots"
  ON btc_indicator_snapshots FOR SELECT USING (true);

CREATE POLICY "Allow anonymous insert on btc_indicator_snapshots"
  ON btc_indicator_snapshots FOR INSERT WITH CHECK (true);
```

---

## Data Inspection

### Latest BTC indicator snapshots (verify collector is running)
```sql
SELECT recorded_at, btc_mid, bias_signal, bias_score
FROM btc_indicator_snapshots
ORDER BY recorded_at DESC
LIMIT 10;
```

### Latest price snapshots for a specific market
```sql
SELECT recorded_at, mid_price_yes, best_bid_yes, best_ask_yes, source
FROM price_snapshots
WHERE market_id = <id>
ORDER BY recorded_at DESC
LIMIT 20;
```

### Markets for a specific day with outcome status
```sql
SELECT id, slug, start_time, end_time, outcome, volume
FROM markets
WHERE start_time >= '2026-02-19T00:00:00Z'
  AND start_time <  '2026-02-20T00:00:00Z'
ORDER BY start_time;
```

### Markets missing outcomes (should be empty after full sync)
```sql
SELECT id, slug, start_time
FROM markets
WHERE outcome IS NULL
  AND end_time < NOW()  -- only check markets that have already ended
ORDER BY start_time DESC
LIMIT 20;
```

### Snapshot count per market for a given day (spot unusually high counts)
```sql
SELECT market_id, COUNT(*) AS snapshot_count
FROM price_snapshots
WHERE recorded_at >= '2026-02-19T00:00:00Z'
  AND recorded_at <  '2026-02-20T00:00:00Z'
GROUP BY market_id
ORDER BY snapshot_count DESC
LIMIT 20;
```
