import { useCallback, useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { ShellContext } from "@/components/layout/Shell";
import { useMarketStore } from "@/stores/marketStore";
import { useRulesStore } from "@/stores/rulesStore";
import type { RuleExecution } from "@/stores/rulesStore";
import { BacktestConfig as BacktestConfigPanel } from "@/components/backtest/BacktestConfig";
import { BacktestResults } from "@/components/backtest/BacktestResults";
import { BacktestChart } from "@/components/backtest/BacktestChart";
import { BacktestTrades } from "@/components/backtest/BacktestTrades";
import type {
  BacktestConfig,
  BacktestResult,
  WorkerRequest,
  WorkerResponse,
} from "@/types/backtest";

export function Backtest() {
  const { date } = useOutletContext<ShellContext>();
  const { markets, snapshots, outcomes, loading, fetchMarketsByDate, fetchSnapshots, fetchOutcomes } =
    useMarketStore();
  const { rules, lastBacktestResult, setBacktestResult, logExecutionsBatch, clearExecutions } =
    useRulesStore();

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  // Initialize from persisted result so navigating away and back preserves it
  const [result, setResult] = useState<BacktestResult | null>(lastBacktestResult);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  // Fetch data when date changes
  useEffect(() => {
    fetchMarketsByDate(date);
    fetchOutcomes();
  }, [date, fetchMarketsByDate, fetchOutcomes]);

  useEffect(() => {
    if (markets.length > 0) {
      fetchSnapshots(markets.map((m) => m.id));
    }
  }, [markets, fetchSnapshots]);

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const handleRun = useCallback(
    (config: BacktestConfig) => {
      workerRef.current?.terminate();

      setRunning(true);
      setProgress(0);
      setResult(null);
      setError(null);

      const worker = new Worker(
        new URL("../workers/backtest.worker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current = worker;

      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        switch (msg.type) {
          case "progress":
            setProgress(msg.percent);
            break;
          case "done": {
            const backtestResult = msg.result;
            setResult(backtestResult);
            setBacktestResult(backtestResult); // persist across navigation

            // Populate Execution Log with BUY trades from this backtest
            clearExecutions();
            const execs: RuleExecution[] = backtestResult.trades
              .filter((t) => t.side === "BUY")
              .reverse() // newest-first to match execution log ordering
              .map((t) => ({
                id: crypto.randomUUID(),
                ruleId: t.ruleId,
                ruleName: t.ruleName,
                slug: t.slug,
                action: `BUY ${t.outcome} qty:${t.quantity} @ ${t.price.toFixed(3)}`,
                result: "success" as const,
                timestamp: t.timestamp,
                price: t.price,
                outcome: t.outcome,
                marketId: t.marketId,
              }));
            logExecutionsBatch(execs);

            setRunning(false);
            setProgress(100);
            break;
          }
          case "error":
            setError(msg.message);
            setRunning(false);
            break;
        }
      };

      worker.onerror = (err) => {
        setError(err.message || "Worker error");
        setRunning(false);
      };

      const payload: WorkerRequest = {
        type: "run",
        payload: {
          config,
          markets: markets.map((m) => ({
            id: m.id,
            slug: m.slug,
            start_time: m.start_time,
            end_time: m.end_time,
            outcome: m.outcome,
            volume: m.volume,
          })),
          snapshots: snapshots.map((s) => ({
            market_id: s.market_id,
            recorded_at: s.recorded_at,
            mid_price_yes: s.mid_price_yes,
            best_bid_yes: s.best_bid_yes,
            best_ask_yes: s.best_ask_yes,
          })),
          outcomes: outcomes
            .filter((o) => o.start_time.startsWith(date))
            .map((o) => ({
              id: o.id,
              slug: o.slug,
              start_time: o.start_time,
              outcome: o.outcome,
              outcome_binary: o.outcome_binary,
            })),
        },
      };

      worker.postMessage(payload);
    },
    [markets, snapshots, outcomes, date, setBacktestResult, logExecutionsBatch, clearExecutions],
  );

  const resolvedMarkets = markets.filter((m) => m.outcome !== null).length;

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex items-center gap-3 text-xs text-neutral-500">
        <span>{date}</span>
        <span>{resolvedMarkets} resolved markets</span>
        <span>{snapshots.length} price snapshots</span>
        {loading && <span className="animate-pulse">Loading data...</span>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* Left: Config */}
        <div className="space-y-4">
          <BacktestConfigPanel rules={rules} running={running} onRun={handleRun} />

          {running && (
            <div className="rounded-lg border border-theme bg-panel p-4">
              <div className="flex items-center justify-between text-xs text-neutral-400 mb-2">
                <span>Running backtest...</span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-surface overflow-hidden">
                <div
                  className="h-full bg-magenta transition-all duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-theme bg-panel p-3 text-xs text-neutral-400">
              {error}
            </div>
          )}
        </div>

        {/* Right: Results */}
        <div className="space-y-4">
          {result ? (
            <>
              <BacktestResults stats={result.stats} marketsProcessed={result.marketsProcessed} />
              <BacktestChart equityCurve={result.equityCurve} startingBalance={result.config.startingBalance} />
              <BacktestTrades trades={result.trades} />
            </>
          ) : (
            !running && (
              <div className="flex items-center justify-center h-64 rounded-lg border border-theme bg-panel text-neutral-500 text-sm">
                Configure and run a backtest to see results
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
