import { create } from "zustand";
import * as binance from "@/lib/binanceWs";
import type { BinanceStatus } from "@/lib/binanceWs";
import {
  computeOBI,
  computeCVD,
  computeRSI,
  computeMACD,
  computeEMACross,
  computeVWAP,
  computeHeikinAshi,
  computePOC,
  computeWalls,
  computeBBands,
  computeFlowToxicity,
  computeROC,
  computeBias,
} from "@/lib/indicators";
import type { Signal, IndicatorResult } from "@/lib/indicators";

interface Indicators {
  obi: IndicatorResult | null;
  cvd: IndicatorResult | null;
  rsi: IndicatorResult | null;
  macd: IndicatorResult | null;
  emaCross: IndicatorResult | null;
  vwap: IndicatorResult | null;
  heikinAshi: IndicatorResult | null;
  poc: IndicatorResult | null;
  walls: IndicatorResult | null;
  bbands: IndicatorResult | null;
  flowToxicity: IndicatorResult | null;
  roc: IndicatorResult | null;
}

interface IndicatorState {
  status: BinanceStatus;
  mid: number | null;
  indicators: Indicators;
  bias: { score: number; signal: Signal } | null;
  connect: () => void;
  disconnect: () => void;
}

const emptyIndicators: Indicators = {
  obi: null,
  cvd: null,
  rsi: null,
  macd: null,
  emaCross: null,
  vwap: null,
  heikinAshi: null,
  poc: null,
  walls: null,
  bbands: null,
  flowToxicity: null,
  roc: null,
};

let recalcTimer: ReturnType<typeof setInterval> | null = null;
let unsubStatus: (() => void) | null = null;

export const useIndicatorStore = create<IndicatorState>((set) => ({
  status: "disconnected",
  mid: null,
  indicators: { ...emptyIndicators },
  bias: null,

  connect: () => {
    binance.connect();

    // Status listener
    unsubStatus?.();
    unsubStatus = binance.onStatus((s) => set({ status: s }));
    set({ status: binance.getStatus() });

    // Start recalc tick every 2s
    if (recalcTimer) clearInterval(recalcTimer);
    recalcTimer = setInterval(() => recalc(set), 2_000);
  },

  disconnect: () => {
    binance.disconnect();
    if (recalcTimer) { clearInterval(recalcTimer); recalcTimer = null; }
    unsubStatus?.();
    unsubStatus = null;
    set({ status: "disconnected", indicators: { ...emptyIndicators }, bias: null, mid: null });
  },
}));

function recalc(set: (partial: Partial<IndicatorState>) => void) {
  const { bids, asks, mid, trades, klines } = binance.getState();

  if (mid === null || klines.length === 0) return;

  const obi = computeOBI(bids, asks, mid);
  const cvd = computeCVD(trades);
  const rsi = computeRSI(klines);
  const macd = computeMACD(klines);
  const emaCross = computeEMACross(klines);
  const vwap = computeVWAP(klines, mid);
  const heikinAshi = computeHeikinAshi(klines);
  const poc = computePOC(klines, mid);
  const walls = computeWalls(bids, asks);
  const bbands = computeBBands(klines, mid);
  const flowToxicity = computeFlowToxicity(trades);
  const roc = computeROC(klines);

  const bias = computeBias({ obi, cvd, rsi, macd, emaCross, vwap, heikinAshi, poc, walls, bbands, flowToxicity, roc });

  set({
    mid,
    indicators: { obi, cvd, rsi, macd, emaCross, vwap, heikinAshi, poc, walls, bbands, flowToxicity, roc },
    bias,
  });
}
