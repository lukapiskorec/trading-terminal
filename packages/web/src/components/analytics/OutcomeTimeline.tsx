import { useMemo, useState, useRef } from "react";
import type { MarketOutcome } from "@/types/market";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface OutcomeTimelineProps {
  outcomes: MarketOutcome[];
}

// Trading session boundaries in UTC
const SESSIONS = [
  { label: "Asia", startHour: 1, endHour: 7, color: "rgba(255, 26, 217, 0.08)", border: "rgba(255, 26, 217, 0.25)" },
  { label: "US", startHour: 14.5, endHour: 21, color: "rgba(0, 240, 255, 0.08)", border: "rgba(0, 240, 255, 0.25)" },
] as const;

const SVG_H = 80;
const BAR_W = 3;
const BAR_H = 22;
const MARGIN = { left: 40, right: 12, top: 8, bottom: 20 };

export function OutcomeTimeline({ outcomes }: OutcomeTimelineProps) {
  const streaks = useMemo(() => computeStreaks(outcomes), [outcomes]);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

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

  const handleBarHover = (idx: number, e: React.MouseEvent<SVGRectElement>) => {
    setHoveredIdx(idx);
    const container = containerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top - 8 });
    }
  };

  const hoveredOutcome = hoveredIdx !== null ? outcomes[hoveredIdx] : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Outcome Timeline</CardTitle>
        <div className="flex gap-4 text-xs text-neutral-500">
          <span className="text-magenta">■ Up (YES)</span>
          <span className="text-accent">■ Down (NO)</span>
          <span style={{ color: SESSIONS[0].border }}>■ Asia</span>
          <span style={{ color: SESSIONS[1].border }}>■ US</span>
        </div>
      </CardHeader>
      <CardContent>
        <div ref={containerRef} className="relative">
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
                    fill={s.outcome === "Up" ? "rgba(255,26,217,0.1)" : "rgba(0,240,255,0.1)"}
                    rx={2}
                    transform={`translate(${MARGIN.left}, 0)`}
                  />
                );
              })}

            {/* Outcome bars */}
            {outcomes.map((o, i) => {
              const cx = xPct(o.start_time);
              const isUp = o.outcome === "Up";
              const barY = (SVG_H - MARGIN.top - MARGIN.bottom) / 2 + MARGIN.top - BAR_H / 2;
              return (
                <rect
                  key={i}
                  x={`${cx}%`}
                  y={barY}
                  width={BAR_W}
                  height={BAR_H}
                  rx={1}
                  fill={isUp ? "#ff1ad9" : "#00f0ff"}
                  opacity={hoveredIdx === i ? 1 : 0.7}
                  transform={`translate(${MARGIN.left - BAR_W / 2}, 0)`}
                  onMouseEnter={(e) => handleBarHover(i, e)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  style={{ cursor: "crosshair" }}
                />
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

          {/* Hover tooltip */}
          {hoveredOutcome && (
            <div
              className="absolute z-10 pointer-events-none rounded bg-panel border border-theme px-2.5 py-1.5 text-xs shadow-lg"
              style={{ left: tooltipPos.x, top: tooltipPos.y, transform: "translate(-50%, -100%)" }}
            >
              <div className="font-mono text-neutral-300">
                {formatTimeUTC(hoveredOutcome.start_time)}
              </div>
              <div className={hoveredOutcome.outcome === "Up" ? "text-magenta" : "text-accent"}>
                {hoveredOutcome.outcome} — #{hoveredIdx! + 1}
              </div>
              {hoveredOutcome.volume != null && (
                <div className="text-neutral-400">${Math.round(hoveredOutcome.volume).toLocaleString()}</div>
              )}
            </div>
          )}
        </div>
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

function formatTimeUTC(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC";
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
