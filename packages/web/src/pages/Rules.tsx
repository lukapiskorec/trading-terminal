import { useState } from "react";
import { RuleList } from "@/components/rules/RuleList";
import { RuleEditor } from "@/components/rules/RuleEditor";
import { ExecutionLog } from "@/components/rules/ExecutionLog";
import type { TradingRule } from "@/types/rule";

type Mode = { view: "list" } | { view: "edit"; rule?: TradingRule };

export function Rules() {
  const [mode, setMode] = useState<Mode>({ view: "list" });

  return (
    <div className="space-y-4">
      {mode.view === "edit" ? (
        <RuleEditor
          editingRule={mode.rule}
          onDone={() => setMode({ view: "list" })}
        />
      ) : (
        <RuleList
          onNew={() => setMode({ view: "edit" })}
          onEdit={(rule) => setMode({ view: "edit", rule })}
        />
      )}

      <ExecutionLog />
    </div>
  );
}
