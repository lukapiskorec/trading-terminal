import { AOI_WINDOWS } from "./constants";
import type { MarketOutcome } from "@/types/market";

export interface AOIPoint {
  time: string; // ISO timestamp (market start_time)
  aoi1: number;
  aoi6: number | null;
  aoi12: number | null;
  aoi144: number | null;
  aoi288: number | null;
}

/**
 * Compute rolling AOI values for all configured windows.
 * Input must be sorted by start_time ascending.
 */
export function computeAOI(outcomes: MarketOutcome[]): AOIPoint[] {
  const bins = outcomes.map((o) => o.outcome_binary);
  const points: AOIPoint[] = [];

  for (let i = 0; i < bins.length; i++) {
    points.push({
      time: outcomes[i].start_time,
      aoi1: bins[i],
      aoi6: rollingAvg(bins, i, 6),
      aoi12: rollingAvg(bins, i, 12),
      aoi144: rollingAvg(bins, i, 144),
      aoi288: rollingAvg(bins, i, 288),
    });
  }

  return points;
}

/** Rolling average ending at index i with window size n. Returns null if not enough data. */
function rollingAvg(arr: number[], i: number, n: number): number | null {
  if (i < n - 1) return null;
  let sum = 0;
  for (let j = i - n + 1; j <= i; j++) sum += arr[j];
  return sum / n;
}

/** Compute a single AOI-N value from the last N outcomes. */
export function computeAOIN(outcomes: MarketOutcome[], n: number): number | null {
  if (outcomes.length < n) return null;
  const slice = outcomes.slice(-n);
  return slice.reduce((s, o) => s + o.outcome_binary, 0) / n;
}

export { AOI_WINDOWS };
