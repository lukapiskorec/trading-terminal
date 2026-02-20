import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import type { BtcIndicatorSnapshot, Market, MarketOutcome } from "@/types/market";
import type { IndicatorFormula } from "@/types/formula";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useFormulaStore } from "@/stores/formulaStore";

interface BtcIndicatorHeatmapProps {
  outcomes: MarketOutcome[];
  markets: Market[];
  btcIndicators: BtcIndicatorSnapshot[];
  loading: boolean;
  date: string;
}

type OutcomeFilter = "UP" | "DOWN";
type AvgMethod = "trimmed" | "median";
type TimeWindow = "5min" | "15min";

// --- Indicator definitions ---

interface IndicatorDef {
  label: string;
  extract: (s: BtcIndicatorSnapshot) => number | null;
  normalize: "static" | "dynamic";
}

const INDICATORS: IndicatorDef[] = [
  { label: "OBI", extract: (s) => s.obi, normalize: "static" },
  { label: "CVD", extract: (s) => s.cvd_5m, normalize: "dynamic" },
  { label: "RSI", extract: (s) => (s.rsi !== null ? (50 - s.rsi) / 50 : null), normalize: "static" },
  { label: "MACD", extract: (s) => s.macd_histogram, normalize: "dynamic" },
  { label: "EMA Cross", extract: (s) => (s.ema5 !== null && s.ema20 !== null ? s.ema5 - s.ema20 : null), normalize: "dynamic" },
  { label: "VWAP", extract: (s) => (s.btc_mid !== null && s.vwap !== null && s.btc_mid !== 0 ? (s.btc_mid - s.vwap) / s.btc_mid : null), normalize: "dynamic" },
  { label: "HA Streak", extract: (s) => (s.ha_streak !== null ? s.ha_streak / 3 : null), normalize: "static" },
  { label: "POC", extract: (s) => (s.btc_mid !== null && s.poc !== null && s.btc_mid !== 0 ? (s.btc_mid - s.poc) / s.btc_mid : null), normalize: "dynamic" },
  {
    label: "Walls",
    extract: (s) => {
      if (s.bid_walls === null || s.ask_walls === null) return null;
      const total = Math.max(s.bid_walls + s.ask_walls, 1);
      return (s.bid_walls - s.ask_walls) / total;
    },
    normalize: "static",
  },
  { label: "BBands %B", extract: (s) => (s.bbands_pct_b !== null ? (0.5 - s.bbands_pct_b) / 0.5 : null), normalize: "static" },
  { label: "Flow Toxic", extract: (s) => s.flow_toxicity, normalize: "static" },
  { label: "ROC", extract: (s) => s.roc, normalize: "dynamic" },
];

const NUM_INDICATORS = INDICATORS.length; // 12

// --- Layout constants ---
const CELL_H = 16;
const ROW_GAP = 2;
const ROW_TOTAL = CELL_H + ROW_GAP; // 18
const TOTAL_H = ROW_TOTAL * NUM_INDICATORS; // 216
const LABEL_WIDTH = 80;

// --- Color function ---
function valueToColor(v: number): string {
  if (!isFinite(v)) return "transparent";
  const c = Math.max(-1, Math.min(1, v));
  if (c >= 0) {
    const t = c;
    return `rgb(${Math.round(255 * t)},${Math.round(26 * t)},${Math.round(20 + 197 * t)})`;
  } else {
    const t = -c;
    return `rgb(${Math.round(15 * (1 - t))},${Math.round(8 + 232 * t)},${Math.round(20 + 235 * t)})`;
  }
}

// --- Stats helpers ---
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function mean(vals: number[]): number {
  if (vals.length === 0) return NaN;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function stddev(vals: number[]): number {
  if (vals.length < 2) return NaN;
  const m = mean(vals);
  return Math.sqrt(vals.reduce((acc, v) => acc + (v - m) ** 2, 0) / vals.length);
}

function median(vals: number[]): number {
  if (vals.length === 0) return NaN;
  const sorted = [...vals].sort((a, b) => a - b);
  return percentile(sorted, 0.5);
}

function trimmedMean(vals: number[], pct = 0.1): number {
  if (vals.length === 0) return NaN;
  const sorted = [...vals].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length * pct);
  const trimmed = sorted.slice(cut, sorted.length - cut);
  return trimmed.length === 0 ? NaN : mean(trimmed);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// --- Formula value computation ---
function computeFormulaValue(formula: IndicatorFormula, avgGrid: number[][], numCols: number): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const w = formula.indicatorWeights[i];
    if (w === 0) continue;
    const [leftFrac, rightFrac] = formula.sliderPositions[i];
    const leftCol = Math.round(leftFrac * numCols);
    const rightCol = Math.min(numCols - 1, Math.round(rightFrac * numCols) - 1);
    if (leftCol > rightCol) continue;
    const vals = avgGrid[i].slice(leftCol, rightCol + 1).filter(isFinite);
    if (vals.length === 0) continue;
    const agg = formula.aggregation === "trimmed" ? trimmedMean(vals) : median(vals);
    if (isFinite(agg)) sum += w * agg;
  }
  return sum;
}

// --- SliderOverlay sub-component ---
interface DragState {
  indicatorIdx: number;
  handle: "left" | "right" | "body";
  startX: number;
  startRange: [number, number];
  gridWidth: number;
}

interface SliderOverlayProps {
  formula: IndicatorFormula;
  canvasWidth: number;
}

function SliderOverlay({ formula, canvasWidth }: SliderOverlayProps) {
  const updateSliderPosition = useFormulaStore((s) => s.updateSliderPosition);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dFrac = (e.clientX - drag.startX) / drag.gridWidth;
      const [startL, startR] = drag.startRange;
      let newL = startL;
      let newR = startR;
      if (drag.handle === "left") {
        newL = clamp(startL + dFrac, 0, startR - 0.01);
      } else if (drag.handle === "right") {
        newR = clamp(startR + dFrac, startL + 0.01, 1);
      } else {
        const w = startR - startL;
        newL = clamp(startL + dFrac, 0, 1 - w);
        newR = newL + w;
      }
      updateSliderPosition(formula.id, drag.indicatorIdx, [newL, newR]);
    };
    const onUp = () => { dragRef.current = null; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [formula.id, updateSliderPosition]);

  const startDrag = (indIdx: number, handle: DragState["handle"], e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      indicatorIdx: indIdx,
      handle,
      startX: e.clientX,
      startRange: [...formula.sliderPositions[indIdx]] as [number, number],
      gridWidth: canvasWidth,
    };
  };

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 10 }}>
      {formula.sliderPositions.map(([leftFrac, rightFrac], indIdx) => {
        // Skip slider for disabled indicators
        if (formula.indicatorWeights[indIdx] === 0) return null;
        const rowY = indIdx * ROW_TOTAL;
        return (
          <div key={indIdx} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none" }}>
            {/* Left handle */}
            <div
              style={{
                position: "absolute",
                left: `${leftFrac * 100}%`,
                top: rowY,
                width: 5,
                height: CELL_H,
                border: "1px solid rgba(255,255,255,0.9)",
                background: "rgba(255,255,255,0.15)",
                cursor: "ew-resize",
                pointerEvents: "auto",
                boxSizing: "border-box",
                transform: "translateX(-50%)",
              }}
              onMouseDown={(e) => startDrag(indIdx, "left", e)}
            />
            {/* Body */}
            <div
              style={{
                position: "absolute",
                left: `${leftFrac * 100}%`,
                right: `${(1 - rightFrac) * 100}%`,
                top: rowY,
                height: CELL_H,
                borderTop: "1px solid rgba(255,255,255,0.7)",
                borderBottom: "1px solid rgba(255,255,255,0.7)",
                cursor: "move",
                pointerEvents: "auto",
                boxSizing: "border-box",
              }}
              onMouseDown={(e) => startDrag(indIdx, "body", e)}
            />
            {/* Right handle */}
            <div
              style={{
                position: "absolute",
                left: `${rightFrac * 100}%`,
                top: rowY,
                width: 5,
                height: CELL_H,
                border: "1px solid rgba(255,255,255,0.9)",
                background: "rgba(255,255,255,0.15)",
                cursor: "ew-resize",
                pointerEvents: "auto",
                boxSizing: "border-box",
                transform: "translateX(-50%)",
              }}
              onMouseDown={(e) => startDrag(indIdx, "right", e)}
            />
          </div>
        );
      })}
    </div>
  );
}

// --- Main component ---
export function BtcIndicatorHeatmap({ outcomes, markets, btcIndicators, loading, date }: BtcIndicatorHeatmapProps) {
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("UP");
  const [avgMethod, setAvgMethod] = useState<AvgMethod>("trimmed");
  const [canvasWidth, setCanvasWidth] = useState(0);
  const [hoverInfo, setHoverInfo] = useState<{
    rowIdx: number;
    tc: number;
    avgValue: number;
    stdValue: number;
    x: number;
    y: number;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Callback ref pattern: ResizeObserver re-attaches whenever the element mounts/unmounts.
  // This is critical because the canvas container only renders after data loads (past early returns),
  // so a plain useRef with [] deps would miss the mount and canvasWidth would stay 0.
  const [canvasContainerEl, setCanvasContainerEl] = useState<HTMLDivElement | null>(null);

  const { formulas, activeFormulaId5min, activeFormulaId15min, updateOutputValue, timeWindow, setTimeWindow } = useFormulaStore();
  const activeFormulaId = timeWindow === "5min" ? activeFormulaId5min : activeFormulaId15min;
  const activeFormula = formulas.find((f) => f.id === activeFormulaId) ?? null;

  const NUM_COLS = timeWindow === "5min" ? 300 : 900;
  const PRE_MARKET = NUM_COLS - 300; // 0 for 5min, 600 for 15min

  // Track canvas container width via callback ref
  useEffect(() => {
    if (!canvasContainerEl) {
      setCanvasWidth(0);
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      setCanvasWidth(entry.contentRect.width);
    });
    observer.observe(canvasContainerEl);
    return () => observer.disconnect();
  }, [canvasContainerEl]);

  // Build unix-second → snapshot lookup
  const btcMap = useMemo(() => {
    const map = new Map<number, BtcIndicatorSnapshot>();
    for (const s of btcIndicators) {
      const sec = Math.floor(new Date(s.recorded_at).getTime() / 1000);
      map.set(sec, s);
    }
    return map;
  }, [btcIndicators]);

  // Day-level percentile bounds for dynamic indicators
  const dynamicBounds = useMemo(() => {
    return INDICATORS.map((ind) => {
      if (ind.normalize !== "dynamic") return { p5: 0, p95: 1 };
      const vals: number[] = [];
      for (const s of btcIndicators) {
        const v = ind.extract(s);
        if (v !== null && isFinite(v)) vals.push(v);
      }
      if (vals.length < 2) return { p5: 0, p95: 1 };
      vals.sort((a, b) => a - b);
      return { p5: percentile(vals, 0.05), p95: percentile(vals, 0.95) };
    });
  }, [btcIndicators]);

  const heatmapData = useMemo(() => {
    const targetBinary = outcomeFilter === "UP" ? 1 : 0;
    const filteredMarkets = markets.filter((m) => {
      const o = outcomes.find((o) => o.slug === m.slug);
      return o !== undefined && o.outcome_binary === targetBinary;
    });

    if (filteredMarkets.length === 0) return null;

    // col=0 = leftmost = market start (highest tc), col=NUM_COLS-1 = rightmost = tc=0
    const rawBuckets: number[][][] = Array.from({ length: NUM_INDICATORS }, () =>
      Array.from({ length: NUM_COLS }, () => [])
    );

    for (const market of filteredMarkets) {
      const marketStartSec = Math.floor(new Date(market.start_time).getTime() / 1000);

      for (let offset = 0; offset < NUM_COLS; offset++) {
        const btcSec = marketStartSec - PRE_MARKET + offset;
        const snapshot = btcMap.get(btcSec);
        if (!snapshot) continue;

        const col = offset;

        for (let i = 0; i < NUM_INDICATORS; i++) {
          const ind = INDICATORS[i];
          const raw = ind.extract(snapshot);
          if (raw === null || !isFinite(raw)) continue;

          let normalized: number;
          if (ind.normalize === "static") {
            normalized = clamp(raw, -1, 1);
          } else {
            const { p5, p95 } = dynamicBounds[i];
            const range = p95 - p5;
            normalized = range === 0 ? 0 : clamp(((raw - p5) / range) * 2 - 1, -1, 1);
          }

          rawBuckets[i][col].push(normalized);
        }
      }
    }

    const avgGrid: number[][] = Array.from({ length: NUM_INDICATORS }, (_, i) =>
      rawBuckets[i].map((bucket) => {
        if (bucket.length === 0) return NaN;
        return avgMethod === "median" ? median(bucket) : trimmedMean(bucket);
      })
    );

    const stdGrid: number[][] = Array.from({ length: NUM_INDICATORS }, (_, i) =>
      rawBuckets[i].map((bucket) => stddev(bucket))
    );

    return { avgGrid, stdGrid, filteredMarkets };
  }, [btcMap, dynamicBounds, markets, outcomes, outcomeFilter, avgMethod, NUM_COLS, PRE_MARKET]);

  // Draw canvas whenever grid or size changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasWidth === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvasWidth * dpr);
    canvas.height = TOTAL_H * dpr;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    if (!heatmapData) return;

    const { avgGrid } = heatmapData;
    for (let i = 0; i < NUM_INDICATORS; i++) {
      for (let col = 0; col < NUM_COLS; col++) {
        const v = avgGrid[i][col];
        if (!isFinite(v)) continue;
        ctx.fillStyle = valueToColor(v);
        const x = Math.floor((col / NUM_COLS) * canvasWidth);
        const nextX = Math.floor(((col + 1) / NUM_COLS) * canvasWidth);
        ctx.fillRect(x, i * ROW_TOTAL, Math.max(1, nextX - x), CELL_H);
      }
    }
  }, [heatmapData, canvasWidth, NUM_COLS]);

  // Stable key for formula config — excludes outputValue to avoid infinite loop
  const formulaConfigKey = useMemo(() => {
    if (!activeFormula) return null;
    return `${activeFormula.id}|${activeFormula.aggregation}|${activeFormula.indicatorWeights.join(",")}|${activeFormula.sliderPositions.flat().join(",")}`;
  }, [activeFormula]);

  // Compute and push formula output value
  useEffect(() => {
    if (!activeFormula || !heatmapData) return;
    const value = computeFormulaValue(activeFormula, heatmapData.avgGrid, NUM_COLS);
    updateOutputValue(activeFormula.id, value);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formulaConfigKey, heatmapData, NUM_COLS]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!heatmapData || canvasWidth === 0 || !canvasContainerEl) return;
      const rect = canvasContainerEl.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const col = clamp(Math.floor((mouseX / canvasWidth) * NUM_COLS), 0, NUM_COLS - 1);
      const rowIdx = clamp(Math.floor(mouseY / ROW_TOTAL), 0, NUM_INDICATORS - 1);
      const tc = NUM_COLS - 1 - col;
      setHoverInfo({
        rowIdx,
        tc,
        avgValue: heatmapData.avgGrid[rowIdx][col],
        stdValue: heatmapData.stdGrid[rowIdx][col],
        x: mouseX,
        y: mouseY,
      });
    },
    [heatmapData, canvasWidth, NUM_COLS, canvasContainerEl]
  );

  const handleMouseLeave = useCallback(() => setHoverInfo(null), []);

  // X-axis labels
  const xAxisLabels = useMemo(() => {
    const interval = timeWindow === "5min" ? 60 : 120;
    const labels: { tc: number; leftPct: number }[] = [];
    for (let tc = 0; tc < NUM_COLS; tc += interval) {
      const leftPct = (1 - tc / (NUM_COLS - 1)) * 100;
      labels.push({ tc, leftPct });
    }
    return labels;
  }, [timeWindow, NUM_COLS]);

  // --- Render states ---
  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>BTC Indicators Heatmap</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-neutral-500 animate-pulse">Loading BTC indicators...</p>
        </CardContent>
      </Card>
    );
  }

  if (btcIndicators.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>BTC Indicators Heatmap</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-neutral-500">No BTC indicator data for {date}</p>
        </CardContent>
      </Card>
    );
  }

  if (!heatmapData || heatmapData.filteredMarkets.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>BTC Indicators Heatmap</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-neutral-500">No {outcomeFilter} markets for {date}</p>
        </CardContent>
      </Card>
    );
  }

  const { filteredMarkets } = heatmapData;

  return (
    <Card>
      <CardHeader>
        <CardTitle>BTC Indicators Heatmap</CardTitle>
        <div className="flex items-center gap-4 flex-wrap">
          {/* Outcome toggle */}
          <div className="flex gap-1">
            {(["UP", "DOWN"] as OutcomeFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setOutcomeFilter(f)}
                className={`px-2 py-0.5 text-xs border transition-colors ${
                  outcomeFilter === f
                    ? f === "UP"
                      ? "bg-magenta/20 border-magenta text-magenta"
                      : "bg-cyan-500/20 border-cyan-400 text-cyan-400"
                    : "border-neutral-700 text-neutral-500 hover:border-neutral-500"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Averaging method */}
          <div className="flex gap-1">
            <button
              onClick={() => setAvgMethod("trimmed")}
              title="Trimmed mean — excludes top/bottom 10% of values per bucket to reduce outlier noise"
              className={`px-2 py-0.5 text-xs border transition-colors ${
                avgMethod === "trimmed"
                  ? "border-neutral-400 text-neutral-200"
                  : "border-neutral-700 text-neutral-500 hover:border-neutral-500"
              }`}
            >
              Mean
            </button>
            <button
              onClick={() => setAvgMethod("median")}
              title="Median — 50th percentile value per bucket"
              className={`px-2 py-0.5 text-xs border transition-colors ${
                avgMethod === "median"
                  ? "border-neutral-400 text-neutral-200"
                  : "border-neutral-700 text-neutral-500 hover:border-neutral-500"
              }`}
            >
              Median
            </button>
          </div>

          {/* Time window */}
          <div className="flex gap-1">
            {(["5min", "15min"] as TimeWindow[]).map((w) => (
              <button
                key={w}
                onClick={() => setTimeWindow(w)}
                className={`px-2 py-0.5 text-xs border transition-colors ${
                  timeWindow === w
                    ? "border-neutral-400 text-neutral-200"
                    : "border-neutral-700 text-neutral-500 hover:border-neutral-500"
                }`}
              >
                {w}
              </button>
            ))}
          </div>

          <span className="text-xs text-neutral-600">{filteredMarkets.length} markets</span>
        </div>
      </CardHeader>
      <CardContent>
        <div style={{ minWidth: 600 }}>
          {/* Heatmap rows: labels + canvas */}
          <div className="flex">
            {/* Row labels */}
            <div style={{ width: LABEL_WIDTH, flexShrink: 0 }}>
              {INDICATORS.map((ind) => (
                <div
                  key={ind.label}
                  className="text-neutral-400 text-right pr-2"
                  style={{ height: ROW_TOTAL, fontSize: 10, lineHeight: `${CELL_H}px` }}
                >
                  {ind.label}
                </div>
              ))}
            </div>

            {/* Canvas container — callback ref ensures ResizeObserver mounts correctly */}
            <div
              ref={setCanvasContainerEl}
              style={{ flex: 1, position: "relative", height: TOTAL_H }}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              <canvas
                ref={canvasRef}
                style={{ width: "100%", height: TOTAL_H, display: "block" }}
              />

              {/* Slider overlay — only when a formula is active */}
              {activeFormula && canvasWidth > 0 && (
                <SliderOverlay formula={activeFormula} canvasWidth={canvasWidth} />
              )}

              {/* Hover tooltip — flips to left of cursor when near right edge */}
              {hoverInfo && isFinite(hoverInfo.avgValue) && (() => {
                const THRESHOLD = canvasWidth * 0.6;
                const nearRight = hoverInfo.x > THRESHOLD;
                return (
                  <div
                    className="absolute pointer-events-none z-20 bg-panel border border-theme px-2 py-1 text-xs shadow-lg font-mono whitespace-nowrap"
                    style={
                      nearRight
                        ? { right: canvasWidth - hoverInfo.x + 4, top: hoverInfo.y, transform: "translateY(-120%)" }
                        : { left: hoverInfo.x, top: hoverInfo.y, transform: "translate(-50%, -120%)" }
                    }
                  >
                    <span className="text-neutral-400">{hoverInfo.tc}s to close</span>
                    {" | "}
                    <span className="text-neutral-300">{INDICATORS[hoverInfo.rowIdx].label}</span>
                    {": "}
                    <span className="text-neutral-100">{hoverInfo.avgValue.toFixed(3)}</span>
                    {isFinite(hoverInfo.stdValue) && (
                      <span className="text-neutral-500"> ±{hoverInfo.stdValue.toFixed(3)}</span>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* X-axis labels */}
          <div style={{ marginLeft: LABEL_WIDTH, position: "relative", height: 20, marginTop: 4 }}>
            {xAxisLabels.map(({ tc, leftPct }) => (
              <span
                key={tc}
                style={{
                  position: "absolute",
                  left: `${leftPct}%`,
                  transform: "translateX(-50%)",
                  fontSize: 11,
                  fontFamily: "monospace",
                  color: "#a3a3a3",
                  whiteSpace: "nowrap",
                }}
              >
                {tc}s
              </span>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
