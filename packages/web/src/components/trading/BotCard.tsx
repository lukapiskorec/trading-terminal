import { useState, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { botPicUrl } from "@/lib/botProfiles";
import type { TradingBot, EquityPoint, BotTrade } from "@/stores/botStore";
import type { TradingRule } from "@/types/rule";

// --- Rule formula formatting (matches Rules page) ---

const FIELD_SHORT: Record<string, string> = {
  priceYes: "P↑(YES)",
  priceNo: "P↓(NO)",
  spread: "spread",
  volume: "volume",
  timeToClose: "ttc",
  aoi: "aoi",
};

function formatRuleSummary(rule: TradingRule): string {
  if (rule.randomConfig) {
    const upPct = Math.round(rule.randomConfig.upRatio * 100);
    return `RANDOM ${upPct}%UP/${100 - upPct}%DN @ ttc≤${rule.randomConfig.triggerAtTimeToClose}s → $${rule.action.amount} cd:${rule.cooldown}s`;
  }
  const sep = (rule.conditionMode ?? "AND") === "OR" ? " | " : " & ";
  const conds = rule.conditions
    .map((c) => {
      const field = FIELD_SHORT[c.field] ?? c.field;
      if (c.operator === "between" && Array.isArray(c.value)) return `${field} ${c.value[0]}–${c.value[1]}`;
      return `${field}${c.operator}${c.value}`;
    })
    .join(sep);
  const outcome = rule.action.outcome === "YES" ? "UP" : "DN";
  return `${conds} → ${outcome} $${rule.action.amount} cd:${rule.cooldown}s`;
}

// --- Component ---

interface BotCardProps {
  bot: TradingBot;
  globalRules: TradingRule[];
  wsConnected: boolean;
  hasPrice: boolean;
  onToggle: () => void;
  onReset: () => void;
  onRemove: () => void;
  onEdit: () => void;
}

export function BotCard({ bot, globalRules, wsConnected, hasPrice, onToggle, onReset, onRemove, onEdit }: BotCardProps) {
  const equity = bot.balance + bot.positions.reduce(
    (sum, p) => sum + p.quantity * p.currentPrice, 0,
  );
  const pnl = equity - bot.startingBalance;
  const pnlPct = (pnl / bot.startingBalance) * 100;

  const settledTrades = bot.trades.filter((t) => t.side === "SETTLE");
  const wins = settledTrades.filter((t) => t.pnl > 0).length;
  const losses = settledTrades.length - wins;
  const winRate = settledTrades.length > 0 ? (wins / settledTrades.length) * 100 : 0;
  const marketCount = new Set(bot.trades.map((t) => t.marketSlug)).size;

  const botRules = bot.ruleIds.map((id) => globalRules.find((r) => r.id === id)).filter(Boolean) as TradingRule[];
  const fallbackRule = bot.fallbackRuleId ? globalRules.find((r) => r.id === bot.fallbackRuleId) : null;

  // Derive status from props
  const status = !bot.enabled
    ? { label: "Idle", color: "bg-neutral-600" }
    : !wsConnected
      ? { label: "No WS", color: "bg-yellow-500" }
      : !hasPrice
        ? { label: "No data", color: "bg-yellow-500 animate-pulse" }
        : { label: "Running", color: "bg-magenta animate-pulse" };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        {/* Header: pic + name + subtitle + status */}
        <div className="flex items-start gap-3">
          <img
            src={botPicUrl(bot.picIndex)}
            alt={bot.name}
            className="w-24 h-24 rounded-md border border-theme flex-shrink-0 object-cover"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn("h-2 w-2 rounded-full flex-shrink-0", status.color)} />
              <span className="text-sm font-semibold text-neutral-100 truncate">{bot.name}</span>
              <span className="text-[10px] text-neutral-600 flex-shrink-0 ml-auto">{status.label}</span>
            </div>
            <div className="text-[10px] text-neutral-500 uppercase tracking-widest mt-0.5">{bot.subtitle}</div>
          </div>
        </div>

        {/* Balance + P&L */}
        <div className="flex justify-between text-xs">
          <span className="text-neutral-500">
            ${bot.startingBalance.toFixed(0)} →{" "}
            <span className="text-neutral-200 font-mono">${equity.toFixed(2)}</span>
          </span>
          <span className={cn("font-mono", pnl >= 0 ? "text-magenta" : "text-accent")}>
            {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)} ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%)
          </span>
        </div>

        {/* Stats row */}
        <div className="flex gap-3 text-[10px] text-neutral-500">
          <span>Trades: {bot.trades.filter((t) => t.side === "BUY").length} · {marketCount} mkts</span>
          <span>W/L: <span className="text-magenta">{wins}</span>/<span className="text-accent">{losses}</span></span>
          <span>WR: {winRate.toFixed(0)}%</span>
          <span>Pos: {bot.positions.length}</span>
          <span className="text-neutral-600">{bot.ruleMode}</span>
        </div>

        {/* Rule formulas */}
        <div className="space-y-0.5">
          {botRules.map((rule) => (
            <div key={rule.id} className="text-[10px] font-mono text-neutral-500 truncate" title={formatRuleSummary(rule)}>
              <span className={cn("inline-block w-1.5 h-1.5 rounded-full mr-1", rule.enabled ? "bg-magenta" : "bg-neutral-600")} />
              {formatRuleSummary(rule)}
            </div>
          ))}
          {fallbackRule && (
            <div className="text-[10px] font-mono text-neutral-600 truncate" title={`FALLBACK @ ttc≤${bot.fallbackTriggerTTC}s: ${formatRuleSummary(fallbackRule)}`}>
              <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 bg-yellow-600" />
              FB @ ttc≤{bot.fallbackTriggerTTC}s: {formatRuleSummary(fallbackRule)}
            </div>
          )}
        </div>

        {/* Equity chart */}
        {bot.equityHistory.length >= 2 && (
          <EquityChart data={bot.equityHistory} startingBalance={bot.startingBalance} />
        )}

        {/* Trade log */}
        {bot.trades.length > 0 && <TradeLog trades={bot.trades} />}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            variant={bot.enabled ? "default" : "outline"}
            size="sm"
            onClick={onToggle}
            className={cn("flex-1 text-xs", bot.enabled ? "bg-magenta hover:bg-magenta/80 text-white" : "")}
          >
            {bot.enabled ? "ON" : "OFF"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit} className="text-neutral-400 text-xs">
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={onReset} className="text-neutral-500 text-xs">
            Reset
          </Button>
          <Button variant="ghost" size="sm" onClick={onRemove} className="text-neutral-600 hover:text-neutral-400 text-xs px-2">
            ×
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Equity chart with axis labels and hover
// ---------------------------------------------------------------------------

const CHART_PADDING = { left: 44, right: 8, top: 6, bottom: 18 };
const CHART_W = 280;
const CHART_H = 80;

function EquityChart({ data, startingBalance }: { data: EquityPoint[]; startingBalance: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const values = data.map((d) => d.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const plotW = CHART_W - CHART_PADDING.left - CHART_PADDING.right;
  const plotH = CHART_H - CHART_PADDING.top - CHART_PADDING.bottom;

  const xScale = (i: number) => CHART_PADDING.left + (i / Math.max(values.length - 1, 1)) * plotW;
  const yScale = (v: number) => CHART_PADDING.top + plotH - ((v - min) / range) * plotH;

  const points = values.map((v, i) => `${xScale(i)},${yScale(v)}`).join(" ");
  const baseY = yScale(startingBalance);
  const trending = values[values.length - 1] >= startingBalance;
  const color = trending ? "#e879f9" : "#22d3ee";

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const x = ((e.clientX - rect.left) / rect.width) * CHART_W;
    const idx = Math.round(((x - CHART_PADDING.left) / plotW) * (values.length - 1));
    setHoverIdx(Math.max(0, Math.min(values.length - 1, idx)));
  };

  const firstTime = fmtShortTime(data[0].timestamp);
  const lastTime = fmtShortTime(data[data.length - 1].timestamp);

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="w-full"
        style={{ height: 80 }}
        preserveAspectRatio="none"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Baseline */}
        <line x1={CHART_PADDING.left} y1={baseY} x2={CHART_W - CHART_PADDING.right} y2={baseY} stroke="#333" strokeWidth="0.5" strokeDasharray="2" />

        {/* Y axis labels */}
        <text x={CHART_PADDING.left - 3} y={CHART_PADDING.top + 4} textAnchor="end" fill="#555" fontSize="7" fontFamily="monospace">
          ${max.toFixed(0)}
        </text>
        <text x={CHART_PADDING.left - 3} y={CHART_H - CHART_PADDING.bottom} textAnchor="end" fill="#555" fontSize="7" fontFamily="monospace">
          ${min.toFixed(0)}
        </text>

        {/* X axis labels */}
        <text x={CHART_PADDING.left} y={CHART_H - 2} textAnchor="start" fill="#555" fontSize="7" fontFamily="monospace">
          {firstTime}
        </text>
        <text x={CHART_W - CHART_PADDING.right} y={CHART_H - 2} textAnchor="end" fill="#555" fontSize="7" fontFamily="monospace">
          {lastTime}
        </text>

        {/* Line */}
        <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} vectorEffect="non-scaling-stroke" />

        {/* Hover crosshair + dot */}
        {hoverIdx !== null && (
          <>
            <line x1={xScale(hoverIdx)} y1={CHART_PADDING.top} x2={xScale(hoverIdx)} y2={CHART_H - CHART_PADDING.bottom} stroke="#666" strokeWidth="0.5" strokeDasharray="2" />
            <circle cx={xScale(hoverIdx)} cy={yScale(values[hoverIdx])} r="2.5" fill={color} />
          </>
        )}
      </svg>

      {/* Hover tooltip — flip side when past midpoint to avoid overflow */}
      {hoverIdx !== null && (
        <div
          className="absolute pointer-events-none bg-panel border border-theme rounded px-1.5 py-0.5 text-[10px] font-mono text-neutral-200 whitespace-nowrap z-10"
          style={{
            left: `${(xScale(hoverIdx) / CHART_W) * 100}%`,
            top: 0,
            transform: xScale(hoverIdx) > CHART_W / 2 ? "translateX(-100%)" : "translateX(0)",
          }}
        >
          ${values[hoverIdx].toFixed(2)} · {fmtShortTime(data[hoverIdx].timestamp)}
        </div>
      )}
    </div>
  );
}

function fmtShortTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

// ---------------------------------------------------------------------------
// Trade log with column headers and enhanced info
// ---------------------------------------------------------------------------

function TradeLog({ trades }: { trades: BotTrade[] }) {
  return (
    <div className="max-h-36 overflow-y-auto">
      <table className="w-full text-[10px]">
        <thead className="sticky top-0 bg-panel">
          <tr className="text-neutral-600 border-b border-theme/40">
            <th className="py-0.5 text-left font-medium">Date/Time</th>
            <th className="py-0.5 text-left font-medium">Side</th>
            <th className="py-0.5 text-left font-medium">Shares</th>
            <th className="py-0.5 text-right font-medium">Price</th>
            <th className="py-0.5 text-right font-medium">TTC</th>
            <th className="py-0.5 text-right font-medium">Qty</th>
            <th className="py-0.5 text-right font-medium pr-3">P&L</th>
          </tr>
        </thead>
        <tbody>
          {trades.slice(0, 15).map((t) => (
            <tr key={t.id} className="border-b border-theme/20">
              <td className="py-0.5 text-neutral-500 font-mono whitespace-nowrap">
                {fmtDateTime(t.timestamp)}
              </td>
              <td className={cn("py-0.5", t.side === "BUY" ? "text-magenta" : "text-accent")}>
                {t.side}
              </td>
              <td className={cn("py-0.5", t.outcome === "YES" ? "text-magenta" : "text-accent")}>
                {t.outcome}
              </td>
              <td className="py-0.5 text-right font-mono text-neutral-400">
                ${t.price.toFixed(3)}
              </td>
              <td className="py-0.5 text-right font-mono text-neutral-600">
                {t.side === "BUY" ? `${t.timeToClose}s` : "—"}
              </td>
              <td className="py-0.5 text-right font-mono text-neutral-400">
                {t.quantity.toFixed(1)}
              </td>
              <td className="py-0.5 text-right font-mono pr-3">
                {t.side === "SETTLE" ? (
                  <span className={cn(t.pnl >= 0 ? "text-magenta" : "text-accent")}>
                    {t.pnl >= 0 ? "WIN" : "LOSS"} {t.pnl >= 0 ? "+" : "-"}${Math.abs(t.pnl).toFixed(2)}
                  </span>
                ) : (
                  <span className="text-neutral-600">-${t.total.toFixed(2)}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return `${month}/${day} ${time}`;
}
