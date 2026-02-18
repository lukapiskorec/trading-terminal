import { useEffect, useRef, useState } from "react";
import type { Market, PriceSnapshot } from "@/types/market";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { MARKET_DURATION } from "@/lib/constants";

interface PriceOverlayProps {
  markets: Market[];
  snapshots: PriceSnapshot[];
  highlightedMarketId?: number | null;
}

const MAGENTA_LINE = "rgba(255, 26, 217, 0.28)";
const CYAN_LINE = "rgba(0, 240, 255, 0.28)";
const WHITE_AVG = "#ffffff";
const STD_DEV_LINE = "#ffffff";

const PADDING = { top: 20, right: 40, bottom: 30, left: 50 };

export function PriceOverlay({ markets, snapshots, highlightedMarketId }: PriceOverlayProps) {
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

    ctx.clearRect(0, 0, w, h);

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

    // 0.50 reference
    ctx.strokeStyle = "#525252";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(PADDING.left, yScale(0.5));
    ctx.lineTo(w - PADDING.right, yScale(0.5));
    ctx.stroke();
    ctx.setLineDash([]);

    // Collect all prices into avg buckets (all markets, before drawing)
    const avgBuckets: Map<number, number[]> = new Map();
    for (const [marketId, snaps] of byMarket) {
      const start = startTimes.get(marketId);
      if (start === undefined) continue;
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
        const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
        const variance = prices.reduce((s, p) => s + (p - avg) ** 2, 0) / prices.length;
        const stdDev = Math.sqrt(variance);
        return { sec, avg, stdDev };
      })
      .sort((a, b) => a.sec - b.sec);

    // Draw std-dev dashed lines (avg ± 1σ)
    if (avgPoints.length > 1) {
      ctx.strokeStyle = STD_DEV_LINE;
      ctx.lineWidth = 2; // 75% of avg line's 2.5, rounded
      ctx.setLineDash([4, 4]);

      // Upper bound: avg + σ
      ctx.beginPath();
      avgPoints.forEach((pt, i) => {
        const x = xScale(pt.sec);
        const y = yScale(Math.min(1, pt.avg + pt.stdDev));
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Lower bound: avg − σ
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

    // Draw highlighted market line on top
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
    // Std dev legend: small dashed line segment + label
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
  }, [markets, snapshots, resizeCount, highlightedMarketId]);

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
