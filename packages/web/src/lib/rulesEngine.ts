/**
 * Rules engine — evaluates trading rules against current market state.
 *
 * Pure function: takes market context + rules, returns which rules trigger.
 * Callers (WebSocket handler, backtester) are responsible for executing trades.
 */

import type { TradingRule, Condition } from "@/types/rule";

export interface MarketContext {
  slug: string;
  price: number;       // YES midpoint
  spread: number;      // best_ask - best_bid
  volume: number;
  timeToClose: number; // seconds remaining
  aoi: number;         // current AOI value (caller decides which window)
}

export interface RuleMatch {
  rule: TradingRule;
  context: MarketContext;
  timestamp: number;
}

/**
 * Evaluate all enabled rules against the current market context.
 * Returns rules that match (all conditions satisfied + cooldown elapsed).
 */
export function evaluateRules(
  rules: TradingRule[],
  context: MarketContext,
  lastFired: Map<string, number>, // ruleId → last fire timestamp (ms)
): RuleMatch[] {
  const now = Date.now();
  const matches: RuleMatch[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;

    // Check market filter (glob-style: "btc-updown-5m-*")
    if (!matchesFilter(context.slug, rule.marketFilter)) continue;

    // Check cooldown
    const lastTime = lastFired.get(rule.id) ?? 0;
    if (now - lastTime < rule.cooldown * 1000) continue;

    // Check all conditions (AND)
    if (rule.conditions.every((c) => evaluateCondition(c, context))) {
      matches.push({ rule, context, timestamp: now });
    }
  }

  return matches;
}

function evaluateCondition(condition: Condition, ctx: MarketContext): boolean {
  const fieldValue = ctx[condition.field];
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

/** Simple glob match: supports trailing * only (e.g. "btc-updown-5m-*") */
function matchesFilter(slug: string, filter: string): boolean {
  if (filter === "*") return true;
  if (filter.endsWith("*")) {
    return slug.startsWith(filter.slice(0, -1));
  }
  return slug === filter;
}
