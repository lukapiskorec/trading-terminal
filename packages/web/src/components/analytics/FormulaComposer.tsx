import { useState } from "react";
import { useFormulaStore } from "@/stores/formulaStore";
import { INDICATOR_LABELS } from "@/types/formula";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

type TimeWindow = "5min" | "15min";

export function FormulaComposer() {
  const {
    formulas,
    activeFormulaId5min,
    activeFormulaId15min,
    timeWindow,
    setTimeWindow,
    addFormula,
    removeFormula,
    updateFormula,
    setActiveFormula,
  } = useFormulaStore();

  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const activeFormulaId = timeWindow === "5min" ? activeFormulaId5min : activeFormulaId15min;
  const tabFormulas = formulas.filter((f) => f.timeWindow === timeWindow);
  const activeFormula = formulas.find((f) => f.id === activeFormulaId) ?? null;

  const handleFormulaClick = (id: string) => {
    if (id === activeFormulaId) {
      // Click active formula → deselect (hides sliders)
      setActiveFormula(timeWindow, null);
    } else {
      setActiveFormula(timeWindow, id);
    }
    setPendingDelete(null);
  };

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    // Always require two clicks to delete
    if (pendingDelete === id) {
      removeFormula(id);
      setPendingDelete(null);
    } else {
      setPendingDelete(id);
    }
  };

  const toggleIndicator = (indIdx: number) => {
    if (!activeFormula) return;
    const weights = [...activeFormula.indicatorWeights];
    weights[indIdx] = weights[indIdx] === 0 ? 1 : 0;
    updateFormula(activeFormula.id, { indicatorWeights: weights });
  };

  const setWeight = (indIdx: number, raw: string) => {
    if (!activeFormula) return;
    const value = parseFloat(raw);
    if (isNaN(value)) return;
    const weights = [...activeFormula.indicatorWeights];
    weights[indIdx] = value;
    updateFormula(activeFormula.id, { indicatorWeights: weights });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Indicator Formulas</CardTitle>
          <div className="flex items-center gap-2">
            {/* Scale tabs — synced with Heatmap time window */}
            <div className="flex gap-1">
              {(["5min", "15min"] as TimeWindow[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setTimeWindow(tab)}
                  className={`px-2 py-0.5 text-xs border transition-colors ${
                    timeWindow === tab
                      ? "border-neutral-400 text-neutral-200"
                      : "border-neutral-700 text-neutral-500 hover:border-neutral-500"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
            <button
              onClick={() => addFormula(timeWindow)}
              className="px-2 py-0.5 text-xs border border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200 transition-colors"
            >
              + New Formula
            </button>
          </div>
        </div>

        {/* Formula chips */}
        {tabFormulas.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {tabFormulas.map((f) => {
              const isActive = f.id === activeFormulaId;
              return (
                <div
                  key={f.id}
                  onClick={() => handleFormulaClick(f.id)}
                  className={`flex items-center gap-1.5 px-2 py-1 border text-xs cursor-pointer transition-colors ${
                    isActive
                      ? "border-magenta bg-magenta/10 text-magenta"
                      : "border-neutral-700 text-neutral-400 hover:border-neutral-500"
                  }`}
                >
                  <span>{f.name}</span>
                  {f.outputValue !== undefined && (
                    <span className={isActive ? "text-magenta/70" : "text-neutral-500"}>
                      {f.outputValue >= 0 ? "+" : ""}
                      {f.outputValue.toFixed(2)}
                    </span>
                  )}
                  <button
                    onClick={(e) => handleDeleteClick(e, f.id)}
                    className={`ml-0.5 transition-colors ${
                      pendingDelete === f.id
                        ? "text-red-400"
                        : "text-neutral-600 hover:text-neutral-400"
                    }`}
                    title={pendingDelete === f.id ? "Click again to confirm delete" : "Delete formula"}
                  >
                    {pendingDelete === f.id ? "?" : "×"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </CardHeader>

      <CardContent>
        {!activeFormula ? (
          <p className="text-sm text-neutral-500">
            {tabFormulas.length === 0
              ? `Create a ${timeWindow} formula to define weighted indicator signals.`
              : "Select a formula above to configure it."}
          </p>
        ) : (
          <div className="space-y-4">
            {/* Name + aggregation + output */}
            <div className="flex items-center gap-3 flex-wrap">
              <input
                className="bg-transparent border border-neutral-700 px-2 py-1 text-sm text-neutral-200 focus:outline-none focus:border-neutral-400 transition-colors"
                value={activeFormula.name}
                onChange={(e) => updateFormula(activeFormula.id, { name: e.target.value })}
                placeholder="Formula name"
              />

              <div className="flex gap-1">
                {(["trimmed", "median"] as const).map((agg) => (
                  <button
                    key={agg}
                    onClick={() => updateFormula(activeFormula.id, { aggregation: agg })}
                    className={`px-2 py-0.5 text-xs border transition-colors ${
                      activeFormula.aggregation === agg
                        ? "border-neutral-400 text-neutral-200"
                        : "border-neutral-700 text-neutral-500 hover:border-neutral-500"
                    }`}
                  >
                    {agg === "trimmed" ? "Mean" : "Median"}
                  </button>
                ))}
              </div>

              <span className="text-sm text-neutral-400">
                Output:{" "}
                <span className="font-mono text-neutral-100">
                  {activeFormula.outputValue !== undefined
                    ? (activeFormula.outputValue >= 0 ? "+" : "") +
                      activeFormula.outputValue.toFixed(4)
                    : "—"}
                </span>
              </span>
            </div>

            {/* Indicator chips */}
            <div>
              <p className="text-xs text-neutral-500 mb-2">
                Click indicator to toggle. Drag sliders on the heatmap above to set range.
              </p>
              <div className="flex flex-wrap gap-2">
                {INDICATOR_LABELS.map((label, i) => {
                  const weight = activeFormula.indicatorWeights[i];
                  const enabled = weight !== 0;
                  return (
                    <div
                      key={label}
                      className={`flex items-center gap-1 px-2 py-1 border text-xs transition-colors ${
                        enabled
                          ? "border-magenta bg-magenta/10 text-magenta"
                          : "border-neutral-800 text-neutral-600 hover:border-neutral-700"
                      }`}
                    >
                      <span
                        className="cursor-pointer select-none"
                        onClick={() => toggleIndicator(i)}
                      >
                        {label}
                      </span>
                      {enabled && (
                        <>
                          <span className="text-neutral-500 select-none">×</span>
                          <input
                            type="number"
                            className="w-12 bg-transparent border-b border-neutral-600 text-xs text-neutral-300 focus:outline-none focus:border-neutral-400 text-center"
                            value={weight}
                            step={0.1}
                            onChange={(e) => setWeight(i, e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
