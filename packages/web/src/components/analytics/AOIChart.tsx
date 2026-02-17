import { useEffect, useRef, useState, useCallback } from "react";
import { createChart, type IChartApi, type ISeriesApi, LineSeries, type LineData, type Time } from "lightweight-charts";
import { computeAOI } from "@/lib/aoi";
import type { MarketOutcome } from "@/types/market";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface AOIChartProps {
  outcomes: MarketOutcome[];
}

const SERIES_CONFIG = [
  { key: "aoi6" as const, label: "AOI-6", color: "#ff1ad9", width: 1 as const },
  { key: "aoi12" as const, label: "AOI-12", color: "#b3129a", width: 2 as const },
  { key: "aoi144" as const, label: "AOI-144", color: "#00f0ff", width: 2 as const },
  { key: "aoi288" as const, label: "AOI-288", color: "#ffffff", width: 3 as const },
] as const;

export function AOIChart({ outcomes }: AOIChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<ISeriesApi<"Line">[]>([]);

  const [visibility, setVisibility] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SERIES_CONFIG.map((cfg) => [cfg.key, true])),
  );

  const toggleSeries = useCallback((key: string) => {
    setVisibility((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      // Find the series index: +1 because index 0 is the reference line
      const idx = SERIES_CONFIG.findIndex((c) => c.key === key);
      if (idx !== -1 && seriesRefs.current[idx + 1]) {
        seriesRefs.current[idx + 1].applyOptions({ visible: next[key] });
      }
      return next;
    });
  }, []);

  // Create chart once
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor: "#a3a3a3",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#1a0f22" },
        horzLines: { color: "#1a0f22" },
      },
      rightPriceScale: {
        borderColor: "#2b1336",
        scaleMargins: { top: 0.05, bottom: 0.05 },
      },
      timeScale: {
        borderColor: "#2b1336",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        horzLine: { color: "#3d1f4e", labelBackgroundColor: "#3d1f4e" },
        vertLine: { color: "#3d1f4e", labelBackgroundColor: "#3d1f4e" },
      },
      handleScroll: true,
      handleScale: true,
    });

    // 0.50 reference line — we'll draw it as a separate series
    const refSeries = chart.addSeries(LineSeries, {
      color: "#525252",
      lineWidth: 1,
      lineStyle: 2, // dashed
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
    });

    const series: ISeriesApi<"Line">[] = [refSeries];

    for (const cfg of SERIES_CONFIG) {
      const s = chart.addSeries(LineSeries, {
        color: cfg.color,
        lineWidth: cfg.width,
        priceLineVisible: false,
        crosshairMarkerVisible: true,
        lastValueVisible: false,
        title: cfg.label,
      });
      series.push(s);
    }

    chartRef.current = chart;
    seriesRefs.current = series;

    const observer = new ResizeObserver(([entry]) => {
      chart.applyOptions({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // Update data when outcomes change
  useEffect(() => {
    if (!chartRef.current || seriesRefs.current.length === 0 || outcomes.length === 0) return;

    const aoiData = computeAOI(outcomes);

    // Reference line at 0.50
    const refLineData: LineData<Time>[] = [
      { time: toTime(aoiData[0].time), value: 0.5 },
      { time: toTime(aoiData[aoiData.length - 1].time), value: 0.5 },
    ];
    seriesRefs.current[0].setData(refLineData);

    // AOI series
    SERIES_CONFIG.forEach((cfg, idx) => {
      const data: LineData<Time>[] = [];
      for (const pt of aoiData) {
        const val = pt[cfg.key];
        if (val !== null) {
          data.push({ time: toTime(pt.time), value: val });
        }
      }
      seriesRefs.current[idx + 1].setData(data);
    });

    chartRef.current.timeScale().fitContent();
  }, [outcomes]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Average Outcome Index (AOI)</CardTitle>
        <div className="flex gap-3 text-xs">
          {SERIES_CONFIG.map((cfg) => (
            <label key={cfg.key} className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={visibility[cfg.key]}
                onChange={() => toggleSeries(cfg.key)}
                className="h-3 w-3 rounded border-neutral-600 bg-neutral-800 accent-magenta"
              />
              <span className="inline-block h-0.5 w-3 rounded" style={{ backgroundColor: cfg.color }} />
              <span className={visibility[cfg.key] ? "" : "text-neutral-600"}>{cfg.label}</span>
            </label>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <div ref={containerRef} className="h-72 w-full" />
      </CardContent>
    </Card>
  );
}

/** Convert ISO string to lightweight-charts Time (unix timestamp in seconds) */
function toTime(iso: string): Time {
  return (new Date(iso).getTime() / 1000) as Time;
}
