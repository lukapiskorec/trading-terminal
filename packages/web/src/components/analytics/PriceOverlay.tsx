import { useEffect, useRef, useState } from "react";
import type { Market, PriceSnapshot } from "@/types/market";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { MARKET_DURATION } from "@/lib/constants";

interface PriceOverlayProps {
  markets: Market[];
  snapshots: PriceSnapshot[];
}

const MAGENTA_LINE = "rgba(255, 26, 217, 0.28)";
const CYAN_LINE = "rgba(0, 240, 255, 0.28)";
const WHITE_AVG = "#ffffff";
const BAND_FILL = "rgba(255, 26, 217, 0.12)";

const PADDING = { top: 20, right: 40, bottom: 30, left: 50 };

export function PriceOverlay({ markets, snapshots }: PriceOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [resizeCount, setResizeCount] = useState(0);

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

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Group snapshots by market_id
    const byMarket = new Map<number, PriceSnapshot[]>();
    for (const snap of snapshots) {
      let arr = byMarket.get(snap.market_id);
      if (!arr) {
        arr = [];
        byMarket.set(snap.market_id, arr);
      }
      arr.push(snap);
    }

    // Build market start times lookup
    const startTimes = new Map<number, number>();
    for (const m of markets) {
      startTimes.set(m.id, new Date(m.start_time).getTime() / 1000);
    }

    // Outcome lookup
    const outcomeMap = new Map<number, string | null>();
    for (const m of markets) {
      outcomeMap.set(m.id, m.outcome);
    }

    // X: 0 to MARKET_DURATION seconds, Y: 0 to 1
    const xScale = (sec: number) => PADDING.left + (sec / MARKET_DURATION) * plotW;
    const yScale = (price: number) => PADDING.top + (1 - price) * plotH;

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

    // Draw 0.50 reference
    ctx.strokeStyle = "#525252";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(PADDING.left, yScale(0.5));
    ctx.lineTo(w - PADDING.right, yScale(0.5));
    ctx.stroke();
    ctx.setLineDash([]);

    // Collect points for average + stddev
    const avgBuckets: Map<number, number[]> = new Map();

    // Draw individual market lines
    ctx.lineWidth = 1.5;
    for (const [marketId, snaps] of byMarket) {
      const start = startTimes.get(marketId);
      if (start === undefined) continue;

      const outcome = outcomeMap.get(marketId);
      ctx.strokeStyle = outcome === "Up" ? MAGENTA_LINE : outcome === "Down" ? CYAN_LINE : "rgba(163,163,163,0.1)";

      ctx.beginPath();
      let first = true;
      for (const snap of snaps) {
        const price = snap.mid_price_yes ?? snap.last_trade_price;
        if (price === null) continue;

        const sec = new Date(snap.recorded_at).getTime() / 1000 - start;
        const x = xScale(Math.max(0, Math.min(MARKET_DURATION, sec)));
        const y = yScale(price);

        if (first) {
          ctx.moveTo(x, y);
          first = false;
        } else {
          ctx.lineTo(x, y);
        }

        // Bucket into 10-second intervals for average
        const bucket = Math.round(sec / 10) * 10;
        let arr = avgBuckets.get(bucket);
        if (!arr) {
          arr = [];
          avgBuckets.set(bucket, arr);
        }
        arr.push(price);
      }
      ctx.stroke();
    }

    // Compute average + stddev per bucket
    const avgPoints = Array.from(avgBuckets.entries())
      .map(([sec, prices]) => {
        const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
        const variance = prices.reduce((s, p) => s + (p - avg) ** 2, 0) / prices.length;
        const stdDev = Math.sqrt(variance);
        return { sec, avg, stdDev };
      })
      .sort((a, b) => a.sec - b.sec);

    // Draw std-dev band
    if (avgPoints.length > 1) {
      ctx.fillStyle = BAND_FILL;
      ctx.beginPath();
      // Top edge (avg + stdDev), left to right
      for (let i = 0; i < avgPoints.length; i++) {
        const x = xScale(avgPoints[i].sec);
        const y = yScale(avgPoints[i].avg + avgPoints[i].stdDev);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      // Bottom edge (avg - stdDev), right to left
      for (let i = avgPoints.length - 1; i >= 0; i--) {
        const x = xScale(avgPoints[i].sec);
        const y = yScale(avgPoints[i].avg - avgPoints[i].stdDev);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();

      // Draw average line (white)
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

    // Y-axis labels
    ctx.fillStyle = "#a3a3a3";
    ctx.font = "11px monospace";
    ctx.textAlign = "right";
    for (let p = 0; p <= 1; p += 0.25) {
      ctx.fillText(p.toFixed(2), PADDING.left - 6, yScale(p) + 4);
    }

    // X-axis labels
    ctx.textAlign = "center";
    for (let s = 0; s <= MARKET_DURATION; s += 60) {
      ctx.fillText(`${s}s`, xScale(s), h - 8);
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
    ctx.fillStyle = "#a3a3a3";
    ctx.fillText("± σ", PADDING.left + 128, legendY);
  }, [markets, snapshots, resizeCount]);

  // Resize handling
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      setResizeCount((c) => c + 1);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Price Overlay — All Markets</CardTitle>
        <p className="text-xs text-neutral-500">{markets.length} markets, normalized to 0–300s</p>
      </CardHeader>
      <CardContent>
        <div ref={containerRef} className="h-72 w-full">
          <canvas ref={canvasRef} className="h-full w-full" />
        </div>
      </CardContent>
    </Card>
  );
}
