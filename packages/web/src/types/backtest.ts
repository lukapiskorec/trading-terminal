import type { TradingRule } from "./rule";

/** Configuration for a backtest run */
export interface BacktestConfig {
  /** Primary rules to evaluate during replay */
  rules: TradingRule[];
  /** Starting USDC balance */
  startingBalance: number;
  /** Which AOI window to use for rule conditions (e.g. 6, 12) */
  aoiWindow: number;
  /**
   * INDEPENDENT: each rule has its own cooldown, rules don't interact.
   * EXCLUSIVE: when any rule fires, its cooldown blocks all other rules too.
   */
  ruleMode: "INDEPENDENT" | "EXCLUSIVE";
  /**
   * Optional fallback rule that fires at fallbackTriggerTTC if no primary rule
   * fired during the market. Its cooldown then blocks all rules going forward.
   */
  fallbackRule: TradingRule | null;
  /** Time-to-close threshold (seconds) at which the fallback triggers */
  fallbackTriggerTTC: number;
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
  timeToClose?: number; // seconds remaining at time of BUY (undefined for SETTLE)
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
