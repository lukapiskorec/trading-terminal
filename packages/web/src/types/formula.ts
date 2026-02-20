export interface IndicatorFormula {
  id: string;
  name: string;
  timeWindow: "5min" | "15min";
  /** [leftFrac, rightFrac] per indicator, each in [0,1].
   *  leftFrac=0 = leftmost grid column (highest time-to-close). */
  sliderPositions: [number, number][]; // 12 entries
  /** Weight per indicator; 0 = disabled. Can be negative. */
  indicatorWeights: number[]; // 12 entries
  aggregation: "trimmed" | "median";
  /** Transient: computed from current heatmap state. Stripped from persistence. */
  outputValue?: number;
}

export const INDICATOR_LABELS = [
  "OBI",
  "CVD",
  "RSI",
  "MACD",
  "EMA Cross",
  "VWAP",
  "HA Streak",
  "POC",
  "Walls",
  "BBands %B",
  "Flow Toxic",
  "ROC",
] as const;
