import { useCallback, useEffect, useRef, useState } from "react";
import type { PriceSnapshot } from "@/types/market";
import { MARKET_DURATION } from "@/lib/constants";

interface MarketPriceChartProps {
  snapshots: PriceSnapshot[];
  marketStartTime: string;
  entryTime?: string;
  entryPrice?: number;
  outcome?: "YES" | "NO";
  height?: number;
}

const PAD = { top: 12, right: 30, bottom: 24, left: 45 };
const LINE_COLOR = "rgba(0, 240, 255, 0.85)";
const ENTRY_COLOR = "#ff1ad9";

export function MarketPriceChart({
  snapshots,
  marketStartTime,
  entryTime,
  entryPrice,
  outcome = "YES",
  height = 160,
}: MarketPriceChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hoverInfo, setHoverInfo] = useState<{ x: number; price: number; sec: number } | null>(null);

  const startMs = new Date(marketStartTime).getTime();

  const points = snapshots
    .map((s) => {
      const rawPrice = s.mid_price_yes ?? s.best_bid_yes ?? 0.5;
      return {
        sec: (new Date(s.recorded_at).getTime() - startMs) / 1000,
        price: outcome === "NO" ? 1 - rawPrice : rawPrice,
      };
    })
    .filter((p) => p.sec >= 0 && p.sec <= MARKET_DURATION && p.price > 0 && p.price < 1)
    .sort((a, b) => a.sec - b.sec);

  const entrySec = entryTime
    ? (new Date(entryTime).getTime() - startMs) / 1000
    : null;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => setWidth(container.getBoundingClientRect().width));
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const w = rect.width;
    if (w === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);

    const plotW = w - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;

    const xScale = (sec: number) => PAD.left + (sec / MARKET_DURATION) * plotW;
    const yScale = (p: number) => PAD.top + (1 - p) * plotH;

    ctx.clearRect(0, 0, w, height);

    // Grid lines
    ctx.strokeStyle = "#1a0f22";
    ctx.lineWidth = 0.5;
    ctx.setLineDash([]);
    for (let p = 0; p <= 1; p += 0.25) {
      const y = yScale(p);
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(w - PAD.right, y);
      ctx.stroke();
    }

    // 0.5 reference
    ctx.strokeStyle = "#404040";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(PAD.left, yScale(0.5));
    ctx.lineTo(w - PAD.right, yScale(0.5));
    ctx.stroke();
    ctx.setLineDash([]);

    // Y axis labels
    ctx.fillStyle = "#525252";
    ctx.font = "10px monospace";
    ctx.textAlign = "right";
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      ctx.fillText(p.toFixed(2), PAD.left - 4, yScale(p) + 3);
    }

    // X axis labels
    ctx.textAlign = "center";
    for (const sec of [0, 60, 120, 180, 240, 300]) {
      ctx.fillText(`${sec}s`, xScale(sec), height - PAD.bottom + 14);
    }

    if (points.length === 0) {
      ctx.fillStyle = "#525252";
      ctx.textAlign = "center";
      ctx.font = "11px sans-serif";
      ctx.fillText("No price data", w / 2, height / 2);
      return;
    }

    // Price line
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    points.forEach((pt, i) => {
      const x = xScale(pt.sec);
      const y = yScale(pt.price);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Entry marker
    if (entrySec !== null && entryPrice !== undefined && entryPrice > 0 && entryPrice < 1) {
      const ex = xScale(entrySec);
      const ey = yScale(entryPrice);

      ctx.strokeStyle = ENTRY_COLOR;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);

      ctx.beginPath();
      ctx.moveTo(ex, PAD.top);
      ctx.lineTo(ex, PAD.top + plotH);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(PAD.left, ey);
      ctx.lineTo(w - PAD.right, ey);
      ctx.stroke();

      ctx.setLineDash([]);

      ctx.fillStyle = ENTRY_COLOR;
      ctx.beginPath();
      ctx.arc(ex, ey, 4, 0, Math.PI * 2);
      ctx.fill();

      // Label: prefer right side, flip to left if near edge
      const labelX = ex + 6 + 60 > w - PAD.right ? ex - 66 : ex + 6;
      ctx.fillStyle = ENTRY_COLOR;
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "left";
      ctx.fillText(`entry ${entryPrice.toFixed(3)}`, labelX, ey - 5);
    }

    // Hover crosshair (drawn last, on top)
    if (hoverInfo) {
      const { x, price, sec } = hoverInfo;
      const hy = yScale(price);

      ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);

      ctx.beginPath();
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, PAD.top + plotH);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(PAD.left, hy);
      ctx.lineTo(w - PAD.right, hy);
      ctx.stroke();

      ctx.setLineDash([]);

      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x, hy, 3, 0, Math.PI * 2);
      ctx.fill();

      // Price on Y axis
      ctx.fillStyle = "#ffffff";
      ctx.font = "10px monospace";
      ctx.textAlign = "right";
      ctx.fillText(price.toFixed(3), PAD.left - 4, hy + 4);

      // Time on X axis
      ctx.textAlign = "center";
      ctx.fillText(`${Math.round(sec)}s`, x, height - PAD.bottom + 14);
    }
  }, [points, entrySec, entryPrice, hoverInfo, height, width]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (points.length === 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const w = rect.width;
      const plotW = w - PAD.left - PAD.right;

      const sec = Math.max(
        0,
        Math.min(MARKET_DURATION, ((mouseX - PAD.left) / plotW) * MARKET_DURATION),
      );

      let nearest = points[0];
      let minDist = Math.abs(points[0].sec - sec);
      for (const pt of points) {
        const d = Math.abs(pt.sec - sec);
        if (d < minDist) {
          minDist = d;
          nearest = pt;
        }
      }

      const xScale = (s: number) => PAD.left + (s / MARKET_DURATION) * plotW;
      setHoverInfo({ x: xScale(nearest.sec), price: nearest.price, sec: nearest.sec });
    },
    [points],
  );

  const handleMouseLeave = useCallback(() => setHoverInfo(null), []);

  return (
    <div ref={containerRef} className="w-full bg-surface rounded">
      <canvas
        ref={canvasRef}
        style={{ height, display: "block" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="cursor-crosshair w-full"
      />
    </div>
  );
}
