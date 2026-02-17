import { useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/cn";
import type { Market } from "@/types/market";

interface IndicatorAvg {
  btc_mid: number | null;
  obi: number | null;
  cvd_5m: number | null;
  rsi: number | null;
  macd_histogram: number | null;
  vwap: number | null;
  ha_streak: number | null;
  bbands_pct_b: number | null;
  flow_toxicity: number | null;
  roc: number | null;
  bias_score: number | null;
  bias_signal: string | null;
  count: number;
}

type Sentiment = "bullish" | "bearish" | "neutral";

const INDICATOR_ROWS: { key: keyof IndicatorAvg; label: string; fmt: (v: number) => string; sentiment: (v: number) => Sentiment }[] = [
  { key: "btc_mid", label: "BTC Mid", fmt: (v) => `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, sentiment: () => "neutral" },
  { key: "obi", label: "OBI", fmt: (v) => v.toFixed(3), sentiment: (v) => v > 0.1 ? "bullish" : v < -0.1 ? "bearish" : "neutral" },
  { key: "cvd_5m", label: "CVD", fmt: (v) => v.toFixed(2), sentiment: (v) => v > 0 ? "bullish" : v < 0 ? "bearish" : "neutral" },
  { key: "rsi", label: "RSI", fmt: (v) => v.toFixed(1), sentiment: (v) => v < 30 ? "bullish" : v > 70 ? "bearish" : "neutral" },
  { key: "macd_histogram", label: "MACD", fmt: (v) => v.toFixed(2), sentiment: (v) => v > 0 ? "bullish" : v < 0 ? "bearish" : "neutral" },
  { key: "vwap", label: "VWAP", fmt: (v) => `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, sentiment: () => "neutral" },
  { key: "bbands_pct_b", label: "BBands %B", fmt: (v) => v.toFixed(3), sentiment: (v) => v < 0.2 ? "bullish" : v > 0.8 ? "bearish" : "neutral" },
  { key: "flow_toxicity", label: "Flow Tox.", fmt: (v) => v.toFixed(3), sentiment: (v) => v > 0.3 ? "bullish" : v < -0.3 ? "bearish" : "neutral" },
  { key: "roc", label: "ROC", fmt: (v) => `${v.toFixed(3)}%`, sentiment: (v) => v > 0.1 ? "bullish" : v < -0.1 ? "bearish" : "neutral" },
  { key: "bias_score", label: "Bias", fmt: (v) => v.toFixed(1), sentiment: (v) => v > 10 ? "bullish" : v < -10 ? "bearish" : "neutral" },
];

function sentimentColor(s: Sentiment): string {
  return s === "bullish" ? "text-magenta" : s === "bearish" ? "text-accent" : "text-neutral-200";
}

// Cache fetched results so repeated hovers don't re-query
const cache = new Map<number, IndicatorAvg | "loading" | "empty">();

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
}

export function OutcomeCell({ market }: { market: Market }) {
  const [data, setData] = useState<IndicatorAvg | "loading" | "empty" | null>(null);
  const [show, setShow] = useState(false);
  const cellRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async () => {
    const cached = cache.get(market.id);
    if (cached) {
      setData(cached);
      return;
    }

    cache.set(market.id, "loading");
    setData("loading");

    type SnapshotRow = Record<string, number | string | null>;
    const { data: rows, error } = await supabase
      .from("btc_indicator_snapshots" as any)
      .select("btc_mid, obi, cvd_5m, rsi, macd_histogram, vwap, ha_streak, bbands_pct_b, flow_toxicity, roc, bias_score, bias_signal")
      .gte("recorded_at", market.start_time)
      .lte("recorded_at", market.end_time)
      .order("recorded_at", { ascending: true }) as { data: SnapshotRow[] | null; error: any };

    if (error || !rows || rows.length === 0) {
      cache.set(market.id, "empty");
      setData("empty");
      return;
    }

    // Average all numeric fields
    const avg: IndicatorAvg = {
      btc_mid: null, obi: null, cvd_5m: null, rsi: null,
      macd_histogram: null, vwap: null, ha_streak: null,
      bbands_pct_b: null, flow_toxicity: null, roc: null,
      bias_score: null, bias_signal: null, count: rows.length,
    };

    const numericKeys = ["btc_mid", "obi", "cvd_5m", "rsi", "macd_histogram", "vwap", "ha_streak", "bbands_pct_b", "flow_toxicity", "roc", "bias_score"] as const;

    for (const key of numericKeys) {
      let sum = 0;
      let cnt = 0;
      for (const row of rows) {
        const val = row[key];
        if (val !== null && val !== undefined) {
          sum += Number(val);
          cnt++;
        }
      }
      if (cnt > 0) (avg as any)[key] = sum / cnt;
    }

    // Bias signal: use the most frequent one
    const signalCounts: Record<string, number> = {};
    for (const row of rows) {
      const s = row.bias_signal;
      if (s) signalCounts[s] = (signalCounts[s] || 0) + 1;
    }
    let maxSignal = "";
    let maxCount = 0;
    for (const [s, c] of Object.entries(signalCounts)) {
      if (c > maxCount) { maxSignal = s; maxCount = c; }
    }
    avg.bias_signal = maxSignal || null;

    cache.set(market.id, avg);
    setData(avg);
  }, [market.id, market.start_time, market.end_time]);

  const handleEnter = () => {
    timerRef.current = setTimeout(() => {
      setShow(true);
      fetchData();
    }, 200);
  };

  const handleLeave = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setShow(false);
  };

  return (
    <div
      ref={cellRef}
      className="relative"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <div
        className={cn(
          "h-6 w-6 rounded-sm flex items-center justify-center text-[10px] font-mono cursor-default",
          market.outcome === "Up"
            ? "bg-magenta/15 text-magenta"
            : "bg-accent/15 text-accent",
        )}
      >
        {market.outcome === "Up" ? "\u25B2" : "\u25BC"}
      </div>

      {show && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 rounded border border-theme bg-panel shadow-lg shadow-black/50 p-2 text-xs pointer-events-none">
          {/* Header */}
          <div className="flex items-center justify-between mb-1.5 pb-1 border-b border-theme">
            <span className="text-neutral-400 font-mono">{formatTime(market.start_time)} UTC</span>
            <span className={market.outcome === "Up" ? "text-magenta font-semibold" : "text-accent font-semibold"}>
              {market.outcome}
            </span>
          </div>

          {data === "loading" && (
            <div className="text-neutral-500 text-center py-2 animate-pulse">Loading...</div>
          )}

          {data === "empty" && (
            <div className="text-neutral-600 text-center py-2">No indicator data</div>
          )}

          {typeof data === "object" && data !== null && (
            <>
              <table className="w-full">
                <tbody>
                  {INDICATOR_ROWS.map(({ key, label, fmt, sentiment }) => {
                    const val = data[key];
                    if (val === null || val === undefined) return null;
                    const numVal = val as number;
                    return (
                      <tr key={key}>
                        <td className="text-neutral-500 py-0.5">{label}</td>
                        <td className={cn("text-right font-mono py-0.5", sentimentColor(sentiment(numVal)))}>{fmt(numVal)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {data.bias_signal && (
                <div className="mt-1.5 pt-1 border-t border-theme flex items-center justify-between">
                  <span className="text-neutral-500">Signal</span>
                  <span className={cn(
                    "text-[10px] font-semibold px-1.5 py-0.5 rounded",
                    data.bias_signal === "BULLISH" ? "bg-magenta/15 text-magenta" :
                    data.bias_signal === "BEARISH" ? "bg-accent/15 text-accent" :
                    "bg-neutral-800 text-neutral-400",
                  )}>
                    {data.bias_signal}
                  </span>
                </div>
              )}
              <div className="text-neutral-600 text-[10px] mt-1 text-right">{data.count} samples (avg)</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
