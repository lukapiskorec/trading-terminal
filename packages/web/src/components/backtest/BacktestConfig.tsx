import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { TradingRule } from "@/types/rule";
import type { BacktestConfig as Config } from "@/types/backtest";
import { AOI_WINDOWS } from "@/lib/constants";
import { cn } from "@/lib/cn";

interface BacktestConfigProps {
  rules: TradingRule[];
  running: boolean;
  onRun: (config: Config) => void;
}

export function BacktestConfig({ rules, running, onRun }: BacktestConfigProps) {
  const [selectedRuleIds, setSelectedRuleIds] = useState<Set<string>>(new Set());
  const [balance, setBalance] = useState(1000);
  const [aoiWindow, setAoiWindow] = useState(12);
  const [ruleMode, setRuleMode] = useState<"INDEPENDENT" | "EXCLUSIVE">("INDEPENDENT");
  const [fallbackRuleId, setFallbackRuleId] = useState<string>("NONE");
  const [fallbackTTC, setFallbackTTC] = useState(60);

  const enabledRules = rules.filter((r) => r.enabled);

  function toggleRule(id: string) {
    setSelectedRuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedRuleIds(new Set(enabledRules.map((r) => r.id)));
  }

  function handleRun() {
    const selected = rules.filter((r) => selectedRuleIds.has(r.id));
    const fallbackRule =
      fallbackRuleId !== "NONE" ? (rules.find((r) => r.id === fallbackRuleId) ?? null) : null;
    if (selected.length === 0 && !fallbackRule) return;
    onRun({
      rules: selected,
      startingBalance: balance,
      aoiWindow,
      ruleMode,
      fallbackRule,
      fallbackTriggerTTC: fallbackTTC,
    });
  }

  const canRun = selectedRuleIds.size > 0 || fallbackRuleId !== "NONE";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Backtest Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Starting Balance */}
        <div>
          <label className="block text-xs text-neutral-400 mb-1">Starting Balance (USDC)</label>
          <input
            type="number"
            min={1}
            value={balance}
            onChange={(e) => setBalance(Number(e.target.value) || 1)}
            className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-neutral-500"
          />
        </div>

        {/* AOI Window */}
        <div>
          <label className="block text-xs text-neutral-400 mb-1">AOI Window for Conditions</label>
          <div className="flex gap-1">
            {AOI_WINDOWS.filter((w) => w > 1).map((w) => (
              <button
                key={w}
                onClick={() => setAoiWindow(w)}
                className={`rounded px-2 py-1 text-xs transition-colors ${
                  aoiWindow === w
                    ? "bg-neutral-100 text-neutral-900"
                    : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
                }`}
              >
                AOI-{w}
              </button>
            ))}
          </div>
        </div>

        {/* Rule Selection */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-neutral-400">Rules to Test</label>
            {enabledRules.length > 0 && (
              <button onClick={selectAll} className="text-xs text-neutral-500 hover:text-neutral-300">
                Select all
              </button>
            )}
          </div>

          {enabledRules.length === 0 ? (
            <p className="text-xs text-neutral-500 py-2">
              No enabled rules. Create rules in the Rules page first.
            </p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {enabledRules.map((rule) => (
                <label
                  key={rule.id}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-neutral-800 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedRuleIds.has(rule.id)}
                    onChange={() => toggleRule(rule.id)}
                    className="rounded border-neutral-600 bg-neutral-800"
                  />
                  <span className="text-neutral-200">{rule.name}</span>
                  <span className="ml-auto text-xs text-neutral-500">
                    {rule.action.type} {rule.action.outcome} ${rule.action.amount}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Rule Mode */}
        <div>
          <label className="block text-xs text-neutral-400 mb-1.5">Rule Interaction Mode</label>
          <div className="flex gap-1">
            {(["INDEPENDENT", "EXCLUSIVE"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setRuleMode(mode)}
                className={cn(
                  "rounded px-3 py-1 text-xs transition-colors",
                  ruleMode === mode
                    ? "bg-neutral-100 text-neutral-900"
                    : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700",
                )}
              >
                {mode}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-neutral-600">
            {ruleMode === "INDEPENDENT"
              ? "Each rule has its own cooldown. Multiple rules can fire in one market."
              : "When any rule fires, its cooldown blocks all other rules too."}
          </p>
        </div>

        {/* Fallback Rule */}
        <div>
          <label className="block text-xs text-neutral-400 mb-1.5">Fallback Rule</label>
          <select
            value={fallbackRuleId}
            onChange={(e) => setFallbackRuleId(e.target.value)}
            className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-neutral-500"
          >
            <option value="NONE">None</option>
            {enabledRules.map((rule) => (
              <option key={rule.id} value={rule.id}>
                {rule.name}
              </option>
            ))}
          </select>

          {fallbackRuleId !== "NONE" && (
            <div className="mt-2 flex items-center gap-2">
              <label className="text-xs text-neutral-500 whitespace-nowrap">Trigger at TTC ≤</label>
              <input
                type="number"
                min={1}
                max={300}
                value={fallbackTTC}
                onChange={(e) => setFallbackTTC(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-20 rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-neutral-500"
              />
              <span className="text-xs text-neutral-500">s</span>
            </div>
          )}

          {fallbackRuleId !== "NONE" && (
            <p className="mt-1 text-xs text-neutral-600">
              Fires at TTC ≤ {fallbackTTC}s only if no primary rule triggered. Cooldown then
              blocks all rules.
            </p>
          )}
        </div>

        {/* Run Button */}
        <Button onClick={handleRun} disabled={running || !canRun} className="w-full">
          {running ? "Running..." : "Run Backtest"}
        </Button>
      </CardContent>
    </Card>
  );
}
