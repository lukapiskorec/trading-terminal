import { useState, useRef, useEffect } from "react";
import type { MarketOutcome } from "@/types/market";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface OutcomeTimelineProps {
  outcomes: MarketOutcome[];
  onHoverSlug?: (slug: string | null) => void;
  showUp: boolean;
  showDown: boolean;
}

// Trading session boundaries in UTC
const SESSIONS = [
  { label: "Asia", startHour: 1, endHour: 7 },
  { label: "US", startHour: 14.5, endHour: 21 },
] as const;

const SVG_H = 80;
const BAR_H = 22;
const MARGIN = { left: 40, right: 12, top: 8, bottom: 20 };

export function OutcomeTimeline({ outcomes, onHoverSlug, showUp, showDown }: OutcomeTimelineProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [svgWidth, setSvgWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Always attach ResizeObserver — containerRef is always mounted now
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      setSvgWidth(entry.contentRect.width);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const hoveredOutcome = hoveredIdx !== null ? outcomes[hoveredIdx] : null;

  const handleBarHover = (idx: number, e: React.MouseEvent<SVGRectElement>) => {
    setHoveredIdx(idx);
    onHoverSlug?.(outcomes[idx].slug);
    const container = containerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top - 8 });
    }
  };

  const handleBarLeave = () => {
    setHoveredIdx(null);
    onHoverSlug?.(null);
  };

  function renderChart() {
    if (outcomes.length === 0 || svgWidth === 0) return null;

    const plotW = svgWidth - MARGIN.left - MARGIN.right;
    const dayStart = new Date(outcomes[0].start_time).getTime();
    const dayEnd = new Date(outcomes[outcomes.length - 1].start_time).getTime();
    const range = dayEnd - dayStart || 1;

    const xFromMs = (ms: number) => MARGIN.left + ((ms - dayStart) / range) * plotW;
    const barW = plotW / outcomes.length;
    const barY = (SVG_H - MARGIN.top - MARGIN.bottom) / 2 + MARGIN.top - BAR_H / 2;

    const firstHour = new Date(outcomes[0].start_time);
    firstHour.setUTCMinutes(0, 0, 0);

    const hourTicks: { label: string; x: number }[] = [];
    for (let h = 0; h < 24; h += 4) {
      const t = new Date(firstHour);
      t.setUTCHours(h);
      const x = xFromMs(t.getTime());
      if (x >= MARGIN.left && x <= svgWidth - MARGIN.right) {
        hourTicks.push({ label: `${h.toString().padStart(2, "0")}:00`, x });
      }
    }

    const streaks = computeStreaks(outcomes);

    return (
      <svg width={svgWidth} height={SVG_H} className="overflow-visible">
        {/* Trading session outlines */}
        {SESSIONS.map((session) => {
          const sStart = new Date(firstHour);
          sStart.setUTCHours(Math.floor(session.startHour), (session.startHour % 1) * 60);
          const sEnd = new Date(firstHour);
          sEnd.setUTCHours(Math.floor(session.endHour), (session.endHour % 1) * 60);
          const x1 = Math.max(MARGIN.left, xFromMs(sStart.getTime()));
          const x2 = Math.min(svgWidth - MARGIN.right, xFromMs(sEnd.getTime()));
          if (x2 <= MARGIN.left || x1 >= svgWidth - MARGIN.right) return null;
          return (
            <g key={session.label}>
              <rect
                x={x1}
                width={x2 - x1}
                y={MARGIN.top}
                height={SVG_H - MARGIN.top - MARGIN.bottom}
                fill="none"
                stroke="rgba(255,255,255,1.0)"
                strokeWidth={1}
                strokeDasharray="5 3"
              />
              <text
                x={(x1 + x2) / 2}
                y={MARGIN.top + 10}
                fill="rgba(255,255,255,1.0)"
                fontSize={9}
                textAnchor="middle"
              >
                {session.label}
              </text>
            </g>
          );
        })}

        {/* Streak highlights — only for visible outcome types */}
        {streaks
          .filter((s) => s.length >= 4 && ((s.outcome === "Up" && showUp) || (s.outcome === "Down" && showDown)))
          .map((s, i) => {
            const x1 = xFromMs(new Date(s.start).getTime());
            const x2 = xFromMs(new Date(s.end).getTime());
            return (
              <rect
                key={i}
                x={Math.max(MARGIN.left, x1)}
                width={Math.max(x2 - x1 + barW, 2)}
                y={MARGIN.top}
                height={SVG_H - MARGIN.top - MARGIN.bottom}
                fill={s.outcome === "Up" ? "rgba(255,26,217,0.25)" : "rgba(0,240,255,0.25)"}
              />
            );
          })}

        {/* Outcome bars — invisible gaps for filtered outcomes, scale unchanged */}
        {outcomes.map((o, i) => {
          const isUp = o.outcome === "Up";
          const visible = (isUp && showUp) || (!isUp && showDown);
          return (
            <rect
              key={i}
              x={MARGIN.left + i * barW}
              y={barY}
              width={barW}
              height={BAR_H}
              fill={visible ? (isUp ? "#ff1ad9" : "#00f0ff") : "transparent"}
              opacity={!visible ? 0 : hoveredIdx === i ? 1 : 0.7}
              onMouseEnter={visible ? (e) => handleBarHover(i, e) : undefined}
              onMouseLeave={visible ? handleBarLeave : undefined}
              style={{ cursor: visible ? "crosshair" : "default" }}
            />
          );
        })}

        {/* Hour ticks */}
        {hourTicks.map((tick) => (
          <g key={tick.label}>
            <line
              x1={tick.x}
              x2={tick.x}
              y1={SVG_H - MARGIN.bottom}
              y2={SVG_H - MARGIN.bottom + 4}
              stroke="#525252"
            />
            <text
              x={tick.x}
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
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Outcome Timeline</CardTitle>
        <div className="flex gap-4 text-xs text-neutral-500">
          <span className="text-magenta">■ Up (YES)</span>
          <span className="text-accent">■ Down (NO)</span>
          <span style={{ color: "rgba(255,255,255,1.0)" }}>□ Sessions</span>
        </div>
      </CardHeader>
      <CardContent>
        <div ref={containerRef} className="relative">
          {outcomes.length === 0 ? (
            <p className="text-sm text-neutral-500">No data</p>
          ) : (
            renderChart()
          )}

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
