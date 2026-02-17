import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTradeStore } from "@/stores/tradeStore";
import { cn } from "@/lib/cn";
import { toCsv, downloadCsv } from "@/lib/csv";

export function TradeHistory() {
  const { trades } = useTradeStore();

  const handleExport = () => {
    if (trades.length === 0) return;
    const csv = toCsv(
      trades.map((t) => ({
        timestamp: t.timestamp,
        slug: t.slug,
        side: t.side,
        outcome: t.outcome,
        price: t.price,
        quantity: t.quantity,
        fee: t.fee,
        total: t.total,
        ruleId: t.ruleId ?? "",
      })),
    );
    downloadCsv(csv, `trades-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Trade History ({trades.length})</CardTitle>
          {trades.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleExport}>Export CSV</Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {trades.length === 0 ? (
          <p className="text-sm text-neutral-500">No trades yet</p>
        ) : (
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-panel">
                <tr className="border-b border-theme text-neutral-500">
                  <th className="py-1.5 text-left font-medium">Time</th>
                  <th className="py-1.5 text-left font-medium">Side</th>
                  <th className="py-1.5 text-left font-medium">Outcome</th>
                  <th className="py-1.5 text-right font-medium">Price</th>
                  <th className="py-1.5 text-right font-medium">Qty</th>
                  <th className="py-1.5 text-right font-medium">Fee</th>
                  <th className="py-1.5 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => (
                  <tr key={trade.id} className="border-b border-theme/50">
                    <td className="py-1.5 font-mono text-neutral-400">
                      {new Date(trade.timestamp).toLocaleTimeString("en-US", { hour12: false })}
                    </td>
                    <td className={cn("py-1.5", trade.side === "BUY" ? "text-magenta" : "text-accent")}>
                      {trade.side}
                    </td>
                    <td className={cn("py-1.5", trade.outcome === "YES" ? "text-magenta" : "text-accent")}>
                      {trade.outcome}
                    </td>
                    <td className="py-1.5 text-right font-mono">${trade.price.toFixed(3)}</td>
                    <td className="py-1.5 text-right font-mono">{trade.quantity.toFixed(1)}</td>
                    <td className="py-1.5 text-right font-mono text-neutral-500">${trade.fee.toFixed(3)}</td>
                    <td className="py-1.5 text-right font-mono">${trade.total.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
