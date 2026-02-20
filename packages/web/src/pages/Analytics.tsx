import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { ShellContext } from "@/components/layout/Shell";
import { useMarketStore } from "@/stores/marketStore";
import { AOIChart } from "@/components/analytics/AOIChart";
import { PriceOverlay } from "@/components/analytics/PriceOverlay";
import { OutcomeTimeline } from "@/components/analytics/OutcomeTimeline";
import { MarketStats } from "@/components/analytics/MarketStats";
import { Button } from "@/components/ui/button";
import { toCsv, downloadCsv } from "@/lib/csv";

export function Analytics() {
  const { date } = useOutletContext<ShellContext>();
  const { markets, snapshots, outcomes, loading, error, fetchMarketsByDate, fetchSnapshots, fetchOutcomes } =
    useMarketStore();
  const [highlightedSlug, setHighlightedSlug] = useState<string | null>(null);

  // Fetch markets + outcomes when date changes
  useEffect(() => {
    fetchMarketsByDate(date);
    fetchOutcomes({ date });
  }, [date, fetchMarketsByDate, fetchOutcomes]);

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        {loading ? (
          <div className="text-xs text-neutral-500 animate-pulse">Loading data...</div>
        ) : (
          <div className="text-xs text-neutral-500">{dayOutcomes.length} outcomes loaded</div>
        )}
        <Button variant="ghost" size="sm" onClick={handleExportOutcomes} disabled={dayOutcomes.length === 0}>
          Export CSV
        </Button>
      </div>

      <MarketStats outcomes={dayOutcomes} />

      <OutcomeTimeline outcomes={dayOutcomes} onHoverSlug={setHighlightedSlug} />

      <AOIChart outcomes={dayOutcomes} />

      <PriceOverlay
        markets={markets}
        snapshots={snapshots}
        highlightedMarketId={highlightedSlug ? (markets.find((m) => m.slug === highlightedSlug)?.id ?? null) : null}
      />
    </div>
  );
}
