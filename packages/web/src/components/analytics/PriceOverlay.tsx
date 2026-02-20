import { useEffect, useRef, useState } from "react";
import type { Market, PriceSnapshot } from "@/types/market";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { MARKET_DURATION } from "@/lib/constants";

interface PriceOverlayProps {
  markets: Market[];
  snapshots: PriceSnapshot[];
  highlightedMarketId?: number | null;
  showUp: boolean;
  showDown: boolean;
  onToggleUp: () => void;
  onToggleDown: () => void;
}

const MAGENTA_LINE = "rgba(255, 26, 217, 0.28)";
const CYAN_LINE = "rgba(0, 240, 255, 0.28)";
const WHITE_AVG = "#ffffff";
const STD_DEV_LINE = "#ffffff";

const PADDING = { top: 20, right: 40, bottom: 30, left: 50 };

type OverlayMethod = "mean" | "median";

interface HoverInfo {
  x: number;
  y: number;
  tc: number;
  avg: number;
  stdDev: number;
  avgY: number;
  upperY: number;
  lowerY: number;
  containerWidth: number;
}

function medianOfArr(arr: number[]): number {
  if (arr.length === 0) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function PriceOverlay({ markets, snapshots, highlightedMarketId, showUp, showDown, onToggleUp, onToggleDown }: PriceOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const avgPointsRef = useRef<{ sec: number; avg: number; stdDev: number }[]>([]);
  const [resizeCount, setResizeCount] = useState(0);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [overlayMethod, setOverlayMethod] = useState<OverlayMethod>("mean");

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || markets.length === 0) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";

    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const plotW = w - PADDING.left - PADDING.right;
    const plotH = h - PADDING.top - PADDING.bottom;

    ctx.clearRect(0, 0, w, h);

    const xScale = (sec: number) => PADDING.left + (sec / MARKET_DURATION) * plotW;
    const yScale = (price: number) => PADDING.top + (1 - price) * plotH;

    // Group snapshots by market_id
    const byMarket = new Map<number, PriceSnapshot[]>();
    for (const snap of snapshots) {
      let arr = byMarket.get(snap.market_id);
      if (!arr) { arr = []; byMarket.set(snap.market_id, arr); }
      arr.push(snap);
    }

    // Build lookups
    const startTimes = new Map<number, number>();
    const outcomeMap = new Map<number, string | null>();
    for (const m of markets) {
      startTimes.set(m.id, new Date(m.start_time).getTime() / 1000);
      outcomeMap.set(m.id, m.outcome);
    }

    // Draw grid
    ctx.strokeStyle = "#1a0f22";
    ctx.lineWidth = 0.5;
    for (let p = 0; p <= 1; p += 0.25) {
      const y = yScale(p);
      ctx.beginPath();
      ctx.moveTo(PADDING.left, y);
      ctx.lineTo(w - PADDING.right, y);
      ctx.stroke();
    }

    // 0.50 reference
    ctx.strokeStyle = "#525252";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(PADDING.left, yScale(0.5));
    ctx.lineTo(w - PADDING.right, yScale(0.5));
    ctx.stroke();
    ctx.setLineDash([]);

    // Collect prices into avg buckets — only from visible (non-filtered) markets
    const avgBuckets: Map<number, number[]> = new Map();
    for (const [marketId, snaps] of byMarket) {
      const start = startTimes.get(marketId);
      if (start === undefined) continue;
      const outcome = outcomeMap.get(marketId);
      if (outcome === "Up" && !showUp) continue;
      if (outcome === "Down" && !showDown) continue;
      for (const snap of snaps) {
        const price = snap.mid_price_yes ?? snap.last_trade_price;
        if (price === null) continue;
        const sec = new Date(snap.recorded_at).getTime() / 1000 - start;
        const bucket = Math.round(sec / 10) * 10;
        let arr = avgBuckets.get(bucket);
        if (!arr) { arr = []; avgBuckets.set(bucket, arr); }
        arr.push(price);
      }
    }

    // Draw non-highlighted market lines
    ctx.lineWidth = 1.5;
    for (const [marketId, snaps] of byMarket) {
      if (marketId === highlightedMarketId) continue;
      const start = startTimes.get(marketId);
      if (start === undefined) continue;
      const outcome = outcomeMap.get(marketId);
      if (outcome === "Up" && !showUp) continue;
      if (outcome === "Down" && !showDown) continue;
      ctx.strokeStyle = outcome === "Up" ? MAGENTA_LINE : outcome === "Down" ? CYAN_LINE : "rgba(163,163,163,0.1)";
      ctx.beginPath();
      let first = true;
      for (const snap of snaps) {
        const price = snap.mid_price_yes ?? snap.last_trade_price;
        if (price === null) continue;
        const sec = new Date(snap.recorded_at).getTime() / 1000 - start;
        const x = xScale(Math.max(0, Math.min(MARKET_DURATION, sec)));
        const y = yScale(price);
        if (first) { ctx.moveTo(x, y); first = false; } else { ctx.lineTo(x, y); }
      }
      ctx.stroke();
    }

    // Compute avg + stddev per bucket
    const avgPoints = Array.from(avgBuckets.entries())
      .map(([sec, prices]) => {
        const avg = overlayMethod === "median"
          ? medianOfArr(prices)
          : prices.reduce((a, b) => a + b, 0) / prices.length;
        const variance = prices.reduce((s, p) => s + (p - avg) ** 2, 0) / prices.length;
        const stdDev = Math.sqrt(variance);
        return { sec, avg, stdDev };
      })
      .sort((a, b) => a.sec - b.sec);

    // Store for hover lookup
    avgPointsRef.current = avgPoints;

    // Draw std-dev dashed bands
    if (avgPoints.length > 1) {
      ctx.strokeStyle = STD_DEV_LINE;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);

      ctx.beginPath();
      avgPoints.forEach((pt, i) => {
        const x = xScale(pt.sec);
        const y = yScale(Math.min(1, pt.avg + pt.stdDev));
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();

      ctx.beginPath();
      avgPoints.forEach((pt, i) => {
        const x = xScale(pt.sec);
        const y = yScale(Math.max(0, pt.avg - pt.stdDev));
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();

      ctx.setLineDash([]);

      // Average line (solid white)
      ctx.strokeStyle = WHITE_AVG;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      avgPoints.forEach((pt, i) => {
        const x = xScale(pt.sec);
        const y = yScale(pt.avg);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // Highlighted market line on top
    if (highlightedMarketId != null) {
      const snaps = byMarket.get(highlightedMarketId);
      const start = startTimes.get(highlightedMarketId);
      if (snaps && start !== undefined) {
        const outcome = outcomeMap.get(highlightedMarketId);
        ctx.strokeStyle = outcome === "Up" ? "#ff1ad9" : "#00f0ff";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        let first = true;
        for (const snap of snaps) {
          const price = snap.mid_price_yes ?? snap.last_trade_price;
          if (price === null) continue;
          const sec = new Date(snap.recorded_at).getTime() / 1000 - start;
          const x = xScale(Math.max(0, Math.min(MARKET_DURATION, sec)));
          const y = yScale(price);
          if (first) { ctx.moveTo(x, y); first = false; } else { ctx.lineTo(x, y); }
        }
        ctx.stroke();
      }
    }

    // Y-axis labels
    ctx.fillStyle = "#a3a3a3";
    ctx.font = "11px monospace";
    ctx.textAlign = "right";
    for (let p = 0; p <= 1; p += 0.25) {
      ctx.fillText(p.toFixed(2), PADDING.left - 6, yScale(p) + 4);
    }

    // X-axis labels — show time-to-close (300s → 0s left to right)
    ctx.textAlign = "center";
    for (let s = 0; s <= MARKET_DURATION; s += 60) {
      const tc = MARKET_DURATION - s;
      ctx.fillText(`${tc}s`, xScale(s), h - 8);
    }

    // Legend
    ctx.font = "11px sans-serif";
    ctx.textAlign = "left";
    const legendY = 14;
    ctx.fillStyle = "#ff1ad9";
    ctx.fillText("■", PADDING.left, legendY);
    ctx.fillStyle = "#a3a3a3";
    ctx.fillText(" Up", PADDING.left + 10, legendY);
    ctx.fillStyle = "#00f0ff";
    ctx.fillText("■", PADDING.left + 38, legendY);
    ctx.fillStyle = "#a3a3a3";
    ctx.fillText(" Down", PADDING.left + 48, legendY);
    ctx.fillStyle = WHITE_AVG;
    ctx.fillText("— Avg", PADDING.left + 88, legendY);
    const bandX = PADDING.left + 132;
    ctx.strokeStyle = STD_DEV_LINE;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(bandX, legendY - 3);
    ctx.lineTo(bandX + 12, legendY - 3);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#a3a3a3";
    ctx.fillText(" Std Dev (±1σ)", bandX + 12, legendY);
  }, [markets, snapshots, resizeCount, highlightedMarketId, overlayMethod, showUp, showDown]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      setResizeCount((c) => c + 1);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    const pts = avgPointsRef.current;
    if (!container || pts.length === 0) return;

    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const plotW = rect.width - PADDING.left - PADDING.right;
    const plotH = rect.height - PADDING.top - PADDING.bottom;

    // Only show tooltip within plot area
    if (mouseX < PADDING.left || mouseX > rect.width - PADDING.right) {
      setHoverInfo(null);
      return;
    }

    // Convert pixel x to elapsed seconds
    const fraction = (mouseX - PADDING.left) / plotW;
    const secElapsed = Math.max(0, Math.min(MARKET_DURATION, fraction * MARKET_DURATION));
    const tc = Math.round(MARKET_DURATION - secElapsed);

    // Find nearest avgPoint by elapsed seconds
    let nearest = pts[0];
    let minDist = Math.abs(pts[0].sec - secElapsed);
    for (const pt of pts) {
      const d = Math.abs(pt.sec - secElapsed);
      if (d < minDist) { minDist = d; nearest = pt; }
    }

    const yScale = (price: number) => PADDING.top + (1 - price) * plotH;
    const avgY = yScale(nearest.avg);
    const upperY = yScale(Math.min(1, nearest.avg + nearest.stdDev));
    const lowerY = yScale(Math.max(0, nearest.avg - nearest.stdDev));

    setHoverInfo({
      x: mouseX,
      y: mouseY,
      tc,
      avg: nearest.avg,
      stdDev: nearest.stdDev,
      avgY,
      upperY,
      lowerY,
      containerWidth: rect.width,
    });
  };

  const handleMouseLeave = () => setHoverInfo(null);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>Price Overlay — All Markets</CardTitle>
            <p className="text-xs text-neutral-500">{markets.length} markets · X axis: seconds to close</p>
          </div>
          <div className="flex gap-2">
            {/* UP / DOWN toggles */}
            <div className="flex gap-1">
              <button
                onClick={onToggleUp}
                className={`px-2 py-0.5 text-xs border transition-colors ${
                  showUp
                    ? "border-magenta text-magenta bg-magenta/10"
                    : "border-neutral-700 text-neutral-600"
                }`}
              >
                ▲ Up
              </button>
              <button
                onClick={onToggleDown}
                className={`px-2 py-0.5 text-xs border transition-colors ${
                  showDown
                    ? "border-cyan-400 text-cyan-400 bg-cyan-500/10"
                    : "border-neutral-700 text-neutral-600"
                }`}
              >
                ▼ Down
              </button>
            </div>
            {/* Mean / Median toggle */}
            <div className="flex gap-1">
              {(["mean", "median"] as OverlayMethod[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setOverlayMethod(m)}
                  className={`px-2 py-0.5 text-xs border transition-colors ${
                    overlayMethod === m
                      ? "border-neutral-400 text-neutral-200"
                      : "border-neutral-700 text-neutral-500 hover:border-neutral-500"
                  }`}
                >
                  {m === "mean" ? "Mean" : "Median"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div
          ref={containerRef}
          className="h-72 w-full relative"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <canvas ref={canvasRef} className="h-full w-full" />

          {/* SVG overlay for crosshair and dots */}
          {hoverInfo && (
            <svg
              className="absolute inset-0 pointer-events-none"
              style={{ width: "100%", height: "100%", overflow: "visible" }}
            >
              {/* Vertical crosshair */}
              <line
                x1={hoverInfo.x}
                y1={PADDING.top}
                x2={hoverInfo.x}
                y2={`calc(100% - ${PADDING.bottom}px)`}
                stroke="rgba(255,255,255,0.25)"
                strokeWidth={1}
              />
              {/* Dots at avg ± stdDev */}
              <circle cx={hoverInfo.x} cy={hoverInfo.upperY} r={4} fill="rgba(163,163,163,0.85)" />
              <circle cx={hoverInfo.x} cy={hoverInfo.avgY} r={5} fill="white" />
              <circle cx={hoverInfo.x} cy={hoverInfo.lowerY} r={4} fill="rgba(163,163,163,0.85)" />
            </svg>
          )}

          {/* Hover tooltip — stacked price display */}
          {hoverInfo && (
            <div
              className="absolute pointer-events-none z-10 bg-panel border border-theme px-2 py-1 text-xs font-mono shadow-lg"
              style={{
                left: hoverInfo.x > hoverInfo.containerWidth / 2
                  ? hoverInfo.x - 8
                  : hoverInfo.x + 8,
                top: hoverInfo.y,
                transform: hoverInfo.x > hoverInfo.containerWidth / 2
                  ? "translate(-100%, -50%)"
                  : "translate(0, -50%)",
              }}
            >
              <div className="text-neutral-500 text-right">
                {Math.min(1, hoverInfo.avg + hoverInfo.stdDev).toFixed(3)}
              </div>
              <div className="text-neutral-100 text-right">
                {hoverInfo.avg.toFixed(3)}
              </div>
              <div className="text-neutral-500 text-right">
                {Math.max(0, hoverInfo.avg - hoverInfo.stdDev).toFixed(3)}
              </div>
              <div className="text-neutral-600 text-right" style={{ fontSize: 9 }}>
                {hoverInfo.tc}s to close
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
