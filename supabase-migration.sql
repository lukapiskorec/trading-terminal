-- Trading Terminal: Initial Schema
-- Run this in the Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor)

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

-- Pre-computed view for fast AOI queries
CREATE VIEW market_outcomes AS
SELECT
  m.id, m.slug, m.start_time, m.end_time, m.outcome,
  CASE WHEN m.outcome = 'Up' THEN 1 ELSE 0 END AS outcome_binary,
  m.volume
FROM markets m
WHERE m.outcome IS NOT NULL
ORDER BY m.start_time;

-- Enable Row Level Security (but allow anonymous reads for now)
ALTER TABLE markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous read on markets"
  ON markets FOR SELECT
  USING (true);

CREATE POLICY "Allow anonymous insert on markets"
  ON markets FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow anonymous update on markets"
  ON markets FOR UPDATE
  USING (true);

CREATE POLICY "Allow anonymous read on price_snapshots"
  ON price_snapshots FOR SELECT
  USING (true);

CREATE POLICY "Allow anonymous insert on price_snapshots"
  ON price_snapshots FOR INSERT
  WITH CHECK (true);
