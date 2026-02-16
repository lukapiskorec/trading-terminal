import type { TradingRule } from "./rule";

/** Configuration for a backtest run */
export interface BacktestConfig {
  /** Rules to evaluate during replay */
  rules: TradingRule[];
  /** Starting USDC balance */
  startingBalance: number;
  /** Which AOI window to use for rule conditions (e.g. 6, 12) */
  aoiWindow: number;
}

/** A single trade executed during backtesting */
export interface BacktestTrade {
  marketId: number;
  slug: string;
  side: "BUY" | "SETTLE";
  outcome: "YES" | "NO";
  price: number;
  quantity: number;
  fee: number;
  total: number;
  pnl: number; // realized P&L for SETTLE trades, 0 for BUY
  ruleId: string;
  ruleName: string;
  timestamp: string; // market start_time
}

/** A point on the equity curve */
export interface EquityPoint {
  time: string; // ISO timestamp
  equity: number; // balance + unrealized
}

/** Summary statistics for a completed backtest */
export interface BacktestStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  totalPnlPct: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
}

/** Complete result of a backtest run */
export interface BacktestResult {
  config: BacktestConfig;
  stats: BacktestStats;
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  marketsProcessed: number;
}

// --- Worker message protocol ---

export type WorkerRequest = {
  type: "run";
  payload: {
    config: BacktestConfig;
    markets: SerializedMarket[];
    snapshots: SerializedSnapshot[];
    outcomes: SerializedOutcome[];
  };
};

export type WorkerResponse =
  | { type: "progress"; percent: number }
  | { type: "done"; result: BacktestResult }
  | { type: "error"; message: string };

/** Minimal market data sent to worker (avoids importing Supabase types) */
export interface SerializedMarket {
  id: number;
  slug: string;
  start_time: string;
  end_time: string;
  outcome: "Up" | "Down" | null;
  volume: number | null;
}

/** Minimal snapshot data sent to worker */
export interface SerializedSnapshot {
  market_id: number;
  recorded_at: string;
  mid_price_yes: number | null;
  best_bid_yes: number | null;
  best_ask_yes: number | null;
}

/** Minimal outcome data sent to worker */
export interface SerializedOutcome {
  id: number;
  slug: string;
  start_time: string;
  outcome: "Up" | "Down";
  outcome_binary: number;
}
