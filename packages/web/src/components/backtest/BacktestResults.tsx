import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { BacktestStats } from "@/types/backtest";

interface BacktestResultsProps {
  stats: BacktestStats;
  marketsProcessed: number;
}

export function BacktestResults({ stats, marketsProcessed }: BacktestResultsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Backtest Summary</CardTitle>
        <p className="text-xs text-neutral-500">{marketsProcessed} markets replayed</p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
          <Stat label="Total P&L" value={fmtUsd(stats.totalPnl)} color={stats.totalPnl >= 0} />
          <Stat label="Return" value={fmtPct(stats.totalPnlPct)} color={stats.totalPnlPct >= 0} />
          <Stat label="Win Rate" value={fmtPct(stats.winRate)} />
          <Stat label="Trades" value={String(stats.totalTrades)} />
          <Stat label="Wins / Losses" value={`${stats.wins} / ${stats.losses}`} />
          <Stat label="Avg Win" value={fmtUsd(stats.avgWin)} color={true} />
          <Stat label="Avg Loss" value={fmtUsd(-stats.avgLoss)} color={false} />
          <Stat label="Profit Factor" value={stats.profitFactor === Infinity ? "\u221e" : stats.profitFactor.toFixed(2)} />
          <Stat label="Max Drawdown" value={fmtUsd(-stats.maxDrawdown)} color={false} />
          <Stat label="Max DD %" value={fmtPct(-stats.maxDrawdownPct)} color={false} />
          <Stat label="Sharpe Ratio" value={stats.sharpeRatio.toFixed(2)} />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: boolean }) {
  let valueClass = "text-neutral-100";
  if (color === true) valueClass = "text-green-400";
  if (color === false) valueClass = "text-red-400";

  return (
    <div>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`text-sm font-mono font-medium ${valueClass}`}>{value}</div>
    </div>
  );
}

function fmtUsd(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${n.toFixed(2)}`;
}

function fmtPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(1)}%`;
}
