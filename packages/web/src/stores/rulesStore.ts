import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TradingRule } from "@/types/rule";
import type { BacktestResult } from "@/types/backtest";

export interface RuleExecution {
  id: string;
  ruleId: string;
  ruleName: string;
  slug: string;
  action: string;      // e.g. "BUY YES $10"
  result: "success" | "failed";
  error?: string;
  timestamp: string;    // ISO 8601
  // Chart data for click-to-expand
  price?: number;
  outcome?: "YES" | "NO";
  marketId?: number;
}

interface RulesState {
  rules: TradingRule[];
  executions: RuleExecution[];
  lastFired: Record<string, number>;
  lastBacktestResult: BacktestResult | null;

  addRule: (rule: TradingRule) => void;
  updateRule: (id: string, updates: Partial<TradingRule>) => void;
  removeRule: (id: string) => void;
  toggleRule: (id: string) => void;
  logExecution: (exec: RuleExecution) => void;
  logExecutionsBatch: (execs: RuleExecution[]) => void;
  recordFired: (ruleId: string, timestamp: number) => void;
  clearExecutions: () => void;
  setBacktestResult: (result: BacktestResult | null) => void;
}

export const useRulesStore = create<RulesState>()(
  persist(
    (set, get) => ({
      rules: [],
      executions: [],
      lastFired: {},
      lastBacktestResult: null,

      addRule: (rule) => set({ rules: [...get().rules, rule] }),

      updateRule: (id, updates) =>
        set({
          rules: get().rules.map((r) => (r.id === id ? { ...r, ...updates } : r)),
        }),

      removeRule: (id) =>
        set({ rules: get().rules.filter((r) => r.id !== id) }),

      toggleRule: (id) =>
        set({
          rules: get().rules.map((r) =>
            r.id === id ? { ...r, enabled: !r.enabled } : r,
          ),
        }),

      logExecution: (exec) =>
        set({ executions: [exec, ...get().executions].slice(0, 200) }),

      logExecutionsBatch: (execs) =>
        set({ executions: [...execs, ...get().executions].slice(0, 200) }),

      recordFired: (ruleId, timestamp) =>
        set({ lastFired: { ...get().lastFired, [ruleId]: timestamp } }),

      clearExecutions: () => set({ executions: [], lastFired: {} }),

      setBacktestResult: (result) => set({ lastBacktestResult: result }),
    }),
    { name: "trading-rules" },
  ),
);
