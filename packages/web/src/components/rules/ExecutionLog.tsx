import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRulesStore } from "@/stores/rulesStore";
import { cn } from "@/lib/cn";

export function ExecutionLog() {
  const { executions, clearExecutions } = useRulesStore();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Execution Log ({executions.length})</CardTitle>
          {executions.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearExecutions}>
              Clear
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {executions.length === 0 ? (
          <p className="text-sm text-neutral-500">No executions yet. Rules fire when conditions are met during live or backtest runs.</p>
        ) : (
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-panel">
                <tr className="border-b border-theme text-neutral-500">
                  <th className="py-1.5 text-left font-medium">Time</th>
                  <th className="py-1.5 text-left font-medium">Rule</th>
                  <th className="py-1.5 text-left font-medium">Market</th>
                  <th className="py-1.5 text-left font-medium">Action</th>
                  <th className="py-1.5 text-left font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {executions.map((exec) => (
                  <tr key={exec.id} className="border-b border-theme/50">
                    <td className="py-1.5 font-mono text-neutral-400">
                      {new Date(exec.timestamp).toLocaleTimeString("en-US", { hour12: false })}
                    </td>
                    <td className="py-1.5 text-neutral-300 max-w-[120px] truncate">{exec.ruleName}</td>
                    <td className="py-1.5 font-mono text-neutral-400 max-w-[100px] truncate">{formatSlug(exec.slug)}</td>
                    <td className="py-1.5 font-mono">{exec.action}</td>
                    <td className={cn("py-1.5", exec.result === "success" ? "text-magenta" : "text-accent")}>
                      {exec.result}
                      {exec.error && <span className="text-neutral-600 ml-1">({exec.error})</span>}
                    </td>
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

function formatSlug(slug: string): string {
  const match = slug.match(/(\d+)$/);
  if (!match) return slug;
  const ts = parseInt(match[1]);
  return new Date(ts * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
}
