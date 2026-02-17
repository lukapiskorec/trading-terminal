import { useEffect } from "react";
import { useIndicatorStore } from "@/stores/indicatorStore";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { Signal, IndicatorResult } from "@/lib/indicators";

type IndicatorKey = "obi" | "cvd" | "rsi" | "macd" | "emaCross" | "vwap" | "heikinAshi" | "poc" | "walls" | "bbands" | "flowToxicity" | "roc";

const INDICATOR_LABELS: { key: IndicatorKey; label: string; fullName: string; desc: string }[] = [
  { key: "obi", label: "OBI", fullName: "Order Book Imbalance", desc: "Whether there is more resting buy or sell liquidity near the current price." },
  { key: "cvd", label: "CVD", fullName: "Cumulative Volume Delta", desc: "Net aggressive buying vs selling pressure over a rolling 5-min window." },
  { key: "rsi", label: "RSI", fullName: "Relative Strength Index", desc: "Momentum — whether recent price moves have been predominantly up or down." },
  { key: "macd", label: "MACD", fullName: "Moving Average Convergence Divergence", desc: "Trend momentum via the relationship between fast and slow exponential moving averages." },
  { key: "emaCross", label: "EMA Cross", fullName: "EMA Crossover (5/20)", desc: "Short-term trend direction — whether fast momentum is above or below the slower trend." },
  { key: "vwap", label: "VWAP", fullName: "Volume-Weighted Average Price", desc: "The average price weighted by volume — institutional benchmark for fair value." },
  { key: "heikinAshi", label: "Heikin Ashi", fullName: "Heikin Ashi Streak", desc: "Trend persistence using smoothed candles — how many consecutive candles are the same color." },
  { key: "poc", label: "POC", fullName: "Point of Control (Volume Profile)", desc: "The price level with the highest traded volume — where the market spent most of its energy." },
  { key: "walls", label: "Walls", fullName: "Bid/Ask Walls", desc: "Whether there are large resting orders (walls) on the bid or ask side of the orderbook." },
  { key: "bbands", label: "BBands %B", fullName: "Bollinger Bands (%B)", desc: "Price position relative to its volatility envelope — is price stretched to an extreme or near the mean?" },
  { key: "flowToxicity", label: "Flow Toxic.", fullName: "Order Flow Toxicity", desc: "Whether recent order flow is one-sided and informed — indicating toxic flow to market makers." },
  { key: "roc", label: "ROC", fullName: "Rate of Change", desc: "Simple price momentum — percentage change over a 10-minute lookback period." },
];

function signalClasses(signal: Signal): string {
  switch (signal) {
    case "BULLISH": return "bg-magenta/15 text-magenta";
    case "BEARISH": return "bg-accent/15 text-accent";
    case "NEUTRAL": return "bg-neutral-800 text-neutral-400";
  }
}

function formatValue(result: IndicatorResult): string {
  if (typeof result.value === "string") return result.value;
  const v = result.value;
  if (Math.abs(v) >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

export function IndicatorPanel() {
  const { status, mid, indicators, bias, connect, disconnect } = useIndicatorStore();

  // Cleanup on unmount
  useEffect(() => {
    return () => { disconnect(); };
  }, [disconnect]);

  const handleToggle = () => {
    if (status === "connected" || status === "connecting") {
      disconnect();
    } else {
      connect();
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle>BTC Indicators</CardTitle>
            {mid !== null && (
              <span className="text-sm font-mono text-neutral-300">
                ${mid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={handleToggle}>
            <span className={cn(
              "inline-block h-2 w-2 rounded-full mr-2",
              status === "connected" ? "bg-magenta" : status === "connecting" ? "bg-white animate-pulse" : "bg-neutral-600",
            )} />
            {status === "connected" ? "Disconnect" : status === "connecting" ? "Connecting..." : "Connect"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {status === "disconnected" && !bias ? (
          <p className="text-sm text-neutral-500">Click Connect to start Binance data feed</p>
        ) : (
          <>
            {/* 3×4 indicator grid */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {INDICATOR_LABELS.map(({ key, label, fullName, desc }) => {
                const result = indicators[key];
                return (
                  <div key={key} className="group relative rounded border border-theme bg-surface px-3 py-2">
                    <div className="text-[11px] text-neutral-500">{label}</div>
                    {result ? (
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <span className="font-mono text-sm text-neutral-200">{formatValue(result)}</span>
                        <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded", signalClasses(result.signal))}>
                          {result.signal}
                        </span>
                      </div>
                    ) : (
                      <div className="text-xs text-neutral-600 mt-1">—</div>
                    )}
                    {/* Hover tooltip */}
                    <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 rounded border border-theme bg-panel shadow-lg shadow-black/50 p-2 text-xs opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-150">
                      <div className="font-semibold text-neutral-200 mb-1">{fullName}</div>
                      <div className="text-neutral-400 leading-relaxed">{desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Composite bias bar */}
            {bias && (
              <div className="mt-3 rounded border border-theme bg-surface px-3 py-2">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] text-neutral-500">Composite Bias</span>
                  <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded", signalClasses(bias.signal))}>
                    {bias.signal} ({bias.score > 0 ? "+" : ""}{bias.score})
                  </span>
                </div>
                <div className="relative h-2 rounded-full bg-neutral-800 overflow-hidden">
                  {/* Center line */}
                  <div className="absolute left-1/2 top-0 h-full w-px bg-neutral-600" />
                  {/* Fill bar */}
                  <div
                    className={cn(
                      "absolute top-0 h-full rounded-full transition-all duration-300",
                      bias.score >= 0 ? "bg-magenta" : "bg-accent",
                    )}
                    style={{
                      left: bias.score >= 0 ? "50%" : `${50 + bias.score / 2}%`,
                      width: `${Math.abs(bias.score) / 2}%`,
                    }}
                  />
                </div>
                <div className="flex justify-between mt-1 text-[10px] text-neutral-600">
                  <span>-100</span>
                  <span>0</span>
                  <span>+100</span>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
