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
  priceYes: number;
  priceNo: number;
  spread: number;
  volume: number;
  timeToClose: number;
  aoi: number;
}

interface RuleMatch {
  rule: TradingRule;
  resolvedOutcome: "YES" | "NO";
  context: MarketContext;
}

function evaluateRules(
  rules: TradingRule[],
  context: MarketContext,
  lastFired: Map<string, number>,
  nowMs: number,
): RuleMatch[] {
  const matches: RuleMatch[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!matchesFilter(context.slug, rule.marketFilter)) continue;

    const lastTime = lastFired.get(rule.id) ?? 0;
    if (nowMs - lastTime < rule.cooldown * 1000) continue;

    if (rule.randomConfig) {
      if (context.timeToClose <= rule.randomConfig.triggerAtTimeToClose) {
        const resolvedOutcome: "YES" | "NO" =
          Math.random() < rule.randomConfig.upRatio ? "YES" : "NO";
        matches.push({ rule, resolvedOutcome, context });
      }
    } else {
      const mode = rule.conditionMode ?? "AND";
      const conditionMet =
        mode === "OR"
          ? rule.conditions.some((c) => evaluateCondition(c, context))
          : rule.conditions.every((c) => evaluateCondition(c, context));

      if (conditionMet) {
        matches.push({ rule, resolvedOutcome: rule.action.outcome, context });
      }
    }
  }

  return matches;
}

function evaluateCondition(condition: Condition, ctx: MarketContext): boolean {
  let fieldValue: number;
  switch (condition.field) {
    case "priceYes":    fieldValue = ctx.priceYes; break;
    case "priceNo":     fieldValue = ctx.priceNo; break;
    case "spread":      fieldValue = ctx.spread; break;
    case "volume":      fieldValue = ctx.volume; break;
    case "timeToClose": fieldValue = ctx.timeToClose; break;
    case "aoi":         fieldValue = ctx.aoi; break;
    default: return false;
  }

  switch (condition.operator) {
    case "<":  return typeof condition.value === "number" && fieldValue < condition.value;
    case ">":  return typeof condition.value === "number" && fieldValue > condition.value;
    case "==": return typeof condition.value === "number" && Math.abs(fieldValue - condition.value) < 0.0001;
    case "between":
      if (!Array.isArray(condition.value)) return false;
      return fieldValue >= condition.value[0] && fieldValue <= condition.value[1];
    default: return false;
  }
}

function matchesFilter(slug: string, filter: string): boolean {
  if (filter === "*") return true;
  if (filter.endsWith("*")) return slug.startsWith(filter.slice(0, -1));
  return slug === filter;
}

// --- AOI computation (inlined from lib/aoi.ts) ---

function computeAOIN(outcomeBinaries: number[], n: number): number {
  if (outcomeBinaries.length < n) return 0.5;
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

function executeBuy(
  rule: TradingRule,
  resolvedOutcome: "YES" | "NO",
  priceYes: number,
  snapTimeMs: number,
  timeToClose: number,
  market: SerializedMarket,
  snap: SerializedSnapshot,
  balance: number,
  openPositions: OpenPosition[],
  trades: BacktestTrade[],
  ruleName: string,
): number /* new balance */ {
  const entryPrice = resolvedOutcome === "YES" ? priceYes : 1 - priceYes;
  const quantity = Math.floor(rule.action.amount / entryPrice);
  if (quantity <= 0) return balance;

  const cost = buyCost(entryPrice, quantity);
  if (cost > balance) return balance;

  const fee = orderFee(entryPrice, quantity);
  balance -= cost;

  openPositions.push({
    marketId: market.id,
    slug: market.slug,
    outcome: resolvedOutcome,
    quantity,
    entryPrice,
    ruleId: rule.id,
    ruleName,
  });

  trades.push({
    marketId: market.id,
    slug: market.slug,
    side: "BUY",
    outcome: resolvedOutcome,
    price: entryPrice,
    quantity,
    fee,
    total: cost,
    pnl: 0,
    ruleId: rule.id,
    ruleName,
    timestamp: snap.recorded_at,
    timeToClose,
  });

  return balance;
}

function runBacktest(request: WorkerRequest["payload"]): BacktestResult {
  const { config, markets, snapshots, outcomes } = request;
  const { rules, startingBalance, aoiWindow, ruleMode, fallbackRule, fallbackTriggerTTC } = config;

  const snapshotsByMarket = new Map<number, SerializedSnapshot[]>();
  for (const snap of snapshots) {
    const arr = snapshotsByMarket.get(snap.market_id) ?? [];
    arr.push(snap);
    snapshotsByMarket.set(snap.market_id, arr);
  }

  const sortedOutcomes = [...outcomes].sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
  );
  const outcomeBinaries: number[] = [];

  const sortedMarkets = [...markets]
    .filter((m) => m.outcome !== null)
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

  let balance = startingBalance;
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [{ time: sortedMarkets[0]?.start_time ?? "", equity: balance }];
  // INDEPENDENT mode: per-rule cooldown tracking
  const lastFired = new Map<string, number>();
  // EXCLUSIVE mode + fallback: shared cooldown block (ms timestamp until blocked)
  let globalBlockedUntil = 0;
  // Empty map passed to evaluateRules in EXCLUSIVE mode — global block handles timing instead
  const noLastFired = new Map<string, number>();
  let marketsProcessed = 0;

  for (let mi = 0; mi < sortedMarkets.length; mi++) {
    const market = sortedMarkets[mi];
    const marketEndMs = new Date(market.end_time).getTime();
    const marketSnaps = snapshotsByMarket.get(market.id) ?? [];

    const currentAOI = computeAOIN(outcomeBinaries, aoiWindow);
    const openPositions: OpenPosition[] = [];
    let marketFiredAny = false;

    // First snapshot at or below the fallback TTC threshold (recorded for potential fallback use)
    let fallbackSnap: SerializedSnapshot | null = null;
    let fallbackSnapTimeMs = 0;

    for (const snap of marketSnaps) {
      const priceYes = snap.mid_price_yes ?? snap.best_bid_yes ?? 0.5;
      if (priceYes <= 0 || priceYes >= 1) continue;

      const snapTimeMs = new Date(snap.recorded_at).getTime();
      const timeToClose = Math.max(0, (marketEndMs - snapTimeMs) / 1000);

      // Record the first snap that hits the fallback TTC threshold
      if (fallbackRule && fallbackSnap === null && timeToClose <= fallbackTriggerTTC) {
        fallbackSnap = snap;
        fallbackSnapTimeMs = snapTimeMs;
      }

      // Global block: set by EXCLUSIVE rule fires and by fallback cooldown (both modes)
      if (snapTimeMs < globalBlockedUntil) continue;

      const spread = (snap.best_ask_yes ?? priceYes) - (snap.best_bid_yes ?? priceYes);
      const ctx: MarketContext = {
        slug: market.slug,
        priceYes,
        priceNo: 1 - priceYes,
        spread: Math.max(0, spread),
        volume: market.volume ?? 0,
        timeToClose,
        aoi: currentAOI,
      };

      // EXCLUSIVE mode: pass empty lastFired so individual cooldowns don't apply —
      // the global block is the sole cooldown mechanism.
      // INDEPENDENT mode: pass per-rule lastFired as before.
      const effectiveLastFired = ruleMode === "EXCLUSIVE" ? noLastFired : lastFired;
      const matches = evaluateRules(rules, ctx, effectiveLastFired, snapTimeMs);

      for (const { rule, resolvedOutcome } of matches) {
        if (rule.action.type !== "BUY") continue;
        // In EXCLUSIVE mode a rule fired earlier in this loop iteration may have set the block
        if (ruleMode === "EXCLUSIVE" && snapTimeMs < globalBlockedUntil) break;

        balance = executeBuy(
          rule, resolvedOutcome, priceYes, snapTimeMs, timeToClose,
          market, snap, balance, openPositions, trades, rule.name,
        );

        marketFiredAny = true;

        if (ruleMode === "INDEPENDENT") {
          lastFired.set(rule.id, snapTimeMs);
        } else {
          // EXCLUSIVE: the fired rule's cooldown blocks everyone
          globalBlockedUntil = Math.max(globalBlockedUntil, snapTimeMs + rule.cooldown * 1000);
        }
      }
    }

    // Fallback: fires only if no primary rule triggered AND the TTC threshold was reached
    // AND the global block (from a previous market's exclusive/fallback) has already expired
    if (fallbackRule && !marketFiredAny && fallbackSnap !== null && fallbackSnapTimeMs >= globalBlockedUntil) {
      const priceYes = fallbackSnap.mid_price_yes ?? fallbackSnap.best_bid_yes ?? 0.5;
      if (priceYes > 0 && priceYes < 1) {
        const fallbackTTC = Math.max(0, (marketEndMs - fallbackSnapTimeMs) / 1000);
        const resolvedOutcome: "YES" | "NO" = fallbackRule.randomConfig
          ? Math.random() < fallbackRule.randomConfig.upRatio ? "YES" : "NO"
          : fallbackRule.action.outcome;

        balance = executeBuy(
          fallbackRule, resolvedOutcome, priceYes, fallbackSnapTimeMs, fallbackTTC,
          market, fallbackSnap, balance, openPositions, trades, `[FB] ${fallbackRule.name}`,
        );

        // Fallback cooldown blocks all rules going forward (both modes)
        globalBlockedUntil = Math.max(
          globalBlockedUntil,
          fallbackSnapTimeMs + fallbackRule.cooldown * 1000,
        );
        // In INDEPENDENT mode also reset per-rule lastFired so individual checks align
        if (ruleMode === "INDEPENDENT") {
          for (const rule of rules) lastFired.set(rule.id, fallbackSnapTimeMs);
        }
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

    const outcomeData = sortedOutcomes.find((o) => o.slug === market.slug);
    if (outcomeData) outcomeBinaries.push(outcomeData.outcome_binary);

    equityCurve.push({ time: market.end_time, equity: balance });
    marketsProcessed++;

    // Cooldowns never carry across market boundaries — reset at end of each market
    lastFired.clear();
    globalBlockedUntil = 0;

    if (mi % 20 === 0) {
      const msg: WorkerResponse = { type: "progress", percent: Math.round((mi / sortedMarkets.length) * 100) };
      self.postMessage(msg);
    }
  }

  const stats = computeStats(trades, startingBalance, equityCurve);
  return { config, stats, trades, equityCurve, marketsProcessed };
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

  const returns: number[] = [];
  let prevEquity = startingBalance;
  for (const pt of equityCurve.slice(1)) {
    if (prevEquity > 0) returns.push((pt.equity - prevEquity) / prevEquity);
    prevEquity = pt.equity;
  }
  const meanReturn = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
  const stdReturn =
    returns.length > 1
      ? Math.sqrt(returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / (returns.length - 1))
      : 0;
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
