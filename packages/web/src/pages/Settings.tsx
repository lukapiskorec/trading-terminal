import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTradeStore } from "@/stores/tradeStore";
import { useRulesStore } from "@/stores/rulesStore";
import { useState } from "react";

export function Settings() {
  const { startingBalance, wsAutoConnect, setStartingBalance, setWsAutoConnect } = useSettingsStore();
  const resetTrades = useTradeStore((s) => s.reset);
  const clearExecutions = useRulesStore((s) => s.clearExecutions);

  const [balanceInput, setBalanceInput] = useState(String(startingBalance));
  const [saved, setSaved] = useState(false);

  function handleSaveBalance() {
    const val = parseFloat(balanceInput);
    if (val > 0) {
      setStartingBalance(val);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  function handleResetSimulator() {
    resetTrades();
    clearExecutions();
  }

  return (
    <div className="max-w-lg space-y-4">
      {/* Simulator Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Simulator</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="block text-xs text-neutral-400 mb-1">Default Starting Balance (USDC)</label>
            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                value={balanceInput}
                onChange={(e) => setBalanceInput(e.target.value)}
                className="flex-1 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:ring-1 focus:ring-neutral-500"
              />
              <Button size="sm" onClick={handleSaveBalance}>
                Save
              </Button>
            </div>
            {saved && <p className="text-xs text-green-400 mt-1">Saved</p>}
          </div>

          <div className="border-t border-neutral-800 pt-3">
            <Button variant="outline" size="sm" onClick={handleResetSimulator}>
              Reset Simulator & Clear Logs
            </Button>
            <p className="text-xs text-neutral-500 mt-1">
              Resets balance, clears all trades, positions, and rule execution logs
            </p>
          </div>
        </CardContent>
      </Card>

      {/* WebSocket Settings */}
      <Card>
        <CardHeader>
          <CardTitle>WebSocket</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={wsAutoConnect}
              onChange={(e) => setWsAutoConnect(e.target.checked)}
              className="rounded border-neutral-600 bg-neutral-800"
            />
            <span className="text-sm text-neutral-200">Auto-connect on Dashboard load</span>
          </label>
          <p className="text-xs text-neutral-500">
            When enabled, the Dashboard will automatically connect to Polymarket's WebSocket for live price updates.
          </p>
        </CardContent>
      </Card>

      {/* Data Info */}
      <Card>
        <CardHeader>
          <CardTitle>Data</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-neutral-400">
          <Row label="Historical data" value="Supabase (requires .env)" />
          <Row label="Live data" value="Polymarket WebSocket (direct)" />
          <Row label="Trades & Rules" value="localStorage (browser)" />
          <Row label="Collection script" value="pnpm --filter scripts collect" />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-300 font-mono">{value}</span>
    </div>
  );
}
