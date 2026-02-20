import { useMemo } from "react";
import type { MarketOutcome } from "@/types/market";
import { Card, CardContent } from "@/components/ui/card";

interface MarketStatsProps {
  outcomes: MarketOutcome[];
}

// Session hour ranges in UTC
const SESSION_DEFS = [
  { label: "Asia 01-07", startH: 1, endH: 7 },
  { label: "EU 07-14", startH: 7, endH: 14 },
  { label: "US 14-17", startH: 14, endH: 17 },
  { label: "US 17-21", startH: 17, endH: 21 },
  { label: "Night 21-01", startH: 21, endH: 25 },
] as const;

function StatBox({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="border border-neutral-800 px-1.5 py-0.5 flex-shrink-0">
      <div className="text-neutral-600 leading-none mb-0.5 uppercase tracking-wide" style={{ fontSize: 9 }}>
        {label}
      </div>
      <div className={`font-mono text-xs leading-none ${color ?? "text-neutral-200"}`}>{value}</div>
    </div>
  );
}

export function MarketStats({ outcomes }: MarketStatsProps) {
  const stats = useMemo(() => computeStats(outcomes), [outcomes]);

  if (!stats) {
    return (
      <Card>
        <CardContent className="py-2">
          <p className="text-xs text-neutral-500">No data</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="py-2">
        <div className="flex flex-wrap justify-center gap-1">
            <StatBox label="Markets" value={String(stats.total)} />
            <StatBox label="Up YES" value={`${stats.upCount} (${stats.upPct}%)`} color="text-magenta" />
            <StatBox label="Dn NO" value={`${stats.downCount} (${stats.downPct}%)`} color="text-accent" />
            <StatBox label="Streak ↑" value={String(stats.longestUpStreak)} />
            <StatBox label="Streak ↓" value={String(stats.longestDownStreak)} />
            <StatBox label="χ² p-val" value={stats.chiSquaredP} />
            <StatBox label="AC lag-1" value={stats.autocorrelation} />
            {stats.sessions.map((s) => (
              <StatBox key={s.label} label={s.label} value={`${s.upRate}% (${s.count})`} />
            ))}
        </div>
      </CardContent>
    </Card>
  );
}

function computeStats(outcomes: MarketOutcome[]) {
  if (outcomes.length === 0) return null;

  const bins = outcomes.map((o) => o.outcome_binary);
  const n = bins.length;
  const upCount = bins.filter((b) => b === 1).length;
  const downCount = n - upCount;

  let longestUp = 0, longestDown = 0, curUp = 0, curDown = 0;
  for (const b of bins) {
    if (b === 1) { curUp++; curDown = 0; longestUp = Math.max(longestUp, curUp); }
    else { curDown++; curUp = 0; longestDown = Math.max(longestDown, curDown); }
  }

  const expected = n / 2;
  const chiSq = ((upCount - expected) ** 2) / expected + ((downCount - expected) ** 2) / expected;
  const pValue = 1 - chiSquaredCDF(chiSq, 1);

  const avg = upCount / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    den += (bins[i] - avg) ** 2;
    if (i < n - 1) num += (bins[i] - avg) * (bins[i + 1] - avg);
  }
  const autocorr = den === 0 ? 0 : num / den;

  const sessions = SESSION_DEFS.map((def) => {
    const inSession = outcomes.filter((o) => {
      const h = new Date(o.start_time).getUTCHours();
      if (def.endH > 24) return h >= def.startH || h < def.endH - 24;
      return h >= def.startH && h < def.endH;
    });
    const ups = inSession.filter((o) => o.outcome === "Up").length;
    return {
      label: def.label,
      upRate: inSession.length > 0 ? ((ups / inSession.length) * 100).toFixed(1) : "—",
      count: inSession.length,
    };
  });

  return {
    total: n,
    upCount,
    downCount,
    upPct: ((upCount / n) * 100).toFixed(1),
    downPct: ((downCount / n) * 100).toFixed(1),
    longestUpStreak: longestUp,
    longestDownStreak: longestDown,
    chiSquaredP: pValue < 0.001 ? "<0.001" : pValue.toFixed(3),
    autocorrelation: autocorr.toFixed(3),
    sessions,
  };
}

function chiSquaredCDF(x: number, _k: number): number {
  return erf(Math.sqrt(x / 2));
}

function erf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + p * x);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
