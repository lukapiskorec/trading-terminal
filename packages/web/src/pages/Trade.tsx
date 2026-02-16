import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { ShellContext } from "@/components/layout/Shell";
import { useMarketStore } from "@/stores/marketStore";
import { useTradeStore } from "@/stores/tradeStore";
import { OrderPanel } from "@/components/trading/OrderPanel";
import { PositionList } from "@/components/trading/PositionList";
import { TradeHistory } from "@/components/trading/TradeHistory";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { Market, PriceSnapshot } from "@/types/market";

export function Trade() {
  const { date } = useOutletContext<ShellContext>();
  const { markets, snapshots, loading, fetchMarketsByDate, fetchSnapshots } = useMarketStore();
  const { balance, settleMarket, reset } = useTradeStore();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Fetch markets for selected date
  useEffect(() => {
    fetchMarketsByDate(date);
  }, [date, fetchMarketsByDate]);

  // Fetch snapshots when markets load
  useEffect(() => {
    if (markets.length > 0) {
      fetchSnapshots(markets.map((m) => m.id));
    }
  }, [markets, fetchSnapshots]);

  // Auto-select first market
  useEffect(() => {
    if (markets.length > 0 && selectedId === null) {
      setSelectedId(markets[0].id);
    }
  }, [markets, selectedId]);

  const selectedMarket = markets.find((m) => m.id === selectedId) ?? null;

  // Group snapshots by market for the selected market
  const marketSnapshots = useMemo(
    () => (selectedId ? snapshots.filter((s) => s.market_id === selectedId) : []),
    [snapshots, selectedId],
  );
  const latestSnapshot = marketSnapshots.length > 0 ? marketSnapshots[marketSnapshots.length - 1] : null;

  // Settle resolved markets
  const handleSettleAll = () => {
    for (const m of markets) {
      if (m.outcome) {
        settleMarket(m.id, m.slug, m.outcome === "Up" ? "YES" : "NO");
      }
    }
  };

  return (
    <div className="grid grid-cols-[1fr_300px] gap-4 h-full">
      {/* Left: market list + positions + history */}
      <div className="space-y-4 overflow-y-auto">
        <MarketSelector
          markets={markets}
          snapshots={snapshots}
          selectedId={selectedId}
          onSelect={setSelectedId}
          loading={loading}
        />

        {selectedMarket && marketSnapshots.length > 0 && (
          <PriceBar market={selectedMarket} snapshots={marketSnapshots} />
        )}

        <PositionList />
        <TradeHistory />
      </div>

      {/* Right: order panel + actions */}
      <div className="space-y-4">
        <OrderPanel market={selectedMarket} latestSnapshot={latestSnapshot} />

        <Card>
          <CardContent className="space-y-2 pt-4">
            <Button variant="outline" size="sm" className="w-full" onClick={handleSettleAll}>
              Settle All Resolved
            </Button>
            <Button variant="ghost" size="sm" className="w-full text-neutral-500" onClick={reset}>
              Reset Simulator
            </Button>
            <p className="text-center text-xs text-neutral-600 font-mono">
              Balance: ${balance.toFixed(2)}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MarketSelector({
  markets,
  snapshots,
  selectedId,
  onSelect,
  loading,
}: {
  markets: Market[];
  snapshots: PriceSnapshot[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  loading: boolean;
}) {
  // Show a scrollable row of market "chips"
  if (loading && markets.length === 0) {
    return (
      <Card>
        <CardContent className="py-3">
          <p className="text-xs text-neutral-500 animate-pulse">Loading markets...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle>Markets ({markets.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-1 overflow-x-auto pb-1">
          {markets.map((m) => {
            const lastSnap = snapshots.filter((s) => s.market_id === m.id).at(-1);
            const price = lastSnap?.mid_price_yes ?? lastSnap?.last_trade_price;
            return (
              <button
                key={m.id}
                onClick={() => onSelect(m.id)}
                className={cn(
                  "flex-shrink-0 rounded-md px-2 py-1 text-xs font-mono transition-colors",
                  selectedId === m.id
                    ? "bg-neutral-700 text-neutral-100"
                    : "bg-neutral-800/50 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300",
                )}
              >
                <div>{formatTime(m.start_time)}</div>
                <div className={cn(
                  "text-[10px]",
                  m.outcome === "Up" ? "text-green-500" : m.outcome === "Down" ? "text-red-500" : "text-neutral-600",
                )}>
                  {m.outcome ?? (price ? `$${price.toFixed(2)}` : "—")}
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function PriceBar({ market, snapshots }: { market: Market; snapshots: PriceSnapshot[] }) {
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const startPrice = first?.mid_price_yes ?? first?.last_trade_price ?? 0.5;
  const endPrice = last?.mid_price_yes ?? last?.last_trade_price ?? 0.5;
  const delta = endPrice - startPrice;

  return (
    <Card>
      <CardContent className="flex items-center justify-between py-3">
        <div>
          <div className="text-sm font-medium">{market.question}</div>
          <div className="text-xs text-neutral-500">
            {formatTime(market.start_time)} → {formatTime(market.end_time)}
            {market.outcome && (
              <span className={cn("ml-2 font-semibold", market.outcome === "Up" ? "text-green-400" : "text-red-400")}>
                Resolved: {market.outcome}
              </span>
            )}
          </div>
        </div>
        <div className="text-right font-mono">
          <div className="text-lg">${endPrice.toFixed(3)}</div>
          <div className={cn("text-xs", delta >= 0 ? "text-green-400" : "text-red-400")}>
            {delta >= 0 ? "+" : ""}{delta.toFixed(3)} ({snapshots.length} pts)
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
}
