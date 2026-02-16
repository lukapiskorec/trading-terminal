/** Row in the `markets` Supabase table */
export interface Market {
  id: number;
  slug: string;
  condition_id: string;
  token_id_yes: string;
  token_id_no: string;
  question: string | null;
  start_time: string; // ISO 8601 timestamptz
  end_time: string;
  outcome: "Up" | "Down" | null;
  outcome_yes_price: number | null;
  volume: number | null;
  created_at: string;
}

/** Row in the `price_snapshots` Supabase table */
export interface PriceSnapshot {
  id: number;
  market_id: number;
  recorded_at: string; // ISO 8601
  mid_price_yes: number | null;
  best_bid_yes: number | null;
  best_ask_yes: number | null;
  last_trade_price: number | null;
  source: "api" | "ws";
}

/** Row from the `market_outcomes` view */
export interface MarketOutcome {
  id: number;
  slug: string;
  start_time: string;
  end_time: string;
  outcome: "Up" | "Down";
  outcome_binary: number; // 1 = Up, 0 = Down
  volume: number | null;
}

/** Live market state (from WebSocket + REST, held in Zustand) */
export interface LiveMarket {
  slug: string;
  tokenIdYes: string;
  tokenIdNo: string;
  question: string | null;
  startTime: number; // unix seconds
  endTime: number;
  midPrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  lastTradePrice: number | null;
  volume: number | null;
}
