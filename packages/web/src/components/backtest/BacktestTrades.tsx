import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { BacktestTrade } from "@/types/backtest";

interface BacktestTradesProps {
  trades: BacktestTrade[];
}

const PAGE_SIZE = 50;

export function BacktestTrades({ trades }: BacktestTradesProps) {
  const [page, setPage] = useState(0);

  // Show only settlement trades by default (each one has the P&L)
  const settlements = trades.filter((t) => t.side === "SETTLE");
  const totalPages = Math.max(1, Math.ceil(settlements.length / PAGE_SIZE));
  const pageItems = settlements.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trade Log</CardTitle>
        <p className="text-xs text-neutral-500">{settlements.length} settled trades</p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-theme text-neutral-500">
                <th className="py-1.5 pr-3 text-left font-medium">Time</th>
                <th className="py-1.5 pr-3 text-left font-medium">Market</th>
                <th className="py-1.5 pr-3 text-left font-medium">Rule</th>
                <th className="py-1.5 pr-3 text-right font-medium">Side</th>
                <th className="py-1.5 pr-3 text-right font-medium">Qty</th>
                <th className="py-1.5 pr-3 text-right font-medium">Entry</th>
                <th className="py-1.5 text-right font-medium">P&L</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((t, i) => {
                // Find matching BUY trade for entry price
                const buyTrade = trades.find(
                  (bt) =>
                    bt.side === "BUY" &&
                    bt.marketId === t.marketId &&
                    bt.ruleId === t.ruleId &&
                    bt.outcome === t.outcome,
                );
                return (
                  <tr key={`${t.slug}-${t.ruleId}-${i}`} className="border-b border-theme/50">
                    <td className="py-1.5 pr-3 text-neutral-400 font-mono">
                      {new Date(t.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="py-1.5 pr-3 text-neutral-300 truncate max-w-[140px]" title={t.slug}>
                      {formatSlug(t.slug)}
                    </td>
                    <td className="py-1.5 pr-3 text-neutral-400 truncate max-w-[100px]" title={t.ruleName}>
                      {t.ruleName}
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      <span className={t.price === 1 ? "text-magenta" : "text-accent"}>
                        {t.outcome} {t.price === 1 ? "WIN" : "LOSS"}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-right text-neutral-300 font-mono">{t.quantity}</td>
                    <td className="py-1.5 pr-3 text-right text-neutral-400 font-mono">
                      {buyTrade ? buyTrade.price.toFixed(2) : "-"}
                    </td>
                    <td className={`py-1.5 text-right font-mono font-medium ${t.pnl >= 0 ? "text-magenta" : "text-accent"}`}>
                      {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-3 text-xs text-neutral-500">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="hover:text-neutral-300 disabled:opacity-30"
            >
              Prev
            </button>
            <span>
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="hover:text-neutral-300 disabled:opacity-30"
            >
              Next
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Extract the timestamp portion from a slug like "btc-updown-5m-1770940800" and format it */
function formatSlug(slug: string): string {
  const parts = slug.split("-");
  const ts = Number(parts[parts.length - 1]);
  if (!ts) return slug;
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
