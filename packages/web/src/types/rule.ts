export interface TradingRule {
  id: string;
  name: string;
  marketFilter: string; // e.g. "btc-updown-5m-*"
  conditionMode: "AND" | "OR"; // all conditions must match vs. any one
  conditions: Condition[];
  action: {
    type: "BUY" | "SELL";
    outcome: "YES" | "NO";
    amount: number; // USDC
  };
  cooldown: number; // seconds between triggers
  enabled: boolean;
  /** When set, this is a random-decision rule — conditions are ignored */
  randomConfig?: {
    upRatio: number;               // probability of buying YES/UP (0–1)
    triggerAtTimeToClose: number;  // fire when timeToClose ≤ this many seconds
  };
}

export interface Condition {
  field: "priceYes" | "priceNo" | "spread" | "volume" | "timeToClose" | "aoi";
  operator: "<" | ">" | "==" | "between";
  value: number | [number, number];
}
