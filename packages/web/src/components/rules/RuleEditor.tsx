import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRulesStore } from "@/stores/rulesStore";
import type { TradingRule, Condition } from "@/types/rule";

const FIELDS: Condition["field"][] = ["price", "spread", "volume", "timeToClose", "aoi"];
const OPERATORS: Condition["operator"][] = ["<", ">", "==", "between"];

const EMPTY_CONDITION: Condition = { field: "price", operator: ">", value: 0.5 };

interface RuleEditorProps {
  editingRule?: TradingRule;
  onDone: () => void;
}

export function RuleEditor({ editingRule, onDone }: RuleEditorProps) {
  const { addRule, updateRule } = useRulesStore();

  const [name, setName] = useState(editingRule?.name ?? "");
  const [marketFilter, setMarketFilter] = useState(editingRule?.marketFilter ?? "btc-updown-5m-*");
  const [conditions, setConditions] = useState<Condition[]>(editingRule?.conditions ?? [{ ...EMPTY_CONDITION }]);
  const [actionType, setActionType] = useState<"BUY" | "SELL">(editingRule?.action.type ?? "BUY");
  const [actionOutcome, setActionOutcome] = useState<"YES" | "NO">(editingRule?.action.outcome ?? "YES");
  const [actionAmount, setActionAmount] = useState(String(editingRule?.action.amount ?? 10));
  const [cooldown, setCooldown] = useState(String(editingRule?.cooldown ?? 300));

  const handleSave = () => {
    if (!name.trim()) return;

    const rule: TradingRule = {
      id: editingRule?.id ?? crypto.randomUUID(),
      name: name.trim(),
      marketFilter,
      conditions,
      action: { type: actionType, outcome: actionOutcome, amount: parseFloat(actionAmount) || 10 },
      cooldown: parseInt(cooldown) || 300,
      enabled: editingRule?.enabled ?? true,
    };

    if (editingRule) {
      updateRule(rule.id, rule);
    } else {
      addRule(rule);
    }
    onDone();
  };

  const updateCondition = (idx: number, updates: Partial<Condition>) => {
    setConditions(conditions.map((c, i) => (i === idx ? { ...c, ...updates } : c)));
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

        {/* Conditions */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs text-neutral-500">Conditions (AND)</label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConditions([...conditions, { ...EMPTY_CONDITION }])}
            >
              + Add
            </Button>
          </div>
          <div className="space-y-2">
            {conditions.map((cond, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <select
                  value={cond.field}
                  onChange={(e) => updateCondition(idx, { field: e.target.value as Condition["field"] })}
                  className="select-field flex-1"
                >
                  {FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                <select
                  value={cond.operator}
                  onChange={(e) => {
                    const op = e.target.value as Condition["operator"];
                    updateCondition(idx, {
                      operator: op,
                      value: op === "between" ? [0, 1] : typeof cond.value === "number" ? cond.value : 0.5,
                    });
                  }}
                  className="select-field w-16"
                >
                  {OPERATORS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                {cond.operator === "between" ? (
                  <div className="flex items-center gap-1 flex-1">
                    <input
                      type="number"
                      step="0.01"
                      value={Array.isArray(cond.value) ? cond.value[0] : 0}
                      onChange={(e) => updateCondition(idx, {
                        value: [parseFloat(e.target.value) || 0, Array.isArray(cond.value) ? cond.value[1] : 1],
                      })}
                      className="input-field w-20"
                    />
                    <span className="text-xs text-neutral-600">–</span>
                    <input
                      type="number"
                      step="0.01"
                      value={Array.isArray(cond.value) ? cond.value[1] : 1}
                      onChange={(e) => updateCondition(idx, {
                        value: [Array.isArray(cond.value) ? cond.value[0] : 0, parseFloat(e.target.value) || 1],
                      })}
                      className="input-field w-20"
                    />
                  </div>
                ) : (
                  <input
                    type="number"
                    step="0.01"
                    value={typeof cond.value === "number" ? cond.value : 0}
                    onChange={(e) => updateCondition(idx, { value: parseFloat(e.target.value) || 0 })}
                    className="input-field flex-1"
                  />
                )}
                {conditions.length > 1 && (
                  <button onClick={() => removeCondition(idx)} className="text-neutral-600 hover:text-accent text-sm px-1">
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Action */}
        <div className="grid grid-cols-3 gap-2">
          <Field label="Action">
            <select value={actionType} onChange={(e) => setActionType(e.target.value as "BUY" | "SELL")} className="select-field">
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
          </Field>
          <Field label="Outcome">
            <select value={actionOutcome} onChange={(e) => setActionOutcome(e.target.value as "YES" | "NO")} className="select-field">
              <option value="YES">YES (Up)</option>
              <option value="NO">NO (Down)</option>
            </select>
          </Field>
          <Field label="Amount ($)">
            <input type="number" value={actionAmount} onChange={(e) => setActionAmount(e.target.value)} min="1" className="input-field" />
          </Field>
        </div>

        {/* Cooldown */}
        <Field label="Cooldown (seconds)">
          <input type="number" value={cooldown} onChange={(e) => setCooldown(e.target.value)} min="0" className="input-field" />
        </Field>

        {/* Actions */}
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
