import { useEffect } from "react";
import { useIndicatorStore } from "@/stores/indicatorStore";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { Signal, IndicatorResult } from "@/lib/indicators";

type IndicatorKey = "obi" | "cvd" | "rsi" | "macd" | "emaCross" | "vwap" | "heikinAshi" | "poc" | "walls";

const INDICATOR_LABELS: { key: IndicatorKey; label: string }[] = [
  { key: "obi", label: "OBI" },
  { key: "cvd", label: "CVD" },
  { key: "rsi", label: "RSI" },
  { key: "macd", label: "MACD" },
  { key: "emaCross", label: "EMA Cross" },
  { key: "vwap", label: "VWAP" },
  { key: "heikinAshi", label: "Heikin Ashi" },
  { key: "poc", label: "POC" },
  { key: "walls", label: "Walls" },
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
            {/* 3×3 indicator grid */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {INDICATOR_LABELS.map(({ key, label }) => {
                const result = indicators[key];
                return (
                  <div key={key} className="rounded border border-theme bg-surface px-3 py-2">
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
