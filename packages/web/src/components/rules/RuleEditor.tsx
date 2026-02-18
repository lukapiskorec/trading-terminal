import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRulesStore } from "@/stores/rulesStore";
import type { TradingRule, Condition } from "@/types/rule";
import { cn } from "@/lib/cn";

const FIELDS: Condition["field"][] = ["priceYes", "priceNo", "spread", "volume", "timeToClose", "aoi"];
const OPERATORS: Condition["operator"][] = ["<", ">", "==", "between"];

const FIELD_META: Record<Condition["field"], { label: string; defaultValue: number; unit: string; step: string }> = {
  priceYes:    { label: "Price UP (YES)",  defaultValue: 0.5,  unit: "prob (0–1)", step: "0.01" },
  priceNo:     { label: "Price DOWN (NO)", defaultValue: 0.5,  unit: "prob (0–1)", step: "0.01" },
  spread:      { label: "Spread",          defaultValue: 0.02, unit: "USDC",       step: "0.001" },
  volume:      { label: "Volume",          defaultValue: 1000, unit: "USDC",       step: "100" },
  timeToClose: { label: "Time to Close",   defaultValue: 60,   unit: "sec",        step: "1" },
  aoi:         { label: "AOI",             defaultValue: 0.5,  unit: "(0–1)",      step: "0.01" },
};

const makeEmptyCondition = (): Condition => ({ field: "priceYes", operator: ">", value: 0.5 });

interface RuleEditorProps {
  editingRule?: TradingRule;
  onDone: () => void;
}

export function RuleEditor({ editingRule, onDone }: RuleEditorProps) {
  const { addRule, updateRule } = useRulesStore();

  const [name, setName] = useState(editingRule?.name ?? "");
  const [marketFilter, setMarketFilter] = useState(editingRule?.marketFilter ?? "btc-updown-5m-*");
  const [isRandom, setIsRandom] = useState(!!editingRule?.randomConfig);
  const [conditionMode, setConditionMode] = useState<"AND" | "OR">(editingRule?.conditionMode ?? "AND");
  const [conditions, setConditions] = useState<Condition[]>(
    editingRule?.conditions?.length ? editingRule.conditions : [makeEmptyCondition()],
  );
  const [actionType, setActionType] = useState<"BUY" | "SELL">(editingRule?.action.type ?? "BUY");
  const [actionOutcome, setActionOutcome] = useState<"YES" | "NO">(editingRule?.action.outcome ?? "YES");
  const [actionAmount, setActionAmount] = useState(String(editingRule?.action.amount ?? 10));
  const [cooldown, setCooldown] = useState(String(editingRule?.cooldown ?? 300));
  const [upRatioPct, setUpRatioPct] = useState(
    Math.round((editingRule?.randomConfig?.upRatio ?? 0.5) * 100),
  );
  const [triggerAtClose, setTriggerAtClose] = useState(
    editingRule?.randomConfig?.triggerAtTimeToClose ?? 30,
  );

  const handleSave = () => {
    if (!name.trim()) return;

    const rule: TradingRule = {
      id: editingRule?.id ?? crypto.randomUUID(),
      name: name.trim(),
      marketFilter,
      conditionMode,
      conditions: isRandom ? [] : conditions,
      action: { type: actionType, outcome: actionOutcome, amount: parseFloat(actionAmount) || 10 },
      cooldown: parseInt(cooldown) || 300,
      enabled: editingRule?.enabled ?? true,
      randomConfig: isRandom
        ? { upRatio: upRatioPct / 100, triggerAtTimeToClose: triggerAtClose }
        : undefined,
    };

    if (editingRule) {
      updateRule(rule.id, rule);
    } else {
      addRule(rule);
    }
    onDone();
  };

  const updateCondition = (idx: number, updates: Partial<Condition>) => {
    setConditions(conditions.map((c, i) => {
      if (i !== idx) return c;
      const merged = { ...c, ...updates };
      // When field changes, reset value to field-appropriate default
      if (updates.field && updates.field !== c.field) {
        const meta = FIELD_META[updates.field];
        merged.value = merged.operator === "between"
          ? [meta.defaultValue, meta.defaultValue]
          : meta.defaultValue;
      }
      return merged;
    }));
  };

  const removeCondition = (idx: number) => {
    setConditions(conditions.filter((_, i) => i !== idx));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{editingRule ? "Edit Rule" : "New Rule"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Name */}
        <Field label="Rule Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Mean reversion buy"
            className="input-field"
          />
        </Field>

        {/* Market filter */}
        <Field label="Market Filter">
          <input
            value={marketFilter}
            onChange={(e) => setMarketFilter(e.target.value)}
            placeholder="btc-updown-5m-*"
            className="input-field"
          />
        </Field>

        {/* Rule type toggle */}
        <div>
          <label className="text-xs text-neutral-500 block mb-1.5">Rule Type</label>
          <div className="flex gap-1">
            {(["Conditional", "Random"] as const).map((type) => (
              <button
                key={type}
                onClick={() => setIsRandom(type === "Random")}
                className={cn(
                  "rounded px-3 py-1 text-xs transition-colors",
                  (type === "Random") === isRandom
                    ? "bg-neutral-100 text-neutral-900"
                    : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700",
                )}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {isRandom ? (
          /* Random rule config */
          <div className="space-y-3 rounded-md border border-theme bg-surface/40 p-3">
            <p className="text-xs text-neutral-500">
              Fires once per market when time to close reaches the threshold. Outcome is decided randomly per the ratio.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="UP (YES) chance">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={upRatioPct}
                    onChange={(e) => setUpRatioPct(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                    className="input-field w-16"
                  />
                  <span className="text-xs text-neutral-500">% UP / {100 - upRatioPct}% DOWN</span>
                </div>
              </Field>
              <Field label="Trigger at time to close ≤">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    value={triggerAtClose}
                    onChange={(e) => setTriggerAtClose(parseInt(e.target.value) || 1)}
                    className="input-field w-20"
                  />
                  <span className="text-xs text-neutral-500">sec</span>
                </div>
              </Field>
            </div>
          </div>
        ) : (
          /* Conditional rule: conditions with AND/OR toggle */
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <label className="text-xs text-neutral-500">Conditions</label>
                <div className="flex gap-0.5">
                  {(["AND", "OR"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setConditionMode(mode)}
                      className={cn(
                        "rounded px-1.5 py-0.5 text-xs transition-colors",
                        conditionMode === mode
                          ? "bg-neutral-600 text-neutral-100"
                          : "text-neutral-600 hover:text-neutral-400",
                      )}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConditions([...conditions, makeEmptyCondition()])}
              >
                + Add
              </Button>
            </div>
            <div className="space-y-2">
              {conditions.map((cond, idx) => {
                const meta = FIELD_META[cond.field];
                return (
                  <div key={idx} className="flex items-center gap-1.5">
                    <select
                      value={cond.field}
                      onChange={(e) => updateCondition(idx, { field: e.target.value as Condition["field"] })}
                      className="select-field flex-1 min-w-0"
                    >
                      {FIELDS.map((f) => (
                        <option key={f} value={f}>{FIELD_META[f].label}</option>
                      ))}
                    </select>
                    <select
                      value={cond.operator}
                      onChange={(e) => {
                        const op = e.target.value as Condition["operator"];
                        updateCondition(idx, {
                          operator: op,
                          value: op === "between"
                            ? [meta.defaultValue, meta.defaultValue]
                            : typeof cond.value === "number" ? cond.value : meta.defaultValue,
                        });
                      }}
                      className="select-field w-16 flex-shrink-0"
                    >
                      {OPERATORS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                    {cond.operator === "between" ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step={meta.step}
                          value={Array.isArray(cond.value) ? cond.value[0] : meta.defaultValue}
                          onChange={(e) => updateCondition(idx, {
                            value: [parseFloat(e.target.value) || 0, Array.isArray(cond.value) ? cond.value[1] : meta.defaultValue],
                          })}
                          className="input-field w-16"
                        />
                        <span className="text-xs text-neutral-600">–</span>
                        <input
                          type="number"
                          step={meta.step}
                          value={Array.isArray(cond.value) ? cond.value[1] : meta.defaultValue}
                          onChange={(e) => updateCondition(idx, {
                            value: [Array.isArray(cond.value) ? cond.value[0] : meta.defaultValue, parseFloat(e.target.value) || 0],
                          })}
                          className="input-field w-16"
                        />
                        <span className="text-xs text-neutral-600 flex-shrink-0">{meta.unit}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step={meta.step}
                          value={typeof cond.value === "number" ? cond.value : meta.defaultValue}
                          onChange={(e) => updateCondition(idx, { value: parseFloat(e.target.value) || 0 })}
                          className="input-field w-20"
                        />
                        <span className="text-xs text-neutral-600 flex-shrink-0">{meta.unit}</span>
                      </div>
                    )}
                    {conditions.length > 1 && (
                      <button onClick={() => removeCondition(idx)} className="text-neutral-600 hover:text-accent text-sm px-1 flex-shrink-0">
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Action */}
        <div className={cn("grid gap-2", isRandom ? "grid-cols-2" : "grid-cols-3")}>
          <Field label="Action">
            <select value={actionType} onChange={(e) => setActionType(e.target.value as "BUY" | "SELL")} className="select-field">
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
          </Field>
          {!isRandom && (
            <Field label="Outcome">
              <select value={actionOutcome} onChange={(e) => setActionOutcome(e.target.value as "YES" | "NO")} className="select-field">
                <option value="YES">UP (YES)</option>
                <option value="NO">DOWN (NO)</option>
              </select>
            </Field>
          )}
          <Field label="Amount ($)">
            <input type="number" value={actionAmount} onChange={(e) => setActionAmount(e.target.value)} min="1" className="input-field" />
          </Field>
        </div>

        {/* Cooldown */}
        <Field label="Cooldown (seconds)">
          <input type="number" value={cooldown} onChange={(e) => setCooldown(e.target.value)} min="0" className="input-field" />
        </Field>

        <div className="flex gap-2 pt-1">
          <Button onClick={handleSave} disabled={!name.trim()}>
            {editingRule ? "Update" : "Create"} Rule
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-neutral-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}
