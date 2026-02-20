import { useMemo, useState } from "react";
import type { BtcIndicatorSnapshot, Market, MarketOutcome } from "@/types/market";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface BtcIndicatorHeatmapProps {
  outcomes: MarketOutcome[];
  markets: Market[];
  btcIndicators: BtcIndicatorSnapshot[];
  loading: boolean;
  date: string;
}

type OutcomeFilter = "UP" | "DOWN";
type AvgMethod = "mean" | "median" | "trimmed";

// --- Indicator definitions ---

interface IndicatorDef {
  label: string;
  extract: (s: BtcIndicatorSnapshot) => number | null;
  normalize: "static" | "dynamic";
  // Static normalization: clamp(raw, -1, 1)
  // Dynamic: use day-level p5/p95 percentile scaling
}

const INDICATORS: IndicatorDef[] = [
  {
    label: "OBI",
    extract: (s) => s.obi,
    normalize: "static",
  },
  {
    label: "CVD",
    extract: (s) => s.cvd_5m,
    normalize: "dynamic",
  },
  {
    label: "RSI",
    extract: (s) => (s.rsi !== null ? (50 - s.rsi) / 50 : null),
    normalize: "static",
  },
  {
    label: "MACD",
    extract: (s) => s.macd_histogram,
    normalize: "dynamic",
  },
  {
    label: "EMA Cross",
    extract: (s) => (s.ema5 !== null && s.ema20 !== null ? s.ema5 - s.ema20 : null),
    normalize: "dynamic",
  },
  {
    label: "VWAP",
    extract: (s) => (s.btc_mid !== null && s.vwap !== null && s.btc_mid !== 0 ? (s.btc_mid - s.vwap) / s.btc_mid : null),
    normalize: "dynamic",
  },
  {
    label: "HA Streak",
    extract: (s) => (s.ha_streak !== null ? s.ha_streak / 3 : null),
    normalize: "static",
  },
  {
    label: "POC",
    extract: (s) => (s.btc_mid !== null && s.poc !== null && s.btc_mid !== 0 ? (s.btc_mid - s.poc) / s.btc_mid : null),
    normalize: "dynamic",
  },
  {
    label: "Walls",
    extract: (s) => {
      if (s.bid_walls === null || s.ask_walls === null) return null;
      const total = Math.max(s.bid_walls + s.ask_walls, 1);
      return (s.bid_walls - s.ask_walls) / total;
    },
    normalize: "static",
  },
  {
    label: "BBands %B",
    extract: (s) => (s.bbands_pct_b !== null ? (0.5 - s.bbands_pct_b) / 0.5 : null),
    normalize: "static",
  },
  {
    label: "Flow Toxic",
    extract: (s) => s.flow_toxicity,
    normalize: "static",
  },
  {
    label: "ROC",
    extract: (s) => s.roc,
    normalize: "dynamic",
  },
];

const NUM_INDICATORS = INDICATORS.length; // 12
const NUM_COLS = 300;

// --- Color function ---

function valueToColor(v: number): string {
  if (isNaN(v)) return "transparent";
  const c = Math.max(-1, Math.min(1, v));
  if (c >= 0) {
    const t = c;
    return `rgb(${Math.round(255 * t)},${Math.round(26 * t)},${Math.round(20 + 197 * t)})`;
  } else {
    const t = -c;
    return `rgb(${Math.round(15 * (1 - t))},${Math.round(8 + 232 * t)},${Math.round(20 + 235 * t)})`;
  }
}

// --- Stats helpers ---

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function mean(vals: number[]): number {
  if (vals.length === 0) return NaN;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function median(vals: number[]): number {
  if (vals.length === 0) return NaN;
  const sorted = [...vals].sort((a, b) => a - b);
  return percentile(sorted, 0.5);
}

function trimmedMean(vals: number[], pct = 0.1): number {
  if (vals.length === 0) return NaN;
  const sorted = [...vals].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length * pct);
  const trimmed = sorted.slice(cut, sorted.length - cut);
  return trimmed.length === 0 ? NaN : mean(trimmed);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function BtcIndicatorHeatmap({ outcomes, markets, btcIndicators, loading, date }: BtcIndicatorHeatmapProps) {
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("UP");
  const [avgMethod, setAvgMethod] = useState<AvgMethod>("mean");

  // Build unix-second → snapshot lookup
  const btcMap = useMemo(() => {
    const map = new Map<number, BtcIndicatorSnapshot>();
    for (const s of btcIndicators) {
      const sec = Math.floor(new Date(s.recorded_at).getTime() / 1000);
      map.set(sec, s);
    }
    return map;
  }, [btcIndicators]);

  // Compute day-level percentile bounds for dynamic indicators (once per load)
  const dynamicBounds = useMemo(() => {
    // For each dynamic indicator: sorted non-null extracted values across the full day
    return INDICATORS.map((ind) => {
      if (ind.normalize !== "dynamic") return { p5: 0, p95: 1 };
      const vals: number[] = [];
      for (const s of btcIndicators) {
        const v = ind.extract(s);
        if (v !== null && isFinite(v)) vals.push(v);
      }
      if (vals.length < 2) return { p5: 0, p95: 1 };
      vals.sort((a, b) => a - b);
      return { p5: percentile(vals, 0.05), p95: percentile(vals, 0.95) };
    });
  }, [btcIndicators]);

  const heatmapGrid = useMemo(() => {
    // Filter markets to selected outcome
    const targetBinary = outcomeFilter === "UP" ? 1 : 0;
    const outcomeMap = new Map<number, number>();
    for (const o of outcomes) {
      outcomeMap.set(o.id, o.outcome_binary);
    }

    const filteredMarkets = markets.filter((m) => {
      const o = outcomes.find((o) => o.slug === m.slug);
      return o !== undefined && o.outcome_binary === targetBinary;
    });

    if (filteredMarkets.length === 0) return null;

    // rawBuckets[indIdx][col] = array of normalized values
    const rawBuckets: number[][][] = Array.from({ length: NUM_INDICATORS }, () =>
      Array.from({ length: NUM_COLS }, () => [])
    );

    for (const market of filteredMarkets) {
      const marketStartSec = Math.floor(new Date(market.start_time).getTime() / 1000);

      for (let t = 0; t < NUM_COLS; t++) {
        const snapshot = btcMap.get(marketStartSec + t);
        if (!snapshot) continue;

        const col = NUM_COLS - 1 - t; // timeToClose: 299s at col 0, 0s at col 299

        for (let i = 0; i < NUM_INDICATORS; i++) {
          const ind = INDICATORS[i];
          const raw = ind.extract(snapshot);
          if (raw === null || !isFinite(raw)) continue;

          let normalized: number;
          if (ind.normalize === "static") {
            normalized = clamp(raw, -1, 1);
          } else {
            const { p5, p95 } = dynamicBounds[i];
            const range = p95 - p5;
            if (range === 0) {
              normalized = 0;
            } else {
              normalized = clamp(((raw - p5) / range) * 2 - 1, -1, 1);
            }
          }

          rawBuckets[i][col].push(normalized);
        }
      }
    }

    // Aggregate each bucket
    const grid: number[][] = Array.from({ length: NUM_INDICATORS }, (_, i) =>
      rawBuckets[i].map((bucket) => {
        if (bucket.length === 0) return NaN;
        if (avgMethod === "mean") return mean(bucket);
        if (avgMethod === "median") return median(bucket);
        return trimmedMean(bucket);
      })
    );

    return { grid, filteredMarkets };
  }, [btcMap, dynamicBounds, markets, outcomes, outcomeFilter, avgMethod]);

  // --- Render states ---

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>BTC Indicators Heatmap</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-neutral-500 animate-pulse">Loading BTC indicators...</p>
        </CardContent>
      </Card>
    );
  }

  if (btcIndicators.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>BTC Indicators Heatmap</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-neutral-500">No BTC indicator data for {date}</p>
        </CardContent>
      </Card>
    );
  }

  if (!heatmapGrid || heatmapGrid.filteredMarkets.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>BTC Indicators Heatmap</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-neutral-500">
            No {outcomeFilter} markets for {date}
          </p>
        </CardContent>
      </Card>
    );
  }

  const { grid, filteredMarkets } = heatmapGrid;

  return (
    <Card>
      <CardHeader>
        <CardTitle>BTC Indicators Heatmap</CardTitle>
        <div className="flex items-center gap-4 flex-wrap">
          {/* Outcome toggle */}
          <div className="flex gap-1">
            {(["UP", "DOWN"] as OutcomeFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setOutcomeFilter(f)}
                className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                  outcomeFilter === f
                    ? f === "UP"
                      ? "bg-magenta/20 border-magenta text-magenta"
                      : "bg-cyan-500/20 border-cyan-400 text-cyan-400"
                    : "border-neutral-700 text-neutral-500 hover:border-neutral-500"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Averaging method toggle */}
          <div className="flex gap-1">
            {(["mean", "median", "trimmed"] as AvgMethod[]).map((m) => (
              <button
                key={m}
                onClick={() => setAvgMethod(m)}
                className={`px-2 py-0.5 text-xs rounded border transition-colors capitalize ${
                  avgMethod === m
                    ? "border-neutral-400 text-neutral-200"
                    : "border-neutral-700 text-neutral-500 hover:border-neutral-500"
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          <span className="text-xs text-neutral-600">
            {filteredMarkets.length} markets
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div style={{ minWidth: 600 }}>
            {/* Grid rows */}
            {INDICATORS.map((ind, i) => (
              <div key={ind.label} className="flex items-center" style={{ height: 16, marginBottom: 2 }}>
                {/* Label */}
                <div
                  className="text-neutral-400 flex-shrink-0 text-right pr-2"
                  style={{ width: 80, fontSize: 10, lineHeight: "16px" }}
                >
                  {ind.label}
                </div>
                {/* Heatmap row */}
                <div
                  className="flex-1"
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${NUM_COLS}, 1fr)`,
                    height: 16,
                  }}
                >
                  {grid[i].map((v, col) => (
                    <div
                      key={col}
                      style={{ backgroundColor: valueToColor(v), height: "100%" }}
                      title={isNaN(v) ? "no data" : v.toFixed(3)}
                    />
                  ))}
                </div>
              </div>
            ))}

            {/* x-axis labels */}
            <div className="flex" style={{ marginTop: 4 }}>
              <div style={{ width: 80, flexShrink: 0 }} />
              <div className="flex-1 flex justify-between">
                <span className="text-neutral-600" style={{ fontSize: 10 }}>← 299s</span>
                <span className="text-neutral-600" style={{ fontSize: 10 }}>0s →</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
