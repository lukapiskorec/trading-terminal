import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useRulesStore } from "@/stores/rulesStore";
import { useBotStore } from "@/stores/botStore";
import type { TradingBot } from "@/stores/botStore";
import { BOT_PROFILES, BOT_PIC_COUNT, botPicUrl, randomBotProfile } from "@/lib/botProfiles";

interface BotFormProps {
  editBot?: TradingBot | null;
  onDone: () => void;
}

export function BotForm({ editBot, onDone }: BotFormProps) {
  const globalRules = useRulesStore((s) => s.rules);
  const bots = useBotStore((s) => s.bots);
  const addBot = useBotStore((s) => s.addBot);
  const updateBot = useBotStore((s) => s.updateBot);

  // Pick defaults
  const usedPics = bots.filter((b) => b.id !== editBot?.id).map((b) => b.picIndex);

  const [picIndex, setPicIndex] = useState(editBot?.picIndex ?? 0);
  const [name, setName] = useState(editBot?.name ?? "");
  const [subtitle, setSubtitle] = useState(editBot?.subtitle ?? "");
  const [balance, setBalance] = useState(String(editBot?.startingBalance ?? 1000));
  const [selectedRules, setSelectedRules] = useState<Set<string>>(
    new Set(editBot?.ruleIds ?? []),
  );
  const [ruleMode, setRuleMode] = useState<"INDEPENDENT" | "EXCLUSIVE">(
    editBot?.ruleMode ?? "INDEPENDENT",
  );
  const [fallbackRuleId, setFallbackRuleId] = useState<string>(
    editBot?.fallbackRuleId ?? "NONE",
  );
  const [fallbackTTC, setFallbackTTC] = useState(editBot?.fallbackTriggerTTC ?? 60);
  const [showPicPicker, setShowPicPicker] = useState(false);

  // Auto-assign random profile on create
  useEffect(() => {
    if (editBot) return;
    const profile = randomBotProfile(usedPics);
    setPicIndex(profile.picIndex);
    setName(profile.name);
    setSubtitle(profile.subtitle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePicSelect = (idx: number) => {
    setPicIndex(idx);
    if (!editBot) {
      setName(BOT_PROFILES[idx].name);
      setSubtitle(BOT_PROFILES[idx].subtitle);
    }
    setShowPicPicker(false);
  };

  const toggleRule = (id: string) => {
    setSelectedRules((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const enabledRules = globalRules.filter((r) => r.enabled);

  const handleSubmit = () => {
    if (!name.trim()) return;
    if (selectedRules.size === 0 && fallbackRuleId === "NONE") return;

    if (editBot) {
      updateBot(editBot.id, {
        name: name.trim(),
        subtitle: subtitle.trim(),
        picIndex,
        ruleIds: [...selectedRules],
        ruleMode,
        fallbackRuleId: fallbackRuleId === "NONE" ? null : fallbackRuleId,
        fallbackTriggerTTC: fallbackTTC,
      });
    } else {
      addBot({
        name: name.trim(),
        subtitle: subtitle.trim(),
        picIndex,
        startingBalance: parseFloat(balance) || 1000,
        ruleIds: [...selectedRules],
        ruleMode,
        fallbackRuleId: fallbackRuleId === "NONE" ? null : fallbackRuleId,
        fallbackTriggerTTC: fallbackTTC,
      });
    }
    onDone();
  };

  const canSubmit = name.trim().length > 0 && (selectedRules.size > 0 || fallbackRuleId !== "NONE");

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="text-sm font-semibold text-neutral-300">
          {editBot ? "Edit Bot" : "New Trading Bot"}
        </div>

        {/* Profile pic + name + subtitle */}
        <div className="flex items-start gap-3">
          <button
            onClick={() => setShowPicPicker(!showPicPicker)}
            className="flex-shrink-0 rounded-md border-2 border-theme hover:border-accent transition-colors overflow-hidden"
          >
            <img src={botPicUrl(picIndex)} alt="Bot" className="w-16 h-16 object-cover" />
          </button>
          <div className="flex-1 space-y-1.5">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Bot name"
              className="w-full rounded-md border border-theme bg-panel px-3 py-1 text-sm text-neutral-100 outline-none focus:border-accent"
            />
            <input
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="Subtitle"
              className="w-full rounded-md border border-theme bg-panel px-3 py-1 text-[11px] text-neutral-400 outline-none focus:border-accent uppercase tracking-wider"
            />
          </div>
        </div>

        {/* Picture picker grid */}
        {showPicPicker && (
          <div className="grid grid-cols-9 gap-1 p-2 border border-theme rounded-md bg-surface max-h-48 overflow-y-auto">
            {Array.from({ length: BOT_PIC_COUNT }, (_, i) => (
              <button
                key={i}
                onClick={() => handlePicSelect(i)}
                className={cn(
                  "rounded overflow-hidden border-2 transition-colors",
                  i === picIndex ? "border-magenta" : "border-transparent hover:border-neutral-600",
                )}
              >
                <img src={botPicUrl(i)} alt={BOT_PROFILES[i].name} className="w-full aspect-square object-cover" />
              </button>
            ))}
          </div>
        )}

        {/* Starting balance (only on create) */}
        {!editBot && (
          <div>
            <label className="text-xs text-neutral-500">Starting Balance (USDC)</label>
            <input
              type="number"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              min="10"
              step="100"
              className="mt-1 w-full rounded-md border border-theme bg-panel px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-accent"
            />
          </div>
        )}

        {/* Rule selection with formulas */}
        <div>
          <label className="text-xs text-neutral-500">Trading Rules</label>
          {enabledRules.length === 0 ? (
            <p className="text-xs text-neutral-600 mt-1">
              No enabled rules. Create rules on the Rules page first.
            </p>
          ) : (
            <div className="mt-1 space-y-1 max-h-48 overflow-y-auto">
              {enabledRules.map((rule) => (
                <label
                  key={rule.id}
                  className={cn(
                    "flex items-start gap-2 text-xs rounded px-2 py-1.5 cursor-pointer transition-colors",
                    selectedRules.has(rule.id) ? "bg-neutral-800/80" : "hover:bg-neutral-800/40",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selectedRules.has(rule.id)}
                    onChange={() => toggleRule(rule.id)}
                    className="accent-magenta mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-neutral-200">{rule.name}</div>
                    <div className="text-[10px] text-neutral-500 font-mono truncate">
                      {formatRuleSummary(rule)}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Rule interaction mode */}
        <div>
          <label className="text-xs text-neutral-500 block mb-1.5">Rule Interaction</label>
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
          <p className="mt-1 text-[10px] text-neutral-600">
            {ruleMode === "INDEPENDENT"
              ? "Each rule has its own cooldown. Multiple rules can fire per market."
              : "When any rule fires, its cooldown blocks all other rules."}
          </p>
        </div>

        {/* Fallback rule */}
        <div>
          <label className="text-xs text-neutral-500 block mb-1">Fallback Rule</label>
          <select
            value={fallbackRuleId}
            onChange={(e) => setFallbackRuleId(e.target.value)}
            className="w-full rounded-md border border-theme bg-panel px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-accent"
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
                className="w-20 rounded-md border border-theme bg-panel px-2 py-1 text-sm text-neutral-100 outline-none focus:border-accent"
              />
              <span className="text-xs text-neutral-500">s</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button onClick={handleSubmit} disabled={!canSubmit} className="flex-1">
            {editBot ? "Save Changes" : "Create Bot"}
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Rule formula formatting (matches Rules page) ---

import type { TradingRule } from "@/types/rule";

const FIELD_SHORT: Record<string, string> = {
  priceYes: "P↑(YES)",
  priceNo: "P↓(NO)",
  spread: "spread",
  volume: "volume",
  timeToClose: "ttc",
  aoi: "aoi",
};

function formatRuleSummary(rule: TradingRule): string {
  if (rule.randomConfig) {
    const upPct = Math.round(rule.randomConfig.upRatio * 100);
    return `RANDOM ${upPct}%UP/${100 - upPct}%DN @ ttc≤${rule.randomConfig.triggerAtTimeToClose}s → $${rule.action.amount} cd:${rule.cooldown}s`;
  }
  const sep = (rule.conditionMode ?? "AND") === "OR" ? " OR " : " AND ";
  const conds = rule.conditions
    .map((c) => {
      const field = FIELD_SHORT[c.field] ?? c.field;
      if (c.operator === "between" && Array.isArray(c.value)) {
        return `${field} ${c.value[0]}–${c.value[1]}`;
      }
      return `${field}${c.operator}${c.value}`;
    })
    .join(sep);
  const outcome = rule.action.outcome === "YES" ? "UP(YES)" : "DN(NO)";
  return `IF ${conds} → ${rule.action.type} ${outcome} $${rule.action.amount} cd:${rule.cooldown}s`;
}
