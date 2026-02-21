import { useEffect, useState, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import type { ShellContext } from "@/components/layout/Shell";
import { useMarketStore } from "@/stores/marketStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import * as ws from "@/lib/ws";
import type { ConnectionStatus } from "@/lib/ws";
import { MARKET_DURATION, marketSlug } from "@/lib/constants";
import type { Market } from "@/types/market";
import { LiveMarketPanel } from "@/components/dashboard/LiveMarketPanel";
import { IndicatorPanel } from "@/components/dashboard/IndicatorPanel";
import { OutcomeCell } from "@/components/dashboard/OutcomeCell";

export function Dashboard() {
  const { date } = useOutletContext<ShellContext>();
  const { markets, outcomes, loading, error, fetchMarketsByDate, fetchOutcomes } = useMarketStore();
  const wsAutoConnect = useSettingsStore((s) => s.wsAutoConnect);

  const [wsStatus, setWsStatus] = useState<ConnectionStatus>(ws.getStatus());

  // Fetch historical data
  useEffect(() => {
    fetchMarketsByDate(date);
    fetchOutcomes();
  }, [date, fetchMarketsByDate, fetchOutcomes]);

  // WS status listener
  useEffect(() => {
    return ws.onStatus(setWsStatus);
  }, []);

  // Auto-connect
  useEffect(() => {
    if (wsAutoConnect && wsStatus === "disconnected") {
      ws.connect();
    }
  }, [wsAutoConnect, wsStatus]);

  const handleConnect = useCallback(() => {
    if (wsStatus === "connected") {
      ws.disconnect();
    } else {
      ws.connect();
    }
  }, [wsStatus]);

  // Derived stats
  const resolvedMarkets = markets.filter((m) => m.outcome !== null);
  const upCount = resolvedMarkets.filter((m) => m.outcome === "Up").length;
  const downCount = resolvedMarkets.filter((m) => m.outcome === "Down").length;
  const upPct = resolvedMarkets.length > 0 ? (upCount / resolvedMarkets.length) * 100 : 0;

  // Recent outcomes for date
  const dayOutcomes = outcomes.filter((o) => o.start_time.startsWith(date));

  // Find recent streak
  const streak = computeStreak(resolvedMarkets);

  // Current live market link — update every market cycle
  const [liveSlug, setLiveSlug] = useState(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    return marketSlug(Math.floor(nowSec / MARKET_DURATION) * MARKET_DURATION);
  });
  useEffect(() => {
    function updateSlug() {
      const nowSec = Math.floor(Date.now() / 1000);
      setLiveSlug(marketSlug(Math.floor(nowSec / MARKET_DURATION) * MARKET_DURATION));
    }
    const id = setInterval(updateSlug, 5000);
    return () => clearInterval(id);
  }, []);
  const polymarketUrl = `https://polymarket.com/event/${liveSlug}`;

  return (
    <div className="space-y-4">
      {/* Connection + status bar */}
      <div className="flex items-center gap-3">
        <a
          href={polymarketUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-300 transition-colors"
        >
          BTC 5-min Up/Down ↗
        </a>
        <Button variant="outline" size="sm" onClick={handleConnect}>
          <span className={cn(
            "inline-block h-2 w-2 rounded-full mr-2",
            wsStatus === "connected" ? "bg-magenta" : wsStatus === "connecting" ? "bg-white animate-pulse" : "bg-neutral-600",
          )} />
          {wsStatus === "connected" ? "Disconnect" : wsStatus === "connecting" ? "Connecting..." : "Connect WS"}
        </Button>
        <span className="text-xs text-neutral-500">{date}</span>
        {loading && <span className="text-xs text-neutral-500 animate-pulse">Loading...</span>}
        {error && <span className="text-xs text-neutral-400">{error}</span>}
      </div>

      {/* Live Market Panel */}
      <LiveMarketPanel />

      {/* Top stats row */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Markets" value={String(resolvedMarkets.length)} sub={`of ${markets.length} total`} />
        <StatCard
          label="Up (YES) / Down (NO)"
          value={`${upCount} / ${downCount}`}
          sub={`${upPct.toFixed(1)}% Up`}
          color={upPct > 50 ? "up" : upPct < 50 ? "down" : undefined}
        />
        <StatCard
          label="Current Streak"
          value={streak ? `${streak.count} ${streak.direction}` : "-"}
          color={streak?.direction === "Up" ? "up" : streak?.direction === "Down" ? "down" : undefined}
        />
      </div>

      {/* BTC Indicators */}
      <IndicatorPanel />

      {/* Recent outcomes grid */}
      <Card>
        <CardHeader>
          <CardTitle>Outcomes ({resolvedMarkets.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {resolvedMarkets.length === 0 ? (
            <p className="text-sm text-neutral-500">
              {loading ? "Loading markets..." : "No resolved markets for this date"}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {resolvedMarkets.map((m) => (
                <OutcomeCell key={m.id} market={m} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent markets table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Markets</CardTitle>
        </CardHeader>
        <CardContent>
          {markets.length === 0 ? (
            <p className="text-sm text-neutral-500">
              {loading ? "Loading..." : "No markets for this date"}
            </p>
          ) : (
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-panel">
                  <tr className="border-b border-theme text-neutral-500">
                    <th className="py-1.5 text-left font-medium">Time (UTC)</th>
                    <th className="py-1.5 text-left font-medium">Slug</th>
                    <th className="py-1.5 text-right font-medium">Outcome</th>
                    <th className="py-1.5 text-right font-medium pr-4">Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {[...markets].reverse().slice(0, 50).map((m) => (
                    <tr key={m.id} className="border-b border-theme/50">
                      <td className="py-1.5 font-mono text-neutral-400">
                        {formatTime(m.start_time)}
                      </td>
                      <td className="py-1.5 text-neutral-300 font-mono text-[11px] truncate max-w-[200px]">
                        {m.slug}
                      </td>
                      <td className="py-1.5 text-right">
                        {m.outcome ? (
                          <span className={m.outcome === "Up" ? "text-magenta" : "text-accent"}>
                            {m.outcome}
                          </span>
                        ) : (
                          <span className="text-neutral-600">-</span>
                        )}
                      </td>
                      <td className="py-1.5 text-right text-neutral-400 font-mono pr-4">
                        {m.volume ? `$${Math.round(m.volume)}` : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// --- Helpers ---

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: "up" | "down" }) {
  return (
    <Card>
      <CardContent className="py-3">
        <div className="text-xs text-neutral-500">{label}</div>
        <div className={cn(
          "text-lg font-mono font-semibold",
          color === "up" ? "text-magenta" : color === "down" ? "text-accent" : "text-neutral-100",
        )}>
          {value}
        </div>
        {sub && <div className="text-xs text-neutral-500">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function computeStreak(markets: Market[]): { count: number; direction: "Up" | "Down" } | null {
  if (markets.length === 0) return null;
  const last = markets[markets.length - 1].outcome;
  if (!last) return null;

  let count = 0;
  for (let i = markets.length - 1; i >= 0; i--) {
    if (markets[i].outcome === last) count++;
    else break;
  }
  return { count, direction: last };
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
}
