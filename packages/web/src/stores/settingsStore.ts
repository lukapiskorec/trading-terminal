import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  /** Starting balance for the trading simulator (USDC) */
  startingBalance: number;
  /** Auto-connect WebSocket on Dashboard load */
  wsAutoConnect: boolean;

  setStartingBalance: (balance: number) => void;
  setWsAutoConnect: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      startingBalance: 1000,
      wsAutoConnect: false,

      setStartingBalance: (balance) => set({ startingBalance: balance }),
      setWsAutoConnect: (enabled) => set({ wsAutoConnect: enabled }),
    }),
    { name: "trading-settings" },
  ),
);
