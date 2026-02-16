import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import type { Market, PriceSnapshot, MarketOutcome, LiveMarket } from "@/types/market";

interface MarketState {
  /** Historical markets loaded from Supabase */
  markets: Market[];
  /** Price snapshots for the currently selected date/range */
  snapshots: PriceSnapshot[];
  /** Outcome data for AOI calculations */
  outcomes: MarketOutcome[];
  /** Currently active live market (from WebSocket) */
  liveMarket: LiveMarket | null;

  loading: boolean;
  error: string | null;

  /** Fetch all markets for a given date (UTC) */
  fetchMarketsByDate: (date: string) => Promise<void>;
  /** Fetch price snapshots for a set of market IDs */
  fetchSnapshots: (marketIds: number[]) => Promise<void>;
  /** Fetch resolved outcomes for AOI calculations */
  fetchOutcomes: (opts?: { limit?: number }) => Promise<void>;
  /** Update live market state (called from WebSocket handler) */
  setLiveMarket: (market: LiveMarket | null) => void;
  /** Update a single live price field */
  updateLivePrice: (update: Partial<LiveMarket>) => void;
}

export const useMarketStore = create<MarketState>((set, get) => ({
  markets: [],
  snapshots: [],
  outcomes: [],
  liveMarket: null,
  loading: false,
  error: null,

  fetchMarketsByDate: async (date: string) => {
    set({ loading: true, error: null });
    const dayStart = `${date}T00:00:00Z`;
    const dayEnd = `${date}T23:59:59Z`;

    const { data, error } = await supabase
      .from("markets")
      .select("*")
      .gte("start_time", dayStart)
      .lte("start_time", dayEnd)
      .order("start_time", { ascending: true });

    if (error) {
      set({ loading: false, error: error.message });
      return;
    }
    set({ markets: (data ?? []) as Market[], loading: false });
  },

  fetchSnapshots: async (marketIds: number[]) => {
    if (marketIds.length === 0) {
      set({ snapshots: [] });
      return;
    }
    set({ loading: true, error: null });

    const { data, error } = await supabase
      .from("price_snapshots")
      .select("*")
      .in("market_id", marketIds)
      .order("recorded_at", { ascending: true });

    if (error) {
      set({ loading: false, error: error.message });
      return;
    }
    set({ snapshots: (data ?? []) as PriceSnapshot[], loading: false });
  },

  fetchOutcomes: async (opts) => {
    set({ loading: true, error: null });

    let query = supabase
      .from("market_outcomes")
      .select("*")
      .order("start_time", { ascending: true });

    if (opts?.limit) {
      query = query.limit(opts.limit);
    }

    const { data, error } = await query;

    if (error) {
      set({ loading: false, error: error.message });
      return;
    }
    set({ outcomes: (data ?? []) as MarketOutcome[], loading: false });
  },

  setLiveMarket: (market) => set({ liveMarket: market }),

  updateLivePrice: (update) => {
    const current = get().liveMarket;
    if (!current) return;
    set({ liveMarket: { ...current, ...update } });
  },
}));
