import { create } from "zustand";
import { persist } from "zustand/middleware";
import { buyCost, orderFee } from "@/lib/fees";

export interface BotTrade {
  id: string;
  marketSlug: string;
  side: "BUY" | "SETTLE";
  outcome: "YES" | "NO";
  price: number;
  quantity: number;
  fee: number;
  total: number;
  pnl: number;
  ruleId: string;
  ruleName: string;
  timestamp: string;
  timeToClose: number; // seconds remaining when trade was made (0 for SETTLE)
}

export interface BotPosition {
  marketSlug: string;
  outcome: "YES" | "NO";
  quantity: number;
  avgEntryPrice: number;
  currentPrice: number;
}

export interface EquityPoint {
  timestamp: number;
  equity: number;
}

export interface TradingBot {
  id: string;
  name: string;
  subtitle: string;
  picIndex: number; // 0-35, maps to bot_pic_XX.png
  startingBalance: number;
  balance: number;
  ruleIds: string[];
  ruleMode: "INDEPENDENT" | "EXCLUSIVE";
  fallbackRuleId: string | null;
  fallbackTriggerTTC: number;
  enabled: boolean;
  trades: BotTrade[];
  positions: BotPosition[];
  equityHistory: EquityPoint[];
  lastFired: Record<string, number>;
  createdAt: string;
}

interface AddBotParams {
  name: string;
  subtitle: string;
  picIndex: number;
  startingBalance: number;
  ruleIds: string[];
  ruleMode: "INDEPENDENT" | "EXCLUSIVE";
  fallbackRuleId: string | null;
  fallbackTriggerTTC: number;
}

interface BotState {
  bots: TradingBot[];
  addBot: (p: AddBotParams) => string;
  removeBot: (id: string) => void;
  toggleBot: (id: string) => void;
  updateBot: (id: string, p: Partial<Pick<TradingBot, "name" | "subtitle" | "picIndex" | "ruleIds" | "ruleMode" | "fallbackRuleId" | "fallbackTriggerTTC">>) => void;
  executeBotBuy: (botId: string, p: {
    marketSlug: string;
    outcome: "YES" | "NO";
    price: number;
    amount: number;
    ruleId: string;
    ruleName: string;
    timeToClose: number;
  }) => boolean;
  settleBotMarket: (botId: string, marketSlug: string, outcomeWon: "YES" | "NO") => void;
  recordBotFired: (botId: string, ruleId: string, timestamp: number) => void;
  markToMarket: (botId: string, marketSlug: string, currentYesPrice: number) => void;
  resetBot: (id: string) => void;
}

export const useBotStore = create<BotState>()(
  persist(
    (set, get) => ({
      bots: [],

      addBot: ({ name, subtitle, picIndex, startingBalance, ruleIds, ruleMode, fallbackRuleId, fallbackTriggerTTC }) => {
        const id = crypto.randomUUID();
        const bot: TradingBot = {
          id,
          name,
          subtitle,
          picIndex,
          startingBalance,
          balance: startingBalance,
          ruleIds,
          ruleMode,
          fallbackRuleId,
          fallbackTriggerTTC,
          enabled: false,
          trades: [],
          positions: [],
          equityHistory: [{ timestamp: Date.now(), equity: startingBalance }],
          lastFired: {},
          createdAt: new Date().toISOString(),
        };
        set({ bots: [...get().bots, bot] });
        return id;
      },

      removeBot: (id) => set({ bots: get().bots.filter((b) => b.id !== id) }),

      toggleBot: (id) =>
        set({
          bots: get().bots.map((b) =>
            b.id === id ? { ...b, enabled: !b.enabled } : b,
          ),
        }),

      updateBot: (id, updates) =>
        set({
          bots: get().bots.map((b) =>
            b.id === id ? { ...b, ...updates } : b,
          ),
        }),

      executeBotBuy: (botId, { marketSlug, outcome, price, amount, ruleId, ruleName, timeToClose }) => {
        const state = get();
        const bot = state.bots.find((b) => b.id === botId);
        if (!bot) return false;
        if (price <= 0 || price >= 1) return false;

        const quantity = amount / price;
        const cost = buyCost(price, quantity);
        const fee = orderFee(price, quantity);
        if (cost > bot.balance) return false;

        const trade: BotTrade = {
          id: crypto.randomUUID(),
          marketSlug,
          side: "BUY",
          outcome,
          price,
          quantity,
          fee,
          total: cost,
          pnl: 0,
          ruleId,
          ruleName,
          timestamp: new Date().toISOString(),
          timeToClose,
        };

        const existing = bot.positions.find(
          (p) => p.marketSlug === marketSlug && p.outcome === outcome,
        );

        let newPositions: BotPosition[];
        if (existing) {
          const totalQty = existing.quantity + quantity;
          const avgPrice =
            (existing.avgEntryPrice * existing.quantity + price * quantity) / totalQty;
          newPositions = bot.positions.map((p) =>
            p.marketSlug === marketSlug && p.outcome === outcome
              ? { ...p, quantity: totalQty, avgEntryPrice: avgPrice }
              : p,
          );
        } else {
          newPositions = [
            ...bot.positions,
            { marketSlug, outcome, quantity, avgEntryPrice: price, currentPrice: price },
          ];
        }

        const newBalance = bot.balance - cost;
        const eq = newBalance + newPositions.reduce((s, p) => s + p.quantity * p.currentPrice, 0);

        set({
          bots: state.bots.map((b) =>
            b.id === botId
              ? {
                  ...b,
                  balance: newBalance,
                  trades: [trade, ...b.trades].slice(0, 500),
                  positions: newPositions,
                  equityHistory: [...b.equityHistory, { timestamp: Date.now(), equity: eq }].slice(-200),
                }
              : b,
          ),
        });
        return true;
      },

      settleBotMarket: (botId, marketSlug, outcomeWon) => {
        const state = get();
        const bot = state.bots.find((b) => b.id === botId);
        if (!bot) return;

        const affected = bot.positions.filter((p) => p.marketSlug === marketSlug);
        if (affected.length === 0) return;

        let payout = 0;
        const settleTrades: BotTrade[] = [];

        for (const pos of affected) {
          const won = pos.outcome === outcomeWon;
          const settlePrice = won ? 1.0 : 0.0;
          const amount = settlePrice * pos.quantity;
          const pnl = amount - pos.avgEntryPrice * pos.quantity;
          payout += amount;

          settleTrades.push({
            id: crypto.randomUUID(),
            marketSlug,
            side: "SETTLE",
            outcome: pos.outcome,
            price: settlePrice,
            quantity: pos.quantity,
            fee: 0,
            total: amount,
            pnl,
            ruleId: "",
            ruleName: "Settlement",
            timestamp: new Date().toISOString(),
            timeToClose: 0,
          });
        }

        const newBalance = bot.balance + payout;
        const newPositions = bot.positions.filter((p) => p.marketSlug !== marketSlug);
        const eq = newBalance + newPositions.reduce((s, p) => s + p.quantity * p.currentPrice, 0);

        set({
          bots: state.bots.map((b) =>
            b.id === botId
              ? {
                  ...b,
                  balance: newBalance,
                  trades: [...settleTrades, ...b.trades].slice(0, 500),
                  positions: newPositions,
                  equityHistory: [...b.equityHistory, { timestamp: Date.now(), equity: eq }].slice(-200),
                }
              : b,
          ),
        });
      },

      recordBotFired: (botId, ruleId, timestamp) => {
        set({
          bots: get().bots.map((b) =>
            b.id === botId
              ? { ...b, lastFired: { ...b.lastFired, [ruleId]: timestamp } }
              : b,
          ),
        });
      },

      markToMarket: (botId, marketSlug, currentYesPrice) => {
        set({
          bots: get().bots.map((b) => {
            if (b.id !== botId) return b;
            return {
              ...b,
              positions: b.positions.map((p) => {
                if (p.marketSlug !== marketSlug) return p;
                const mkt = p.outcome === "YES" ? currentYesPrice : 1 - currentYesPrice;
                return { ...p, currentPrice: mkt };
              }),
            };
          }),
        });
      },

      resetBot: (id) => {
        const bot = get().bots.find((b) => b.id === id);
        if (!bot) return;
        set({
          bots: get().bots.map((b) =>
            b.id === id
              ? {
                  ...b,
                  balance: b.startingBalance,
                  trades: [],
                  positions: [],
                  equityHistory: [{ timestamp: Date.now(), equity: b.startingBalance }],
                  lastFired: {},
                }
              : b,
          ),
        });
      },
    }),
    { name: "trading-bots" },
  ),
);
