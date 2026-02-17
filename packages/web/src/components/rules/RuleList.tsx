import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRulesStore } from "@/stores/rulesStore";
import { cn } from "@/lib/cn";
import type { TradingRule } from "@/types/rule";

interface RuleListProps {
  onEdit: (rule: TradingRule) => void;
  onNew: () => void;
}

export function RuleList({ onEdit, onNew }: RuleListProps) {
  const { rules, toggleRule, removeRule } = useRulesStore();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Trading Rules ({rules.length})</CardTitle>
          <Button size="sm" onClick={onNew}>+ New Rule</Button>
        </div>
      </CardHeader>
      <CardContent>
        {rules.length === 0 ? (
          <p className="text-sm text-neutral-500">No rules defined. Create one to automate trades.</p>
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className={cn(
                  "flex items-center justify-between rounded-md border px-3 py-2",
                  rule.enabled
                    ? "border-theme bg-panel/50"
                    : "border-theme/50 bg-surface/50 opacity-60",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "h-2 w-2 rounded-full",
                      rule.enabled ? "bg-magenta" : "bg-neutral-600",
                    )} />
                    <span className="text-sm font-medium truncate">{rule.name}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-neutral-500 font-mono">
                    {formatRuleSummary(rule)}
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => toggleRule(rule.id)}>
                    {rule.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onEdit(rule)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" className="text-accent hover:text-accent/80" onClick={() => removeRule(rule.id)}>
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatRuleSummary(rule: TradingRule): string {
  const conds = rule.conditions.map((c) => {
    if (c.operator === "between" && Array.isArray(c.value)) {
      return `${c.field} ${c.value[0]}–${c.value[1]}`;
    }
    return `${c.field} ${c.operator} ${c.value}`;
  }).join(" AND ");

  return `IF ${conds} → ${rule.action.type} ${rule.action.outcome} $${rule.action.amount} (cd: ${rule.cooldown}s)`;
}
