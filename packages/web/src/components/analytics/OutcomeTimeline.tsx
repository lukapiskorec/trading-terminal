import { useMemo } from "react";
import type { MarketOutcome } from "@/types/market";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface OutcomeTimelineProps {
  outcomes: MarketOutcome[];
}

// Trading session boundaries in UTC
// US session: 9:30 AM - 4:00 PM ET → 14:30 - 21:00 UTC
// Asia session: 9:00 AM - 3:00 PM HKT (UTC+8) → 01:00 - 07:00 UTC
const SESSIONS = [
  { label: "Asia", startHour: 1, endHour: 7, color: "rgba(251, 191, 36, 0.08)", border: "rgba(251, 191, 36, 0.25)" },
  { label: "US", startHour: 14.5, endHour: 21, color: "rgba(56, 189, 248, 0.08)", border: "rgba(56, 189, 248, 0.25)" },
] as const;

const SVG_H = 80;
const ARROW_H = 16;
const MARGIN = { left: 40, right: 12, top: 8, bottom: 20 };

export function OutcomeTimeline({ outcomes }: OutcomeTimelineProps) {
  const streaks = useMemo(() => computeStreaks(outcomes), [outcomes]);

  if (outcomes.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Outcome Timeline</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-neutral-500">No data</p></CardContent>
      </Card>
    );
  }

  const dayStart = new Date(outcomes[0].start_time).getTime();
  const dayEnd = new Date(outcomes[outcomes.length - 1].start_time).getTime();
  const range = dayEnd - dayStart || 1;

  const plotW = `calc(100% - ${MARGIN.left + MARGIN.right}px)`;
  const xPct = (time: string) => ((new Date(time).getTime() - dayStart) / range) * 100;

  // Hour ticks (every 4 hours)
  const firstHour = new Date(outcomes[0].start_time);
  firstHour.setUTCMinutes(0, 0, 0);
  const hourTicks: { label: string; pct: number }[] = [];
  for (let h = 0; h < 24; h += 4) {
    const t = new Date(firstHour);
    t.setUTCHours(h);
    const pct = ((t.getTime() - dayStart) / range) * 100;
    if (pct >= 0 && pct <= 100) {
      hourTicks.push({ label: `${h.toString().padStart(2, "0")}:00`, pct });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Outcome Timeline</CardTitle>
        <div className="flex gap-4 text-xs text-neutral-500">
          <span className="text-green-400">▲ Up</span>
          <span className="text-red-400">▼ Down</span>
          <span style={{ color: SESSIONS[0].border }}>■ Asia</span>
          <span style={{ color: SESSIONS[1].border }}>■ US</span>
        </div>
      </CardHeader>
      <CardContent>
        <svg width="100%" height={SVG_H} className="overflow-visible">
          {/* Trading session backgrounds */}
          {SESSIONS.map((session) => {
            const sStart = new Date(firstHour);
            sStart.setUTCHours(Math.floor(session.startHour), (session.startHour % 1) * 60);
            const sEnd = new Date(firstHour);
            sEnd.setUTCHours(Math.floor(session.endHour), (session.endHour % 1) * 60);
            const x1 = Math.max(0, ((sStart.getTime() - dayStart) / range) * 100);
            const x2 = Math.min(100, ((sEnd.getTime() - dayStart) / range) * 100);
            if (x2 <= 0 || x1 >= 100) return null;
            return (
              <g key={session.label}>
                <rect
                  x={`${x1}%`}
                  width={`${x2 - x1}%`}
                  y={MARGIN.top}
                  height={SVG_H - MARGIN.top - MARGIN.bottom}
                  fill={session.color}
                  stroke={session.border}
                  strokeWidth={0.5}
                  transform={`translate(${MARGIN.left}, 0)`}
                />
                <text
                  x={`${(x1 + x2) / 2}%`}
                  y={MARGIN.top + 10}
                  fill={session.border}
                  fontSize={9}
                  textAnchor="middle"
                  transform={`translate(${MARGIN.left}, 0)`}
                >
                  {session.label}
                </text>
              </g>
            );
          })}

          {/* Streak highlights */}
          {streaks
            .filter((s) => s.length >= 4)
            .map((s, i) => {
              const x1 = xPct(s.start);
              const x2 = xPct(s.end);
              return (
                <rect
                  key={i}
                  x={`${x1}%`}
                  width={`${Math.max(x2 - x1, 0.5)}%`}
                  y={MARGIN.top}
                  height={SVG_H - MARGIN.top - MARGIN.bottom}
                  fill={s.outcome === "Up" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)"}
                  rx={2}
                  transform={`translate(${MARGIN.left}, 0)`}
                />
              );
            })}

          {/* Outcome arrows */}
          {outcomes.map((o, i) => {
            const cx = xPct(o.start_time);
            const isUp = o.outcome === "Up";
            const cy = SVG_H / 2;
            return (
              <text
                key={i}
                x={`${cx}%`}
                y={cy + 5}
                fill={isUp ? "#22c55e" : "#ef4444"}
                fontSize={ARROW_H}
                textAnchor="middle"
                transform={`translate(${MARGIN.left}, 0)`}
              >
                {isUp ? "▲" : "▼"}
              </text>
            );
          })}

          {/* Hour ticks */}
          {hourTicks.map((tick) => (
            <g key={tick.label} transform={`translate(${MARGIN.left}, 0)`}>
              <line
                x1={`${tick.pct}%`}
                x2={`${tick.pct}%`}
                y1={SVG_H - MARGIN.bottom}
                y2={SVG_H - MARGIN.bottom + 4}
                stroke="#525252"
              />
              <text
                x={`${tick.pct}%`}
                y={SVG_H - 4}
                fill="#737373"
                fontSize={9}
                textAnchor="middle"
              >
                {tick.label}
              </text>
            </g>
          ))}
        </svg>
      </CardContent>
    </Card>
  );
}

interface Streak {
  outcome: "Up" | "Down";
  length: number;
  start: string;
  end: string;
}

function computeStreaks(outcomes: MarketOutcome[]): Streak[] {
  if (outcomes.length === 0) return [];
  const streaks: Streak[] = [];
  let current: Streak = {
    outcome: outcomes[0].outcome,
    length: 1,
    start: outcomes[0].start_time,
    end: outcomes[0].start_time,
  };

  for (let i = 1; i < outcomes.length; i++) {
    if (outcomes[i].outcome === current.outcome) {
      current.length++;
      current.end = outcomes[i].start_time;
    } else {
      streaks.push(current);
      current = {
        outcome: outcomes[i].outcome,
        length: 1,
        start: outcomes[i].start_time,
        end: outcomes[i].start_time,
      };
    }
  }
  streaks.push(current);
  return streaks;
}
