import { useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import type { ShellContext } from "@/components/layout/Shell";
import { useMarketStore } from "@/stores/marketStore";
import { AOIChart } from "@/components/analytics/AOIChart";
import { PriceOverlay } from "@/components/analytics/PriceOverlay";
import { OutcomeTimeline } from "@/components/analytics/OutcomeTimeline";
import { MarketStats } from "@/components/analytics/MarketStats";

export function Analytics() {
  const { date } = useOutletContext<ShellContext>();
  const { markets, snapshots, outcomes, loading, error, fetchMarketsByDate, fetchSnapshots, fetchOutcomes } =
    useMarketStore();

  // Fetch markets + outcomes when date changes
  useEffect(() => {
    fetchMarketsByDate(date);
    fetchOutcomes();
  }, [date, fetchMarketsByDate, fetchOutcomes]);

  // Fetch snapshots when markets load
  useEffect(() => {
    if (markets.length > 0) {
      fetchSnapshots(markets.map((m) => m.id));
    }
  }, [markets, fetchSnapshots]);

  // Filter outcomes to selected date
  const dayOutcomes = outcomes.filter((o) => o.start_time.startsWith(date));

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-red-400 text-sm">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {loading && (
        <div className="text-xs text-neutral-500 animate-pulse">Loading data...</div>
      )}

      <MarketStats outcomes={dayOutcomes} />

      <OutcomeTimeline outcomes={dayOutcomes} />

      <AOIChart outcomes={dayOutcomes} />

      <PriceOverlay markets={markets} snapshots={snapshots} />
    </div>
  );
}
