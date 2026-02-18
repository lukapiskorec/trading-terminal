/**
 * Rules engine — evaluates trading rules against current market state.
 *
 * Pure function: takes market context + rules, returns which rules trigger.
 * Callers (WebSocket handler, backtester) are responsible for executing trades.
 */

import type { TradingRule, Condition } from "@/types/rule";

export interface MarketContext {
  slug: string;
  priceYes: number;    // YES token midpoint price (0–1)
  priceNo: number;     // NO token price = 1 − priceYes
  spread: number;      // best_ask − best_bid
  volume: number;
  timeToClose: number; // seconds remaining
  aoi: number;         // current AOI value (caller decides which window)
}

export interface RuleMatch {
  rule: TradingRule;
  resolvedOutcome: "YES" | "NO"; // may differ from rule.action.outcome for random rules
  context: MarketContext;
  timestamp: number;
}

/**
 * Evaluate all enabled rules against the current market context.
 * Returns rules that match (conditions satisfied + cooldown elapsed).
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

    if (!matchesFilter(context.slug, rule.marketFilter)) continue;

    const lastTime = lastFired.get(rule.id) ?? 0;
    if (now - lastTime < rule.cooldown * 1000) continue;

    if (rule.randomConfig) {
      // Random rule: trigger when timeToClose reaches the threshold
      if (context.timeToClose <= rule.randomConfig.triggerAtTimeToClose) {
        const resolvedOutcome: "YES" | "NO" =
          Math.random() < rule.randomConfig.upRatio ? "YES" : "NO";
        matches.push({ rule, resolvedOutcome, context, timestamp: now });
      }
    } else {
      // Conditional rule — AND or OR
      const mode = rule.conditionMode ?? "AND";
      const conditionMet =
        mode === "OR"
          ? rule.conditions.some((c) => evaluateCondition(c, context))
          : rule.conditions.every((c) => evaluateCondition(c, context));

      if (conditionMet) {
        matches.push({ rule, resolvedOutcome: rule.action.outcome, context, timestamp: now });
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

/** Simple glob match: supports trailing * only (e.g. "btc-updown-5m-*") */
function matchesFilter(slug: string, filter: string): boolean {
  if (filter === "*") return true;
  if (filter.endsWith("*")) return slug.startsWith(filter.slice(0, -1));
  return slug === filter;
}
