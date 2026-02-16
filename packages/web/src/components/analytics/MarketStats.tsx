import { useMemo } from "react";
import type { MarketOutcome } from "@/types/market";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface MarketStatsProps {
  outcomes: MarketOutcome[];
}

interface Stats {
  total: number;
  upCount: number;
  downCount: number;
  upPct: string;
  downPct: string;
  longestUpStreak: number;
  longestDownStreak: number;
  chiSquaredP: string;
  autocorrelation: string;
  sessions: { label: string; upRate: string; count: number }[];
}

// Session hour ranges in UTC
const SESSION_DEFS = [
  { label: "Asia (01–07 UTC)", startH: 1, endH: 7 },
  { label: "EU (07–14 UTC)", startH: 7, endH: 14 },
  { label: "US Open (14–17 UTC)", startH: 14, endH: 17 },
  { label: "US Close (17–21 UTC)", startH: 17, endH: 21 },
  { label: "Overnight (21–01 UTC)", startH: 21, endH: 25 }, // 25 wraps to 1
] as const;

export function MarketStats({ outcomes }: MarketStatsProps) {
  const stats = useMemo(() => computeStats(outcomes), [outcomes]);

  if (!stats) {
    return (
      <Card>
        <CardHeader><CardTitle>Summary Statistics</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-neutral-500">No data</p></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Summary Statistics</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm lg:grid-cols-4">
          <Stat label="Total Markets" value={stats.total} />
          <Stat label="Up" value={`${stats.upCount} (${stats.upPct}%)`} className="text-green-400" />
          <Stat label="Down" value={`${stats.downCount} (${stats.downPct}%)`} className="text-red-400" />
          <Stat label="Longest Up Streak" value={stats.longestUpStreak} />
          <Stat label="Longest Down Streak" value={stats.longestDownStreak} />
          <Stat label="Chi-squared p-value" value={stats.chiSquaredP} />
          <Stat label="Autocorrelation (lag-1)" value={stats.autocorrelation} />
        </div>

        <h4 className="mt-4 mb-2 text-xs font-medium text-neutral-400 uppercase tracking-wide">Up Rate by Session</h4>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm lg:grid-cols-3">
          {stats.sessions.map((s) => (
            <div key={s.label} className="flex justify-between">
              <span className="text-neutral-400">{s.label}</span>
              <span className="font-mono">{s.upRate}% <span className="text-neutral-600">({s.count})</span></span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, className }: { label: string; value: string | number; className?: string }) {
  return (
    <div>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`font-mono text-base ${className ?? ""}`}>{value}</div>
    </div>
  );
}

function computeStats(outcomes: MarketOutcome[]): Stats | null {
  if (outcomes.length === 0) return null;

  const bins = outcomes.map((o) => o.outcome_binary);
  const n = bins.length;
  const upCount = bins.filter((b) => b === 1).length;
  const downCount = n - upCount;

  // Longest streaks
  let longestUp = 0, longestDown = 0, curUp = 0, curDown = 0;
  for (const b of bins) {
    if (b === 1) { curUp++; curDown = 0; longestUp = Math.max(longestUp, curUp); }
    else { curDown++; curUp = 0; longestDown = Math.max(longestDown, curDown); }
  }

  // Chi-squared test: observed vs expected 50/50
  const expected = n / 2;
  const chiSq = ((upCount - expected) ** 2) / expected + ((downCount - expected) ** 2) / expected;
  // Approximate p-value for 1 DOF chi-squared
  const pValue = 1 - chiSquaredCDF(chiSq, 1);

  // Autocorrelation at lag 1
  const mean = upCount / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    den += (bins[i] - mean) ** 2;
    if (i < n - 1) num += (bins[i] - mean) * (bins[i + 1] - mean);
  }
  const autocorr = den === 0 ? 0 : num / den;

  // Session breakdown
  const sessions = SESSION_DEFS.map((def) => {
    const inSession = outcomes.filter((o) => {
      const h = new Date(o.start_time).getUTCHours();
      if (def.endH > 24) {
        return h >= def.startH || h < def.endH - 24;
      }
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

/** Approximate chi-squared CDF for degrees of freedom = 1 */
function chiSquaredCDF(x: number, _k: number): number {
  // For k=1: CDF = erf(sqrt(x/2))
  return erf(Math.sqrt(x / 2));
}

/** Approximation of the error function */
function erf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + p * x);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
