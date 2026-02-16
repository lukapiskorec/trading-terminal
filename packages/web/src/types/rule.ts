export interface TradingRule {
  id: string;
  name: string;
  marketFilter: string; // e.g. "btc-updown-5m-*"
  conditions: Condition[];
  action: {
    type: "BUY" | "SELL";
    outcome: "YES" | "NO";
    amount: number; // USDC
  };
  cooldown: number; // seconds between triggers
  enabled: boolean;
}

export interface Condition {
  field: "price" | "spread" | "volume" | "timeToClose" | "aoi";
  operator: "<" | ">" | "==" | "between";
  value: number | [number, number];
}
