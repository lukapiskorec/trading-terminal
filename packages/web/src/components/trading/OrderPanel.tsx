import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTradeStore } from "@/stores/tradeStore";
import { buyCost, feePercentage, orderFee } from "@/lib/fees";
import type { Market, PriceSnapshot } from "@/types/market";

interface OrderPanelProps {
  market: Market | null;
  latestSnapshot: PriceSnapshot | null;
}

export function OrderPanel({ market, latestSnapshot }: OrderPanelProps) {
  const [outcome, setOutcome] = useState<"YES" | "NO">("YES");
  const [amount, setAmount] = useState("10");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { balance, buy } = useTradeStore();

  const midPrice = latestSnapshot?.mid_price_yes ?? latestSnapshot?.last_trade_price ?? 0.5;
  const price = outcome === "YES" ? midPrice : 1 - midPrice;
  const amountNum = parseFloat(amount) || 0;
  const quantity = price > 0 ? amountNum / price : 0;
  const fee = orderFee(price, quantity);
  const totalCost = buyCost(price, quantity);

  const handleBuy = () => {
    if (!market) return;
    setError(null);
    setSuccess(null);

    const result = buy({
      marketId: market.id,
      slug: market.slug,
      outcome,
      price,
      quantity,
    });

    if (result.success) {
      setSuccess(`Bought ${quantity.toFixed(1)} ${outcome} @ $${price.toFixed(3)}`);
      setTimeout(() => setSuccess(null), 3000);
    } else {
      setError(result.error ?? "Trade failed");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Order Panel</CardTitle>
        <p className="text-xs text-neutral-500 font-mono">
          Balance: ${balance.toFixed(2)}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!market ? (
          <p className="text-sm text-neutral-500">Select a market to trade</p>
        ) : (
          <>
            <div className="text-xs text-neutral-400 truncate">{market.question}</div>

            {/* Outcome toggle */}
            <div className="flex gap-1">
              <button
                onClick={() => setOutcome("YES")}
                className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
                  outcome === "YES"
                    ? "bg-magenta text-white"
                    : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
                }`}
              >
                YES (Up)
              </button>
              <button
                onClick={() => setOutcome("NO")}
                className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
                  outcome === "NO"
                    ? "bg-accent text-neutral-950"
                    : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
                }`}
              >
                NO (Down)
              </button>
            </div>

            {/* Amount input */}
            <div>
              <label className="text-xs text-neutral-500">Amount (USDC)</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setError(null); }}
                min="1"
                step="1"
                className="mt-1 w-full rounded-md border border-theme bg-panel px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-accent"
              />
            </div>

            {/* Order preview */}
            <div className="space-y-1 rounded-md bg-panel/50 p-2.5 text-xs font-mono">
              <Row label="Price" value={`$${price.toFixed(4)}`} />
              <Row label="Shares" value={quantity.toFixed(2)} />
              <Row label={`Fee (${feePercentage(price)})`} value={`$${fee.toFixed(4)}`} />
              <div className="border-t border-theme pt-1 mt-1">
                <Row label="Total cost" value={`$${totalCost.toFixed(4)}`} bold />
              </div>
            </div>

            <Button
              onClick={handleBuy}
              disabled={!market || amountNum <= 0 || totalCost > balance}
              className="w-full"
            >
              Buy {outcome}
            </Button>

            {error && <p className="text-xs text-neutral-400">{error}</p>}
            {success && <p className="text-xs text-neutral-300">{success}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold text-neutral-200" : "text-neutral-400"}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
