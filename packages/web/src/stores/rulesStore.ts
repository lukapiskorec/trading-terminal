import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TradingRule } from "@/types/rule";

interface RulesState {
  rules: TradingRule[];
  addRule: (rule: TradingRule) => void;
  updateRule: (id: string, updates: Partial<TradingRule>) => void;
  removeRule: (id: string) => void;
  toggleRule: (id: string) => void;
}

export const useRulesStore = create<RulesState>()(
  persist(
    (set, get) => ({
      rules: [],

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
    }),
    { name: "trading-rules" },
  ),
);
