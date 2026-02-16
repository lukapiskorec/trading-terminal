import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useTradeStore } from "@/stores/tradeStore";
import { cn } from "@/lib/cn";

export function TradeHistory() {
  const { trades } = useTradeStore();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trade History ({trades.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {trades.length === 0 ? (
          <p className="text-sm text-neutral-500">No trades yet</p>
        ) : (
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-neutral-900">
                <tr className="border-b border-neutral-800 text-neutral-500">
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
                  <tr key={trade.id} className="border-b border-neutral-800/50">
                    <td className="py-1.5 font-mono text-neutral-400">
                      {new Date(trade.timestamp).toLocaleTimeString("en-US", { hour12: false })}
                    </td>
                    <td className={cn("py-1.5", trade.side === "BUY" ? "text-green-400" : "text-red-400")}>
                      {trade.side}
                    </td>
                    <td className={cn("py-1.5", trade.outcome === "YES" ? "text-green-400" : "text-red-400")}>
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
