import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { IndicatorFormula } from "@/types/formula";

const DEFAULT_SLIDER_POSITIONS: [number, number][] = Array.from({ length: 12 }, () => [0, 1]);
const DEFAULT_WEIGHTS: number[] = Array.from({ length: 12 }, () => 1);

function makeFormula(index: number, timeWindow: "5min" | "15min"): IndicatorFormula {
  return {
    id: `formula-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: `Formula ${index}`,
    timeWindow,
    sliderPositions: DEFAULT_SLIDER_POSITIONS.map((p) => [...p] as [number, number]),
    indicatorWeights: [...DEFAULT_WEIGHTS],
    aggregation: "trimmed",
  };
}

interface FormulaState {
  formulas: IndicatorFormula[];
  activeFormulaId5min: string | null;
  activeFormulaId15min: string | null;
  /** Shared time-window for Heatmap + FormulaComposer — not persisted */
  timeWindow: "5min" | "15min";
  addFormula: (timeWindow: "5min" | "15min") => void;
  removeFormula: (id: string) => void;
  updateFormula: (id: string, updates: Partial<IndicatorFormula>) => void;
  setActiveFormula: (timeWindow: "5min" | "15min", id: string | null) => void;
  setTimeWindow: (w: "5min" | "15min") => void;
  updateSliderPosition: (formulaId: string, indIdx: number, range: [number, number]) => void;
  updateOutputValue: (formulaId: string, value: number) => void;
}

export const useFormulaStore = create<FormulaState>()(
  persist(
    (set, get) => ({
      formulas: [],
      activeFormulaId5min: null,
      activeFormulaId15min: null,
      timeWindow: "5min",

      setTimeWindow: (w) => set({ timeWindow: w }),

      addFormula: (timeWindow) => {
        const count = get().formulas.filter((f) => f.timeWindow === timeWindow).length;
        const newFormula = makeFormula(count + 1, timeWindow);
        set((s) => ({
          formulas: [...s.formulas, newFormula],
          activeFormulaId5min: timeWindow === "5min" ? newFormula.id : s.activeFormulaId5min,
          activeFormulaId15min: timeWindow === "15min" ? newFormula.id : s.activeFormulaId15min,
        }));
      },

      removeFormula: (id) => {
        set((s) => {
          const formula = s.formulas.find((f) => f.id === id);
          const remaining = s.formulas.filter((f) => f.id !== id);

          let newActive5min = s.activeFormulaId5min;
          let newActive15min = s.activeFormulaId15min;

          if (formula?.timeWindow === "5min" && s.activeFormulaId5min === id) {
            const sameScale = s.formulas.filter((f) => f.timeWindow === "5min");
            const idx = sameScale.findIndex((f) => f.id === id);
            newActive5min = (sameScale[idx - 1] ?? sameScale[idx + 1])?.id ?? null;
          }
          if (formula?.timeWindow === "15min" && s.activeFormulaId15min === id) {
            const sameScale = s.formulas.filter((f) => f.timeWindow === "15min");
            const idx = sameScale.findIndex((f) => f.id === id);
            newActive15min = (sameScale[idx - 1] ?? sameScale[idx + 1])?.id ?? null;
          }

          return { formulas: remaining, activeFormulaId5min: newActive5min, activeFormulaId15min: newActive15min };
        });
      },

      updateFormula: (id, updates) => {
        set((s) => ({
          formulas: s.formulas.map((f) => (f.id === id ? { ...f, ...updates } : f)),
        }));
      },

      setActiveFormula: (timeWindow, id) => {
        if (timeWindow === "5min") set({ activeFormulaId5min: id });
        else set({ activeFormulaId15min: id });
      },

      updateSliderPosition: (formulaId, indIdx, range) => {
        set((s) => ({
          formulas: s.formulas.map((f) => {
            if (f.id !== formulaId) return f;
            const positions = f.sliderPositions.map((p, i) =>
              i === indIdx ? range : p
            ) as [number, number][];
            return { ...f, sliderPositions: positions };
          }),
        }));
      },

      updateOutputValue: (formulaId, value) => {
        set((s) => ({
          formulas: s.formulas.map((f) =>
            f.id === formulaId ? { ...f, outputValue: value } : f
          ),
        }));
      },
    }),
    {
      name: "indicator-formulas",
      version: 2,
      migrate: (persisted: unknown, version: number) => {
        const p = persisted as Record<string, unknown>;
        if (version < 2) {
          const formulas = ((p.formulas as unknown[]) ?? []).map((f: unknown) => {
            const formula = f as Record<string, unknown>;
            return { ...formula, timeWindow: formula.timeWindow ?? "5min" };
          });
          return {
            formulas,
            activeFormulaId5min: (p.activeFormulaId as string | null) ?? null,
            activeFormulaId15min: null,
          };
        }
        return p;
      },
      partialize: (state) => ({
        formulas: state.formulas.map(({ outputValue: _ov, ...rest }) => rest),
        activeFormulaId5min: state.activeFormulaId5min,
        activeFormulaId15min: state.activeFormulaId15min,
      }),
    }
  )
);
