import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useTradeStore } from "@/stores/tradeStore";
import { cn } from "@/lib/cn";

export function PositionList() {
  const { positions } = useTradeStore();

  const totalUnrealized = positions.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Open Positions</CardTitle>
          {positions.length > 0 && (
            <span className={cn("text-xs font-mono", totalUnrealized >= 0 ? "text-green-400" : "text-red-400")}>
              P&L: {totalUnrealized >= 0 ? "+" : ""}{totalUnrealized.toFixed(2)}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {positions.length === 0 ? (
          <p className="text-sm text-neutral-500">No open positions</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-neutral-800 text-neutral-500">
                  <th className="py-1.5 text-left font-medium">Market</th>
                  <th className="py-1.5 text-left font-medium">Side</th>
                  <th className="py-1.5 text-right font-medium">Qty</th>
                  <th className="py-1.5 text-right font-medium">Avg Entry</th>
                  <th className="py-1.5 text-right font-medium">Current</th>
                  <th className="py-1.5 text-right font-medium">P&L</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => {
                  const pnl = pos.unrealizedPnl ?? 0;
                  return (
                    <tr key={`${pos.marketId}-${pos.outcome}`} className="border-b border-neutral-800/50">
                      <td className="py-1.5 font-mono text-neutral-300 max-w-[140px] truncate">
                        {formatSlug(pos.slug)}
                      </td>
                      <td className={cn("py-1.5", pos.outcome === "YES" ? "text-green-400" : "text-red-400")}>
                        {pos.outcome}
                      </td>
                      <td className="py-1.5 text-right font-mono">{pos.quantity.toFixed(1)}</td>
                      <td className="py-1.5 text-right font-mono">${pos.avgEntryPrice.toFixed(3)}</td>
                      <td className="py-1.5 text-right font-mono">
                        {pos.currentPrice !== null ? `$${pos.currentPrice.toFixed(3)}` : "—"}
                      </td>
                      <td className={cn("py-1.5 text-right font-mono", pnl >= 0 ? "text-green-400" : "text-red-400")}>
                        {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatSlug(slug: string): string {
  // btc-updown-5m-1770940800 → 00:00 UTC
  const match = slug.match(/(\d+)$/);
  if (!match) return slug;
  const ts = parseInt(match[1]);
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC";
}
