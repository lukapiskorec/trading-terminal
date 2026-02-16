/**
 * Backtest Web Worker — replays historical markets through trading rules.
 *
 * Receives: market data, price snapshots, outcomes, rules config
 * Outputs: progress updates, then final BacktestResult
 *
 * This file is self-contained: it inlines the rules engine and fee logic
 * to avoid import issues with Vite's worker bundling and path aliases.
 */

import type {
  WorkerRequest,
  WorkerResponse,
  BacktestTrade,
  BacktestResult,
  BacktestStats,
  EquityPoint,
  SerializedMarket,
  SerializedSnapshot,
  SerializedOutcome,
} from "../types/backtest";
import type { TradingRule, Condition } from "../types/rule";

// --- Inlined fee calculation (from lib/fees.ts) ---

const DEFAULT_FEE_RATE = 0.0625;

function feePerShare(price: number, feeRate = DEFAULT_FEE_RATE): number {
  return price * (1 - price) * feeRate;
}

function orderFee(price: number, quantity: number, feeRate = DEFAULT_FEE_RATE): number {
  return feePerShare(price, feeRate) * quantity;
}

function buyCost(price: number, quantity: number, feeRate = DEFAULT_FEE_RATE): number {
  return price * quantity + orderFee(price, quantity, feeRate);
}

// --- Inlined rules engine (from lib/rulesEngine.ts) ---

interface MarketContext {
  slug: string;
  price: number;
  spread: number;
  volume: number;
  timeToClose: number;
  aoi: number;
}

function evaluateRules(
  rules: TradingRule[],
  context: MarketContext,
  lastFired: Map<string, number>,
  nowMs: number,
): { rule: TradingRule; context: MarketContext }[] {
  const matches: { rule: TradingRule; context: MarketContext }[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!matchesFilter(context.slug, rule.marketFilter)) continue;

    const lastTime = lastFired.get(rule.id) ?? 0;
    if (nowMs - lastTime < rule.cooldown * 1000) continue;

    if (rule.conditions.every((c) => evaluateCondition(c, context))) {
      matches.push({ rule, context });
    }
  }

  return matches;
}

function evaluateCondition(condition: Condition, ctx: MarketContext): boolean {
  const fieldValue = ctx[condition.field as keyof MarketContext] as number;
  if (fieldValue === undefined) return false;

  switch (condition.operator) {
    case "<":
      return typeof condition.value === "number" && fieldValue < condition.value;
    case ">":
      return typeof condition.value === "number" && fieldValue > condition.value;
    case "==":
      return typeof condition.value === "number" && Math.abs(fieldValue - condition.value) < 0.0001;
    case "between":
      if (!Array.isArray(condition.value)) return false;
      return fieldValue >= condition.value[0] && fieldValue <= condition.value[1];
    default:
      return false;
  }
}

function matchesFilter(slug: string, filter: string): boolean {
  if (filter === "*") return true;
  if (filter.endsWith("*")) return slug.startsWith(filter.slice(0, -1));
  return slug === filter;
}

// --- AOI computation (inlined from lib/aoi.ts) ---

function computeAOIN(outcomeBinaries: number[], n: number): number {
  if (outcomeBinaries.length < n) return 0.5; // not enough data, assume neutral
  const slice = outcomeBinaries.slice(-n);
  return slice.reduce((s, v) => s + v, 0) / n;
}

// --- Backtest engine ---

interface OpenPosition {
  marketId: number;
  slug: string;
  outcome: "YES" | "NO";
  quantity: number;
  entryPrice: number;
  ruleId: string;
  ruleName: string;
}

function runBacktest(
  request: WorkerRequest["payload"],
): BacktestResult {
  const { config, markets, snapshots, outcomes } = request;
  const { rules, startingBalance, aoiWindow } = config;

  // Group snapshots by market_id for fast lookup
  const snapshotsByMarket = new Map<number, SerializedSnapshot[]>();
  for (const snap of snapshots) {
    const arr = snapshotsByMarket.get(snap.market_id) ?? [];
    arr.push(snap);
    snapshotsByMarket.set(snap.market_id, arr);
  }

  // Build outcome binary sequence (sorted by start_time) for AOI
  const sortedOutcomes = [...outcomes].sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
  );
  const outcomeBinaries: number[] = [];
  const outcomeMap = new Map<number, SerializedOutcome>();
  for (const o of sortedOutcomes) {
    outcomeMap.set(o.id, o);
  }

  // Sort markets chronologically
  const sortedMarkets = [...markets]
    .filter((m) => m.outcome !== null)
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

  let balance = startingBalance;
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [{ time: sortedMarkets[0]?.start_time ?? "", equity: balance }];
  const lastFired = new Map<string, number>();
  let marketsProcessed = 0;

  for (let mi = 0; mi < sortedMarkets.length; mi++) {
    const market = sortedMarkets[mi];
    const marketStartMs = new Date(market.start_time).getTime();
    const marketEndMs = new Date(market.end_time).getTime();
    const marketDurationMs = marketEndMs - marketStartMs;
    const marketSnaps = snapshotsByMarket.get(market.id) ?? [];

    // Determine current AOI from preceding outcomes
    const currentAOI = computeAOIN(outcomeBinaries, aoiWindow);

    // Evaluate rules at each price snapshot for this market
    const openPositions: OpenPosition[] = [];

    for (const snap of marketSnaps) {
      const price = snap.mid_price_yes ?? snap.best_bid_yes ?? 0.5;
      if (price <= 0 || price >= 1) continue;

      const snapTimeMs = new Date(snap.recorded_at).getTime();
      const timeToClose = Math.max(0, (marketEndMs - snapTimeMs) / 1000);
      const spread = (snap.best_ask_yes ?? price) - (snap.best_bid_yes ?? price);

      const ctx: MarketContext = {
        slug: market.slug,
        price,
        spread: Math.max(0, spread),
        volume: market.volume ?? 0,
        timeToClose,
        aoi: currentAOI,
      };

      const matches = evaluateRules(rules, ctx, lastFired, snapTimeMs);

      for (const { rule } of matches) {
        // Only BUY actions for backtesting (SELL handled at settlement)
        if (rule.action.type !== "BUY") continue;

        const quantity = Math.floor(rule.action.amount / price);
        if (quantity <= 0) continue;

        const cost = buyCost(price, quantity);
        if (cost > balance) continue;

        const fee = orderFee(price, quantity);
        balance -= cost;

        openPositions.push({
          marketId: market.id,
          slug: market.slug,
          outcome: rule.action.outcome,
          quantity,
          entryPrice: price,
          ruleId: rule.id,
          ruleName: rule.name,
        });

        trades.push({
          marketId: market.id,
          slug: market.slug,
          side: "BUY",
          outcome: rule.action.outcome,
          price,
          quantity,
          fee,
          total: cost,
          pnl: 0,
          ruleId: rule.id,
          ruleName: rule.name,
          timestamp: snap.recorded_at,
        });

        lastFired.set(rule.id, snapTimeMs);
      }
    }

    // Settle all positions at market resolution
    const outcomeWon = market.outcome === "Up" ? "YES" : "NO";
    for (const pos of openPositions) {
      const won = pos.outcome === outcomeWon;
      const settlePrice = won ? 1.0 : 0.0;
      const payout = settlePrice * pos.quantity;
      const pnl = payout - pos.entryPrice * pos.quantity - orderFee(pos.entryPrice, pos.quantity);
      balance += payout;

      trades.push({
        marketId: pos.marketId,
        slug: pos.slug,
        side: "SETTLE",
        outcome: pos.outcome,
        price: settlePrice,
        quantity: pos.quantity,
        fee: 0,
        total: payout,
        pnl,
        ruleId: pos.ruleId,
        ruleName: pos.ruleName,
        timestamp: market.end_time,
      });
    }

    // Record outcome for future AOI computation
    const outcomeData = sortedOutcomes.find((o) => o.slug === market.slug);
    if (outcomeData) {
      outcomeBinaries.push(outcomeData.outcome_binary);
    }

    equityCurve.push({ time: market.end_time, equity: balance });
    marketsProcessed++;

    // Post progress every 20 markets
    if (mi % 20 === 0) {
      const msg: WorkerResponse = { type: "progress", percent: Math.round((mi / sortedMarkets.length) * 100) };
      self.postMessage(msg);
    }
  }

  // Compute stats
  const stats = computeStats(trades, startingBalance, equityCurve);

  return {
    config,
    stats,
    trades,
    equityCurve,
    marketsProcessed,
  };
}

function computeStats(
  trades: BacktestTrade[],
  startingBalance: number,
  equityCurve: EquityPoint[],
): BacktestStats {
  const settlements = trades.filter((t) => t.side === "SETTLE");
  const wins = settlements.filter((t) => t.pnl > 0);
  const losses = settlements.filter((t) => t.pnl <= 0);

  const totalPnl = settlements.reduce((s, t) => s + t.pnl, 0);
  const totalWinPnl = wins.reduce((s, t) => s + t.pnl, 0);
  const totalLossPnl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  // Max drawdown
  let peak = startingBalance;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  for (const pt of equityCurve) {
    if (pt.equity > peak) peak = pt.equity;
    const dd = peak - pt.equity;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
      maxDrawdownPct = peak > 0 ? dd / peak : 0;
    }
  }

  // Sharpe ratio (per-market returns, annualized roughly)
  // Using per-settlement returns, risk-free rate = 0
  const returns: number[] = [];
  let prevEquity = startingBalance;
  for (const pt of equityCurve.slice(1)) {
    if (prevEquity > 0) {
      returns.push((pt.equity - prevEquity) / prevEquity);
    }
    prevEquity = pt.equity;
  }
  const meanReturn = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
  const stdReturn = returns.length > 1
    ? Math.sqrt(returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / (returns.length - 1))
    : 0;
  // Annualize: 288 markets/day * 365 days
  const annualizationFactor = Math.sqrt(288 * 365);
  const sharpeRatio = stdReturn > 0 ? (meanReturn / stdReturn) * annualizationFactor : 0;

  return {
    totalTrades: settlements.length,
    wins: wins.length,
    losses: losses.length,
    winRate: settlements.length > 0 ? wins.length / settlements.length : 0,
    totalPnl,
    totalPnlPct: startingBalance > 0 ? totalPnl / startingBalance : 0,
    maxDrawdown,
    maxDrawdownPct,
    sharpeRatio,
    profitFactor: totalLossPnl > 0 ? totalWinPnl / totalLossPnl : totalWinPnl > 0 ? Infinity : 0,
    avgWin: wins.length > 0 ? totalWinPnl / wins.length : 0,
    avgLoss: losses.length > 0 ? totalLossPnl / losses.length : 0,
  };
}

// --- Worker message handler ---

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { type, payload } = e.data;

  if (type === "run") {
    try {
      const result = runBacktest(payload);
      const msg: WorkerResponse = { type: "done", result };
      self.postMessage(msg);
    } catch (err) {
      const msg: WorkerResponse = {
        type: "error",
        message: err instanceof Error ? err.message : "Unknown backtest error",
      };
      self.postMessage(msg);
    }
  }
};
