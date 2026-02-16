import { useEffect, useRef } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  LineSeries,
  AreaSeries,
  type LineData,
  type Time,
} from "lightweight-charts";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { EquityPoint } from "@/types/backtest";

interface BacktestChartProps {
  equityCurve: EquityPoint[];
  startingBalance: number;
}

export function BacktestChart({ equityCurve, startingBalance }: BacktestChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const refLineRef = useRef<ISeriesApi<"Line"> | null>(null);

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

    // Starting balance reference line
    const refLine = chart.addSeries(LineSeries, {
      color: "#525252",
      lineWidth: 1,
      lineStyle: 2, // dashed
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
    });

    // Equity area series
    const series = chart.addSeries(AreaSeries, {
      lineColor: "#38bdf8",
      lineWidth: 2,
      topColor: "rgba(56, 189, 248, 0.15)",
      bottomColor: "rgba(56, 189, 248, 0.02)",
      priceLineVisible: false,
      crosshairMarkerVisible: true,
      lastValueVisible: true,
      title: "Equity",
    });

    chartRef.current = chart;
    seriesRef.current = series;
    refLineRef.current = refLine;

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

  // Update data
  useEffect(() => {
    if (!chartRef.current || !seriesRef.current || !refLineRef.current || equityCurve.length === 0) return;

    const data: LineData<Time>[] = equityCurve.map((pt) => ({
      time: toTime(pt.time),
      value: pt.equity,
    }));

    seriesRef.current.setData(data);

    // Reference line at starting balance
    refLineRef.current.setData([
      { time: data[0].time, value: startingBalance },
      { time: data[data.length - 1].time, value: startingBalance },
    ]);

    chartRef.current.timeScale().fitContent();
  }, [equityCurve, startingBalance]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Equity Curve</CardTitle>
      </CardHeader>
      <CardContent>
        <div ref={containerRef} className="h-64 w-full" />
      </CardContent>
    </Card>
  );
}

function toTime(iso: string): Time {
  return (new Date(iso).getTime() / 1000) as Time;
}
