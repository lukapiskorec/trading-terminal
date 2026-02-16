/** Virtual trade (Phase 5 — typed here for forward-compatibility) */
export interface Trade {
  id: string;
  marketId: number;
  slug: string;
  side: "BUY" | "SELL";
  outcome: "YES" | "NO";
  price: number;
  quantity: number;
  fee: number;
  total: number; // price * quantity + fee
  timestamp: string; // ISO 8601
  ruleId: string | null; // null = manual trade
}

/** Virtual position */
export interface Position {
  marketId: number;
  slug: string;
  outcome: "YES" | "NO";
  quantity: number;
  avgEntryPrice: number;
  currentPrice: number | null;
  unrealizedPnl: number | null;
}
