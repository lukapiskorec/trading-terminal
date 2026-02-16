import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Trade, Position } from "@/types/trade";
import { buyCost, orderFee } from "@/lib/fees";

const DEFAULT_BALANCE = 1000; // USDC

interface TradeState {
  balance: number;
  trades: Trade[];
  positions: Position[];

  /** Place a buy order at the given price */
  buy: (params: {
    marketId: number;
    slug: string;
    outcome: "YES" | "NO";
    price: number;
    quantity: number;
    ruleId?: string;
  }) => { success: boolean; error?: string };

  /** Sell (close) a position at the given price */
  sell: (params: {
    marketId: number;
    outcome: "YES" | "NO";
    price: number;
    quantity: number;
  }) => { success: boolean; error?: string };

  /** Settle all positions for a resolved market */
  settleMarket: (marketId: number, slug: string, outcomeWon: "YES" | "NO") => void;

  /** Update mark-to-market prices for positions */
  markToMarket: (marketId: number, currentPrice: number) => void;

  /** Reset to default state */
  reset: () => void;
}

export const useTradeStore = create<TradeState>()(
  persist(
    (set, get) => ({
      balance: DEFAULT_BALANCE,
      trades: [],
      positions: [],

      buy: ({ marketId, slug, outcome, price, quantity, ruleId }) => {
        const state = get();
        const cost = buyCost(price, quantity);
        const fee = orderFee(price, quantity);

        if (cost > state.balance) {
          return { success: false, error: `Insufficient balance: need $${cost.toFixed(2)}, have $${state.balance.toFixed(2)}` };
        }
        if (quantity <= 0 || price <= 0 || price >= 1) {
          return { success: false, error: "Invalid price or quantity" };
        }

        const trade: Trade = {
          id: crypto.randomUUID(),
          marketId,
          slug,
          side: "BUY",
          outcome,
          price,
          quantity,
          fee,
          total: cost,
          timestamp: new Date().toISOString(),
          ruleId: ruleId ?? null,
        };

        // Update or create position
        const existing = state.positions.find(
          (p) => p.marketId === marketId && p.outcome === outcome,
        );

        let newPositions: Position[];
        if (existing) {
          const totalQty = existing.quantity + quantity;
          const avgPrice =
            (existing.avgEntryPrice * existing.quantity + price * quantity) / totalQty;
          newPositions = state.positions.map((p) =>
            p.marketId === marketId && p.outcome === outcome
              ? { ...p, quantity: totalQty, avgEntryPrice: avgPrice }
              : p,
          );
        } else {
          newPositions = [
            ...state.positions,
            {
              marketId,
              slug,
              outcome,
              quantity,
              avgEntryPrice: price,
              currentPrice: price,
              unrealizedPnl: 0,
            },
          ];
        }

        set({
          balance: state.balance - cost,
          trades: [trade, ...state.trades],
          positions: newPositions,
        });

        return { success: true };
      },

      sell: ({ marketId, outcome, price, quantity }) => {
        const state = get();
        const pos = state.positions.find(
          (p) => p.marketId === marketId && p.outcome === outcome,
        );

        if (!pos || pos.quantity < quantity) {
          return { success: false, error: "Insufficient position" };
        }

        const fee = orderFee(price, quantity);
        const proceeds = price * quantity - fee;

        const trade: Trade = {
          id: crypto.randomUUID(),
          marketId,
          slug: pos.slug,
          side: "SELL",
          outcome,
          price,
          quantity,
          fee,
          total: proceeds,
          timestamp: new Date().toISOString(),
          ruleId: null,
        };

        const remaining = pos.quantity - quantity;
        const newPositions =
          remaining <= 0
            ? state.positions.filter((p) => !(p.marketId === marketId && p.outcome === outcome))
            : state.positions.map((p) =>
                p.marketId === marketId && p.outcome === outcome
                  ? { ...p, quantity: remaining }
                  : p,
              );

        set({
          balance: state.balance + proceeds,
          trades: [trade, ...state.trades],
          positions: newPositions,
        });

        return { success: true };
      },

      settleMarket: (marketId, slug, outcomeWon) => {
        const state = get();
        const affected = state.positions.filter((p) => p.marketId === marketId);
        if (affected.length === 0) return;

        let payout = 0;
        const settleTrades: Trade[] = [];

        for (const pos of affected) {
          const won = pos.outcome === outcomeWon;
          const settlePrice = won ? 1.0 : 0.0;
          const amount = settlePrice * pos.quantity;
          payout += amount;

          settleTrades.push({
            id: crypto.randomUUID(),
            marketId,
            slug,
            side: "SELL",
            outcome: pos.outcome,
            price: settlePrice,
            quantity: pos.quantity,
            fee: 0,
            total: amount,
            timestamp: new Date().toISOString(),
            ruleId: null,
          });
        }

        set({
          balance: state.balance + payout,
          trades: [...settleTrades, ...state.trades],
          positions: state.positions.filter((p) => p.marketId !== marketId),
        });
      },

      markToMarket: (marketId, currentPrice) => {
        set({
          positions: get().positions.map((p) => {
            if (p.marketId !== marketId) return p;
            const mkt = p.outcome === "YES" ? currentPrice : 1 - currentPrice;
            return {
              ...p,
              currentPrice: mkt,
              unrealizedPnl: (mkt - p.avgEntryPrice) * p.quantity,
            };
          }),
        });
      },

      reset: () => set({ balance: DEFAULT_BALANCE, trades: [], positions: [] }),
    }),
    { name: "trading-simulator" },
  ),
);
