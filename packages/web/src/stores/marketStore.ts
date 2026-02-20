import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import type { Market, PriceSnapshot, MarketOutcome, LiveMarket, BtcIndicatorSnapshot } from "@/types/market";

interface MarketState {
  /** Historical markets loaded from Supabase */
  markets: Market[];
  /** Price snapshots for the currently selected date/range */
  snapshots: PriceSnapshot[];
  /** Outcome data for AOI calculations */
  outcomes: MarketOutcome[];
  /** Currently active live market (from WebSocket) */
  liveMarket: LiveMarket | null;
  /** BTC indicator snapshots for the selected date */
  btcIndicators: BtcIndicatorSnapshot[];

  loading: boolean;
  error: string | null;

  /** Fetch all markets for a given date (UTC) */
  fetchMarketsByDate: (date: string) => Promise<void>;
  /** Fetch price snapshots for a set of market IDs, scoped to a single UTC date */
  fetchSnapshots: (marketIds: number[], date: string) => Promise<void>;
  /** Fetch resolved outcomes for AOI calculations, scoped to a single UTC date */
  fetchOutcomes: (opts?: { limit?: number; date?: string }) => Promise<void>;
  /** Fetch BTC indicator snapshots for a single UTC date */
  fetchBtcIndicators: (date: string) => Promise<void>;
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
  btcIndicators: [],
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

  fetchSnapshots: async (marketIds: number[], date: string) => {
    if (marketIds.length === 0) {
      set({ snapshots: [] });
      return;
    }
    set({ loading: true, error: null });

    const PAGE_SIZE = 1000;
    const BATCH_SIZE = 10; // max parallel page requests per batch
    const dayStart = `${date}T00:00:00Z`;
    const dayEnd = `${date}T23:59:59Z`;

    // Fetch page 0 + total count in a single GET — avoids a separate HEAD request
    // which some browsers strip custom headers (apikey) from in CORS scenarios
    const { data: firstPage, count, error: firstError } = await supabase
      .from("price_snapshots")
      .select("*", { count: "exact" })
      .in("market_id", marketIds)
      .gte("recorded_at", dayStart)
      .lte("recorded_at", dayEnd)
      .order("recorded_at", { ascending: true })
      .range(0, PAGE_SIZE - 1);

    if (firstError) {
      set({ loading: false, error: firstError.message });
      return;
    }

    const allSnapshots: PriceSnapshot[] = [...((firstPage ?? []) as PriceSnapshot[])];
    const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE);

    // Fetch remaining pages in batches to avoid overwhelming Supabase
    for (let batchStart = 1; batchStart < totalPages; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, totalPages);
      const batchResults = await Promise.all(
        Array.from({ length: batchEnd - batchStart }, (_, j) => {
          const page = batchStart + j;
          return supabase
            .from("price_snapshots")
            .select("*")
            .in("market_id", marketIds)
            .gte("recorded_at", dayStart)
            .lte("recorded_at", dayEnd)
            .order("recorded_at", { ascending: true })
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
        })
      );

      for (const { data, error } of batchResults) {
        if (error) {
          set({ loading: false, error: error.message });
          return;
        }
        allSnapshots.push(...((data ?? []) as PriceSnapshot[]));
      }
    }

    set({ snapshots: allSnapshots, loading: false });
  },

  fetchOutcomes: async (opts) => {
    set({ loading: true, error: null });

    let query = supabase
      .from("market_outcomes")
      .select("*")
      .order("start_time", { ascending: true });

    if (opts?.date) {
      query = query
        .gte("start_time", `${opts.date}T00:00:00Z`)
        .lte("start_time", `${opts.date}T23:59:59Z`);
    }

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

  fetchBtcIndicators: async (date: string) => {
    set({ loading: true, error: null });

    const PAGE_SIZE = 1000;
    const BATCH_SIZE = 10;
    const dayStart = `${date}T00:00:00Z`;
    const dayEnd = `${date}T23:59:59Z`;

    const { data: firstPage, count, error: firstError } = await supabase
      .from("btc_indicator_snapshots")
      .select("*", { count: "exact" })
      .gte("recorded_at", dayStart)
      .lte("recorded_at", dayEnd)
      .order("recorded_at", { ascending: true })
      .range(0, PAGE_SIZE - 1);

    if (firstError) {
      set({ loading: false, error: firstError.message });
      return;
    }

    const allRows: BtcIndicatorSnapshot[] = [...((firstPage ?? []) as BtcIndicatorSnapshot[])];
    const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE);

    for (let batchStart = 1; batchStart < totalPages; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, totalPages);
      const batchResults = await Promise.all(
        Array.from({ length: batchEnd - batchStart }, (_, j) => {
          const page = batchStart + j;
          return supabase
            .from("btc_indicator_snapshots")
            .select("*")
            .gte("recorded_at", dayStart)
            .lte("recorded_at", dayEnd)
            .order("recorded_at", { ascending: true })
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
        })
      );

      for (const { data, error } of batchResults) {
        if (error) {
          set({ loading: false, error: error.message });
          return;
        }
        allRows.push(...((data ?? []) as BtcIndicatorSnapshot[]));
      }
    }

    set({ btcIndicators: allRows, loading: false });
  },

  setLiveMarket: (market) => set({ liveMarket: market }),

  updateLivePrice: (update) => {
    const current = get().liveMarket;
    if (!current) return;
    set({ liveMarket: { ...current, ...update } });
  },
}));
