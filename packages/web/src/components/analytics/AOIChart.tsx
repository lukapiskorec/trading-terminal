import { useEffect, useRef } from "react";
import { createChart, type IChartApi, type ISeriesApi, LineSeries, type LineData, type Time } from "lightweight-charts";
import { computeAOI } from "@/lib/aoi";
import type { MarketOutcome } from "@/types/market";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface AOIChartProps {
  outcomes: MarketOutcome[];
}

const SERIES_CONFIG = [
  { key: "aoi1" as const, label: "AOI-1", color: "#737373", width: 1 as const },
  { key: "aoi6" as const, label: "AOI-6", color: "#facc15", width: 1 as const },
  { key: "aoi12" as const, label: "AOI-12", color: "#fb923c", width: 2 as const },
  { key: "aoi144" as const, label: "AOI-144", color: "#38bdf8", width: 2 as const },
  { key: "aoi288" as const, label: "AOI-288", color: "#a78bfa", width: 3 as const },
] as const;

export function AOIChart({ outcomes }: AOIChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<ISeriesApi<"Line">[]>([]);

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
        vertLines: { color: "#262626" },
        horzLines: { color: "#262626" },
      },
      rightPriceScale: {
        borderColor: "#404040",
        scaleMargins: { top: 0.05, bottom: 0.05 },
      },
      timeScale: {
        borderColor: "#404040",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        horzLine: { color: "#525252", labelBackgroundColor: "#525252" },
        vertLine: { color: "#525252", labelBackgroundColor: "#525252" },
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
            <span key={cfg.key} className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-3 rounded" style={{ backgroundColor: cfg.color }} />
              {cfg.label}
            </span>
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
