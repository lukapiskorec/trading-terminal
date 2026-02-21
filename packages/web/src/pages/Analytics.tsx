import { useEffect, useState } from "react";
import { useShellContext } from "@/components/layout/Shell";
import { useMarketStore } from "@/stores/marketStore";
import { MarketStats } from "@/components/analytics/MarketStats";
import { AOIChart } from "@/components/analytics/AOIChart";
import { PriceOverlay } from "@/components/analytics/PriceOverlay";
import { OutcomeTimeline } from "@/components/analytics/OutcomeTimeline";
import { BtcIndicatorHeatmap } from "@/components/analytics/BtcIndicatorHeatmap";
import { FormulaComposer } from "@/components/analytics/FormulaComposer";
import { Button } from "@/components/ui/button";
import { toCsv, downloadCsv } from "@/lib/csv";
import { cn } from "@/lib/cn";
import { MARKET_DURATION, marketSlug } from "@/lib/constants";

export function Analytics() {
  const { date, setDate } = useShellContext();
  const { markets, snapshots, outcomes, btcIndicators, loading, error, fetchMarketsByDate, fetchSnapshots, fetchOutcomes, fetchBtcIndicators } =
    useMarketStore();
  const [highlightedSlug, setHighlightedSlug] = useState<string | null>(null);
  const [showUp, setShowUp] = useState(true);
  const [showDown, setShowDown] = useState(true);

  // Fetch markets + outcomes + BTC indicators when date changes
  useEffect(() => {
    fetchMarketsByDate(date);
    fetchOutcomes({ date });
    fetchBtcIndicators(date);
  }, [date, fetchMarketsByDate, fetchOutcomes, fetchBtcIndicators]);

  // Fetch snapshots when markets load
  useEffect(() => {
    if (markets.length > 0) {
      fetchSnapshots(markets.map((m) => m.id), date);
    }
  }, [markets, fetchSnapshots]);

  // Filter outcomes to selected date
  const dayOutcomes = outcomes.filter((o) => o.start_time.startsWith(date));

  const handleExportOutcomes = () => {
    if (dayOutcomes.length === 0) return;
    const csv = toCsv(
      dayOutcomes.map((o) => ({
        start_time: o.start_time,
        slug: o.slug,
        outcome: o.outcome,
        outcome_binary: o.outcome_binary,
        volume: o.volume ?? "",
      })),
    );
    downloadCsv(csv, `outcomes-${date}.csv`);
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-neutral-400 text-sm">Error loading data</p>
          <p className="text-xs text-neutral-500 mt-1">{error}</p>
        </div>
      </div>
    );
  }

  if (!loading && markets.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-neutral-400 text-sm">No market data for {date}</p>
          <p className="text-xs text-neutral-500 mt-1">Try selecting a date with seeded data (e.g. 2026-02-13)</p>
        </div>
      </div>
    );
  }

  // Current live market link — update every market cycle
  const [liveSlug, setLiveSlug] = useState(() => {
    const now = Math.floor(Date.now() / 1000);
    return marketSlug(Math.floor(now / MARKET_DURATION) * MARKET_DURATION);
  });
  useEffect(() => {
    function updateSlug() {
      const now = Math.floor(Date.now() / 1000);
      setLiveSlug(marketSlug(Math.floor(now / MARKET_DURATION) * MARKET_DURATION));
    }
    const id = setInterval(updateSlug, 5000);
    return () => clearInterval(id);
  }, []);
  const polymarketUrl = `https://polymarket.com/event/${liveSlug}`;

  return (
    <div className="space-y-4">
      {/* Compact one-row header: market name · date picker · outcomes · export */}
      <div className="flex items-center justify-center gap-3 border-b border-theme pb-3">
        <a
          href={polymarketUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-neutral-400 tracking-wide flex-shrink-0 underline underline-offset-2 hover:text-neutral-300 transition-colors"
        >
          BTC 5-min Up/Down ↗
        </a>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-7 border border-theme bg-panel px-2 text-xs text-neutral-200 outline-none focus:border-accent flex-shrink-0"
        />
        {loading ? (
          <span className="text-xs text-neutral-500 animate-pulse">Loading...</span>
        ) : (
          <span className="text-xs text-neutral-500">{dayOutcomes.length} outcomes loaded</span>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleExportOutcomes}
          disabled={dayOutcomes.length === 0}
          className={cn(loading || dayOutcomes.length === 0 ? "opacity-40" : "")}
        >
          Export CSV
        </Button>
      </div>

      <MarketStats outcomes={dayOutcomes} />

      <AOIChart outcomes={dayOutcomes} />

      <PriceOverlay
        markets={markets}
        snapshots={snapshots}
        highlightedMarketId={highlightedSlug ? (markets.find((m) => m.slug === highlightedSlug)?.id ?? null) : null}
        showUp={showUp}
        showDown={showDown}
        onToggleUp={() => setShowUp((v) => !v)}
        onToggleDown={() => setShowDown((v) => !v)}
      />

      <OutcomeTimeline
        outcomes={dayOutcomes}
        onHoverSlug={setHighlightedSlug}
        showUp={showUp}
        showDown={showDown}
      />

      <BtcIndicatorHeatmap
        outcomes={dayOutcomes}
        markets={markets}
        btcIndicators={btcIndicators}
        loading={loading}
        date={date}
      />

      <FormulaComposer />
    </div>
  );
}
