import { useEffect, useState, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import * as ws from "@/lib/ws";
import type { ConnectionStatus, PriceUpdate } from "@/lib/ws";
import { MARKET_DURATION, marketSlug } from "@/lib/constants";
import { getEventBySlug, parseTokenIds } from "@/lib/gamma";
import { useBotStore } from "@/stores/botStore";
import type { TradingBot } from "@/stores/botStore";
import { useRulesStore } from "@/stores/rulesStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { evaluateRules } from "@/lib/rulesEngine";
import type { MarketContext } from "@/lib/rulesEngine";
import { BotCard } from "@/components/trading/BotCard";
import { BotForm } from "@/components/trading/BotForm";
import { IndicatorPanel } from "@/components/dashboard/IndicatorPanel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractTimeSlot(question: string): string {
  const m = question.match(
    /(\d{1,2}:\d{2}\s*[AP]M)\s*[–\-]\s*(\d{1,2}:\d{2}\s*[AP]M\s*ET)/i,
  );
  return m ? `${m[1]}–${m[2]}` : "";
}

function fmtCountdown(sec: number): string {
  if (sec <= 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function polymarketUrl(slug: string): string {
  return `https://polymarket.com/event/${slug}`;
}

interface PendingTrade {
  botId: string;
  firedAt: number;
  outcome: "YES" | "NO";
  amount: number;
  ruleId: string;
  ruleName: string;
  marketSlug: string;
  firePrice: number; // price at fire time, used as fallback if market changed
  timeToClose: number;
}

interface PricePoint {
  ttc: number;
  yesPrice: number;
}

type MarketPhase = "live" | "ended" | "settled";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function Trade() {
  const [wsStatus, setWsStatus] = useState<ConnectionStatus>(ws.getStatus());
  const wsAutoConnect = useSettingsStore((s) => s.wsAutoConnect);

  // Market display state
  const [currentSlug, setCurrentSlug] = useState("");
  const [timeSlot, setTimeSlot] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [yesPrice, setYesPrice] = useState<number | null>(null);
  const [bestBid, setBestBid] = useState<number | null>(null);
  const [bestAsk, setBestAsk] = useState<number | null>(null);
  const [volume, setVolume] = useState(0);

  // Market phase: live → ended → settled → (next market) live
  const [marketPhase, setMarketPhase] = useState<MarketPhase>("live");
  const [settledOutcome, setSettledOutcome] = useState<string | null>(null);

  // Price chart data — reset per market
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);

  // High-frequency refs
  const yesIdRef = useRef<string | null>(null);
  const marketEndRef = useRef(0);
  const volumeRef = useRef(0);
  const currentSlugRef = useRef("");
  const yesPriceRef = useRef<number | null>(null);
  const bestBidRef = useRef<number | null>(null);
  const bestAskRef = useRef<number | null>(null);

  // Page settings
  const [latencyMs, setLatencyMs] = useState(100);
  const latencyMsRef = useRef(100);
  latencyMsRef.current = latencyMs;

  // UI state
  const [formMode, setFormMode] = useState<{ show: boolean; editBot?: TradingBot | null }>({ show: false });

  // Session AOI
  const sessionOutcomesRef = useRef<number[]>([]);

  // Pending trades queue (latency simulation)
  const pendingTradesRef = useRef<PendingTrade[]>([]);

  // Settlement polling timer
  const settlePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Store hooks
  const bots = useBotStore((s) => s.bots);
  const addBot = useBotStore((s) => s.addBot);
  const removeBot = useBotStore((s) => s.removeBot);
  const toggleBot = useBotStore((s) => s.toggleBot);
  const resetBot = useBotStore((s) => s.resetBot);
  const globalRules = useRulesStore((s) => s.rules);

  // ---------- WS lifecycle ----------

  useEffect(() => ws.onStatus(setWsStatus), []);

  useEffect(() => {
    if (wsAutoConnect && wsStatus === "disconnected") ws.connect();
  }, [wsAutoConnect, wsStatus]);

  const handleConnect = useCallback(() => {
    if (wsStatus === "connected") ws.disconnect();
    else ws.connect();
  }, [wsStatus]);

  // ---------- Gamma API settlement ----------

  const startSettlementPoll = useCallback((slugToSettle: string, lastPrice: number | null) => {
    // Clear any previous poll
    if (settlePollRef.current) clearInterval(settlePollRef.current);

    let attempts = 0;
    const poll = async () => {
      attempts++;
      try {
        const event = await getEventBySlug(slugToSettle);
        if (event && event.markets.length > 0 && event.markets[0].closed) {
          // Market confirmed closed — determine outcome
          let outcomeWon: "YES" | "NO" = "YES";
          try {
            const prices: string[] = JSON.parse(event.markets[0].outcomePrices);
            outcomeWon = parseFloat(prices[0]) > 0.5 ? "YES" : "NO";
          } catch {
            // Fallback to last price heuristic
            outcomeWon = (lastPrice ?? 0.5) > 0.5 ? "YES" : "NO";
          }

          sessionOutcomesRef.current.push(outcomeWon === "YES" ? 1 : 0);
          setSettledOutcome(outcomeWon === "YES" ? "UP" : "DOWN");
          setMarketPhase("settled");

          // Settle all bots
          const { bots: currentBots, settleBotMarket } = useBotStore.getState();
          for (const bot of currentBots) {
            if (bot.positions.some((p) => p.marketSlug === slugToSettle)) {
              settleBotMarket(bot.id, slugToSettle, outcomeWon);
            }
          }

          if (settlePollRef.current) { clearInterval(settlePollRef.current); settlePollRef.current = null; }
          return;
        }
      } catch { /* retry */ }

      // After 30 attempts (~90s) fall back to price heuristic
      if (attempts >= 30 && lastPrice !== null) {
        const outcomeWon: "YES" | "NO" = lastPrice > 0.5 ? "YES" : "NO";
        sessionOutcomesRef.current.push(outcomeWon === "YES" ? 1 : 0);
        setSettledOutcome(outcomeWon === "YES" ? "UP (est.)" : "DOWN (est.)");
        setMarketPhase("settled");

        const { bots: currentBots, settleBotMarket } = useBotStore.getState();
        for (const bot of currentBots) {
          if (bot.positions.some((p) => p.marketSlug === slugToSettle)) {
            settleBotMarket(bot.id, slugToSettle, outcomeWon);
          }
        }

        if (settlePollRef.current) { clearInterval(settlePollRef.current); settlePollRef.current = null; }
      }
    };

    // First check immediately, then every 3 seconds
    poll();
    settlePollRef.current = setInterval(poll, 3000);
  }, []);

  // Cleanup settlement poll on unmount
  useEffect(() => {
    return () => { if (settlePollRef.current) clearInterval(settlePollRef.current); };
  }, []);

  // ---------- Subscribe to current market ----------

  useEffect(() => {
    if (wsStatus !== "connected") return;

    // Immediately clear stale volume from previous market
    volumeRef.current = 0;
    setVolume(0);

    let cancelled = false;
    let resubTimer: ReturnType<typeof setTimeout> | null = null;

    async function subscribeToMarket(targetSlug: string, attempt: number) {
      if (cancelled) return;

      const event = await getEventBySlug(targetSlug);
      if (cancelled) return;

      if (!event || event.markets.length === 0) {
        // Not found — retry up to 10 times with 2s gaps
        if (attempt < 10) {
          resubTimer = setTimeout(() => subscribeToMarket(targetSlug, attempt + 1), 2000);
        }
        return;
      }

      const market = event.markets[0];
      const tokens = parseTokenIds(market);
      if (!tokens) return;

      // Extract start timestamp from slug
      const tsMatch = targetSlug.match(/(\d+)$/);
      const startTs = tsMatch ? parseInt(tsMatch[1]) : Math.floor(Date.now() / 1000);

      yesIdRef.current = tokens.yes;
      marketEndRef.current = startTs + MARKET_DURATION;
      volumeRef.current = 0;
      setVolume(0);
      setYesPrice(null);
      yesPriceRef.current = null;
      setBestBid(null);
      bestBidRef.current = null;
      setBestAsk(null);
      bestAskRef.current = null;
      setTimeSlot(extractTimeSlot(market.question));
      currentSlugRef.current = targetSlug;
      setCurrentSlug(targetSlug);
      setMarketPhase("live");
      setSettledOutcome(null);
      setPriceHistory([]);

      ws.subscribe([tokens.yes, tokens.no]);

      // Schedule transition to next market
      const msUntilEnd = (marketEndRef.current - Math.floor(Date.now() / 1000)) * 1000;
      if (msUntilEnd > 0) {
        resubTimer = setTimeout(() => {
          if (cancelled) return;
          // Market just ended
          setMarketPhase("ended");
          setSettledOutcome(null);

          const endedSlug = currentSlugRef.current;
          const lastPrice = yesPriceRef.current;

          // Clear stale state
          yesIdRef.current = null;
          yesPriceRef.current = null;
          setYesPrice(null);
          bestBidRef.current = null;
          setBestBid(null);
          bestAskRef.current = null;
          setBestAsk(null);
          volumeRef.current = 0;
          setVolume(0);
          setPriceHistory([]);

          // Start settlement polling for the ended market
          startSettlementPoll(endedSlug, lastPrice);

          // Force fresh WS connection — the subscription effect will
          // re-run when status returns to "connected" and subscribe
          // to whatever the current market is at that point.
          ws.reconnect();
        }, msUntilEnd);
      }
    }

    // Start with the current market
    const nowSec = Math.floor(Date.now() / 1000);
    const currentStartTs = Math.floor(nowSec / MARKET_DURATION) * MARKET_DURATION;
    const slug = marketSlug(currentStartTs);
    subscribeToMarket(slug, 0);

    return () => {
      cancelled = true;
      if (resubTimer) clearTimeout(resubTimer);
    };
  }, [wsStatus, startSettlementPoll]);

  // ---------- Price listener ----------

  useEffect(() => {
    return ws.onPrice((update: PriceUpdate) => {
      if (!update.assetId || update.assetId !== yesIdRef.current) return;
      if (update.price !== undefined) {
        setYesPrice(update.price);
        yesPriceRef.current = update.price;
        // Collect price point for chart
        const ttc = marketEndRef.current - Math.floor(Date.now() / 1000);
        setPriceHistory((prev) => [...prev, { ttc, yesPrice: update.price! }]);
      }
      if (update.bestBid !== undefined) {
        setBestBid(update.bestBid);
        bestBidRef.current = update.bestBid;
      }
      if (update.bestAsk !== undefined) {
        setBestAsk(update.bestAsk);
        bestAskRef.current = update.bestAsk;
      }
      if (update.size) {
        // Only accumulate volume while market is still live
        const ttc = marketEndRef.current - Math.floor(Date.now() / 1000);
        if (ttc > 0) {
          volumeRef.current += update.size;
          setVolume(volumeRef.current);
        }
      }
    });
  }, []);

  // ---------- Countdown ----------

  useEffect(() => {
    if (wsStatus !== "connected") return;
    function tick() {
      const remaining = marketEndRef.current - Math.floor(Date.now() / 1000);
      setCountdown(Math.max(0, remaining));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [wsStatus]);

  // ---------- Bot engine ----------

  useEffect(() => {
    if (wsStatus !== "connected" || yesPrice === null) return;

    const slug = currentSlugRef.current;
    if (!slug) return;

    const now = Date.now();
    const timeToClose = marketEndRef.current - Math.floor(now / 1000);
    const spread =
      bestBidRef.current !== null && bestAskRef.current !== null
        ? Math.abs(bestAskRef.current - bestBidRef.current)
        : 0;

    // Session AOI
    const aoiWindow = 12;
    const recent = sessionOutcomesRef.current.slice(-aoiWindow);
    const aoi = recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : 0.5;

    const context: MarketContext = {
      slug,
      priceYes: yesPrice,
      priceNo: 1 - yesPrice,
      spread,
      volume: volumeRef.current,
      timeToClose,
      aoi,
    };

    const { bots: currentBots, executeBotBuy, recordBotFired, markToMarket } =
      useBotStore.getState();
    const allRules = useRulesStore.getState().rules;
    const latency = latencyMsRef.current;

    // 1. Process ALL pending trades (latency simulation — always fill)
    const stillPending: PendingTrade[] = [];
    for (const pt of pendingTradesRef.current) {
      if (now - pt.firedAt >= latency) {
        // Fill at current price if same market, else use fire price
        const price = pt.marketSlug === slug
          ? (pt.outcome === "YES" ? yesPrice : 1 - yesPrice)
          : pt.firePrice;
        executeBotBuy(pt.botId, {
          marketSlug: pt.marketSlug,
          outcome: pt.outcome,
          price,
          amount: pt.amount,
          ruleId: pt.ruleId,
          ruleName: pt.ruleName,
          timeToClose: pt.timeToClose,
        });
      } else {
        stillPending.push(pt);
      }
    }
    pendingTradesRef.current = stillPending;

    // 2. Evaluate rules for each enabled bot
    for (const bot of currentBots) {
      if (!bot.enabled) continue;

      // EXCLUSIVE mode: check global block
      const exclusiveBlock = bot.lastFired["__exclusive_block__"] ?? 0;
      if (bot.ruleMode === "EXCLUSIVE" && now < exclusiveBlock) {
        // Still blocked — only mark-to-market
        markToMarket(bot.id, slug, yesPrice);
        continue;
      }

      const mainRules = allRules.filter((r) => bot.ruleIds.includes(r.id));
      const lastFiredMap = new Map<string, number>(Object.entries(bot.lastFired));
      const matches = evaluateRules(mainRules, context, lastFiredMap);

      for (const match of matches) {
        recordBotFired(bot.id, match.rule.id, now);
        if (bot.ruleMode === "EXCLUSIVE") {
          recordBotFired(bot.id, "__exclusive_block__", now + match.rule.cooldown * 1000);
        }
        enqueueTrade(bot, match.resolvedOutcome, match.rule.action.amount, match.rule.id, match.rule.name, slug, yesPrice, timeToClose, latency, now);
      }

      // Fallback rule
      if (matches.length === 0 && bot.fallbackRuleId) {
        const fbRule = allRules.find((r) => r.id === bot.fallbackRuleId);
        if (fbRule && timeToClose <= bot.fallbackTriggerTTC) {
          const fbLast = bot.lastFired[bot.fallbackRuleId] ?? 0;
          if (now - fbLast >= fbRule.cooldown * 1000) {
            recordBotFired(bot.id, bot.fallbackRuleId, now);
            if (bot.ruleMode === "EXCLUSIVE") {
              recordBotFired(bot.id, "__exclusive_block__", now + fbRule.cooldown * 1000);
            }
            // Determine outcome
            let outcome: "YES" | "NO";
            if (fbRule.randomConfig) {
              outcome = Math.random() < fbRule.randomConfig.upRatio ? "YES" : "NO";
            } else {
              outcome = fbRule.action.outcome;
            }
            enqueueTrade(bot, outcome, fbRule.action.amount, fbRule.id, fbRule.name + " (FB)", slug, yesPrice, timeToClose, latency, now);
          }
        }
      }

      markToMarket(bot.id, slug, yesPrice);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yesPrice, wsStatus]);

  /** Queue or immediately execute a bot trade */
  function enqueueTrade(
    bot: TradingBot, outcome: "YES" | "NO", amount: number,
    ruleId: string, ruleName: string, slug: string, currentYesPrice: number,
    timeToClose: number, latency: number, now: number,
  ) {
    const price = outcome === "YES" ? currentYesPrice : 1 - currentYesPrice;
    if (latency > 0) {
      pendingTradesRef.current.push({
        botId: bot.id, firedAt: now, outcome, amount, ruleId, ruleName,
        marketSlug: slug, firePrice: price, timeToClose,
      });
    } else {
      useBotStore.getState().executeBotBuy(bot.id, {
        marketSlug: slug, outcome, price, amount, ruleId, ruleName, timeToClose,
      });
    }
  }

  // ---------- Bot creation/edit ----------

  const handleAddBot = useCallback(
    (p: Parameters<typeof addBot>[0]) => { addBot(p); setFormMode({ show: false }); },
    [addBot],
  );

  // ---------- Derived ----------

  const noPrice = yesPrice !== null ? 1 - yesPrice : null;
  const distance = yesPrice !== null ? yesPrice - 0.5 : null;
  const currentUrl = currentSlug ? polymarketUrl(currentSlug) : "#";

  // ---------- Render ----------

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center flex-wrap gap-x-4 gap-y-2 border-b border-theme pb-3">
        <a
          href={currentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-300 transition-colors"
        >
          BTC 5-min Up/Down ↗
        </a>

        <Button variant="outline" size="sm" onClick={handleConnect}>
          <span className={cn(
            "inline-block h-2 w-2 rounded-full mr-2",
            wsStatus === "connected" ? "bg-magenta" : wsStatus === "connecting" ? "bg-white animate-pulse" : "bg-neutral-600",
          )} />
          {wsStatus === "connected" ? "Disconnect" : wsStatus === "connecting" ? "Connecting..." : "Connect WS"}
        </Button>

        <div className="flex items-center gap-1.5">
          <label className="text-[10px] text-neutral-500 uppercase tracking-wider">Latency</label>
          <input
            type="number"
            value={latencyMs}
            onChange={(e) => setLatencyMs(Math.max(0, parseInt(e.target.value) || 0))}
            min="0"
            step="50"
            className="w-16 border border-theme bg-panel px-1.5 py-0.5 text-xs text-neutral-200 outline-none focus:border-accent font-mono"
          />
          <span className="text-[10px] text-neutral-500">ms</span>
        </div>

        {/* Market phase badge */}
        {marketPhase === "ended" && (
          <span className="text-[10px] font-semibold text-yellow-400 animate-pulse px-2 py-0.5 rounded bg-yellow-400/10">
            ENDED — settling...
          </span>
        )}
        {marketPhase === "settled" && settledOutcome && (
          <span className={cn(
            "text-[10px] font-semibold px-2 py-0.5 rounded",
            settledOutcome.includes("UP") ? "text-magenta bg-magenta/10" : "text-accent bg-accent/10",
          )}>
            SETTLED: {settledOutcome}
          </span>
        )}
      </div>

      {/* BTC Indicators (compact, above live data) */}
      <IndicatorPanel compact />

      {/* Live market ticker */}
      {wsStatus === "connected" && (
        <Card>
          <CardContent className="py-3">
            <div className="grid grid-cols-3 gap-4 sm:grid-cols-7 text-center">
              <Cell label="Market" value={timeSlot || "..."} />
              <Cell
                label="Countdown"
                value={fmtCountdown(countdown)}
                className={countdown <= 30 ? "text-yellow-400" : "text-neutral-100"}
              />
              <Cell label="UP (YES)" value={yesPrice !== null ? `$${yesPrice.toFixed(3)}` : "-"} className="text-magenta" />
              <Cell label="DOWN (NO)" value={noPrice !== null ? `$${noPrice.toFixed(3)}` : "-"} className="text-accent" />
              <Cell
                label="Bid / Ask"
                value={bestBid !== null && bestAsk !== null ? `${bestBid.toFixed(3)} / ${bestAsk.toFixed(3)}` : "-"}
              />
              <Cell label="Volume" value={volume > 0 ? `$${Math.round(volume).toLocaleString()}` : "-"} />
              <Cell
                label="Dist $0.50"
                value={distance !== null ? `${distance >= 0 ? "↑" : "↓"} ${distance >= 0 ? "+" : ""}$${Math.abs(distance).toFixed(3)}` : "-"}
                className={distance !== null ? (distance >= 0 ? "text-magenta" : "text-accent") : undefined}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Share price chart */}
      {wsStatus === "connected" && priceHistory.length >= 2 && (
        <PriceChart data={priceHistory} />
      )}

      {/* Bot form or new-bot button */}
      {formMode.show ? (
        <BotForm
          editBot={formMode.editBot}
          onDone={() => setFormMode({ show: false })}
        />
      ) : (
        <Button variant="outline" size="sm" onClick={() => setFormMode({ show: true, editBot: null })}>
          + New Bot
        </Button>
      )}

      {/* Bot cards */}
      {bots.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {bots.map((bot) => (
            <BotCard
              key={bot.id}
              bot={bot}
              globalRules={globalRules}
              wsConnected={wsStatus === "connected"}
              hasPrice={yesPrice !== null}
              onToggle={() => toggleBot(bot.id)}
              onReset={() => resetBot(bot.id)}
              onRemove={() => removeBot(bot.id)}
              onEdit={() => setFormMode({ show: true, editBot: bot })}
            />
          ))}
        </div>
      ) : (
        !formMode.show && (
          <div className="text-center py-12">
            <p className="text-sm text-neutral-500">No trading bots created yet</p>
            <p className="text-xs text-neutral-600 mt-1">
              Create a bot and assign trading rules to start live simulation
            </p>
          </div>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Cell({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <div className="text-[10px] text-neutral-500 uppercase tracking-wider">{label}</div>
      <div className={cn("text-sm font-mono font-semibold", className ?? "text-neutral-100")}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Share price chart — canvas-based, matches PriceOverlay styling
// ---------------------------------------------------------------------------

const PCHART_PAD = { top: 20, right: 40, bottom: 30, left: 50 };

interface PriceChartHover {
  x: number;
  y: number;
  ttc: number;
  yesPrice: number;
  noPrice: number;
  yesY: number;
  noY: number;
  containerWidth: number;
}

function PriceChart({ data }: { data: PricePoint[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sortedRef = useRef<PricePoint[]>([]);
  const [resizeCount, setResizeCount] = useState(0);
  const [hoverInfo, setHoverInfo] = useState<PriceChartHover | null>(null);

  // Sort by TTC descending (high TTC = left, low TTC = right)
  const sorted = [...data].sort((a, b) => b.ttc - a.ttc);
  sortedRef.current = sorted;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || sorted.length < 2) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";

    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const plotW = w - PCHART_PAD.left - PCHART_PAD.right;
    const plotH = h - PCHART_PAD.top - PCHART_PAD.bottom;

    ctx.clearRect(0, 0, w, h);

    // Fixed Y scale 0→1 (same as PriceOverlay)
    const xScale = (ttc: number) => PCHART_PAD.left + ((MARKET_DURATION - ttc) / MARKET_DURATION) * plotW;
    const yScale = (price: number) => PCHART_PAD.top + (1 - price) * plotH;

    // Grid lines at 0.25 increments
    ctx.strokeStyle = "#1a0f22";
    ctx.lineWidth = 0.5;
    for (let p = 0; p <= 1; p += 0.25) {
      const y = yScale(p);
      ctx.beginPath();
      ctx.moveTo(PCHART_PAD.left, y);
      ctx.lineTo(w - PCHART_PAD.right, y);
      ctx.stroke();
    }

    // Dashed $0.50 reference line
    ctx.strokeStyle = "#525252";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(PCHART_PAD.left, yScale(0.5));
    ctx.lineTo(w - PCHART_PAD.right, yScale(0.5));
    ctx.stroke();
    ctx.setLineDash([]);

    // UP (YES) line — magenta
    ctx.strokeStyle = "#ff1ad9";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    sorted.forEach((pt, i) => {
      const x = xScale(pt.ttc);
      const y = yScale(pt.yesPrice);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // DOWN (NO) line — cyan
    ctx.strokeStyle = "#00f0ff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    sorted.forEach((pt, i) => {
      const x = xScale(pt.ttc);
      const y = yScale(1 - pt.yesPrice);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Y-axis labels at 0.25 increments
    ctx.fillStyle = "#a3a3a3";
    ctx.font = "11px monospace";
    ctx.textAlign = "right";
    for (let p = 0; p <= 1; p += 0.25) {
      ctx.fillText(p.toFixed(2), PCHART_PAD.left - 6, yScale(p) + 4);
    }

    // X-axis labels — TTC at 60s intervals
    ctx.textAlign = "center";
    for (let s = 0; s <= MARKET_DURATION; s += 60) {
      const ttc = MARKET_DURATION - s;
      ctx.fillText(`${ttc}s`, xScale(ttc), h - 8);
    }

    // Legend
    ctx.font = "11px sans-serif";
    ctx.textAlign = "left";
    const legendY = 14;
    ctx.fillStyle = "#ff1ad9";
    ctx.fillText("\u25A0", PCHART_PAD.left, legendY);
    ctx.fillStyle = "#a3a3a3";
    ctx.fillText(" Up", PCHART_PAD.left + 10, legendY);
    ctx.fillStyle = "#00f0ff";
    ctx.fillText("\u25A0", PCHART_PAD.left + 38, legendY);
    ctx.fillStyle = "#a3a3a3";
    ctx.fillText(" Down", PCHART_PAD.left + 48, legendY);
  }, [data, resizeCount]);

  // ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => setResizeCount((c) => c + 1));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    const pts = sortedRef.current;
    if (!container || pts.length === 0) return;

    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const plotW = rect.width - PCHART_PAD.left - PCHART_PAD.right;

    if (mouseX < PCHART_PAD.left || mouseX > rect.width - PCHART_PAD.right) {
      setHoverInfo(null);
      return;
    }

    // Convert pixel to TTC
    const fraction = (mouseX - PCHART_PAD.left) / plotW;
    const ttcAtCursor = MARKET_DURATION - fraction * MARKET_DURATION;

    // Find nearest data point
    let nearest = pts[0];
    let minDist = Math.abs(pts[0].ttc - ttcAtCursor);
    for (const pt of pts) {
      const d = Math.abs(pt.ttc - ttcAtCursor);
      if (d < minDist) { minDist = d; nearest = pt; }
    }

    // Compute Y positions for hover dots (same yScale as canvas: 0→1 fixed)
    const plotH = rect.height - PCHART_PAD.top - PCHART_PAD.bottom;
    const yesY = PCHART_PAD.top + (1 - nearest.yesPrice) * plotH;
    const noY = PCHART_PAD.top + nearest.yesPrice * plotH; // 1 - (1 - yesPrice) = yesPrice

    setHoverInfo({
      x: mouseX,
      y: mouseY,
      ttc: Math.max(0, nearest.ttc),
      yesPrice: nearest.yesPrice,
      noPrice: 1 - nearest.yesPrice,
      yesY,
      noY,
      containerWidth: rect.width,
    });
  };

  return (
    <Card>
      <CardContent className="py-2 px-3">
        <div className="text-[11px] text-neutral-500 mb-1">Share Prices — Current Market</div>
        <div
          ref={containerRef}
          className="h-52 w-full relative"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverInfo(null)}
        >
          <canvas ref={canvasRef} className="h-full w-full" />

          {/* SVG overlay for hover crosshair + dots */}
          {hoverInfo && (
            <svg
              className="absolute inset-0 pointer-events-none"
              style={{ width: "100%", height: "100%" }}
            >
              <line
                x1={hoverInfo.x}
                y1={PCHART_PAD.top}
                x2={hoverInfo.x}
                y2={`calc(100% - ${PCHART_PAD.bottom}px)`}
                stroke="rgba(255,255,255,0.25)"
                strokeWidth={1}
              />
              <circle cx={hoverInfo.x} cy={hoverInfo.yesY} r={4} fill="#ff1ad9" />
              <circle cx={hoverInfo.x} cy={hoverInfo.noY} r={4} fill="#00f0ff" />
            </svg>
          )}

          {/* Hover tooltip */}
          {hoverInfo && (
            <div
              className="absolute pointer-events-none z-10 bg-panel border border-theme px-2 py-1 text-xs font-mono shadow-lg"
              style={{
                left: hoverInfo.x > hoverInfo.containerWidth / 2
                  ? hoverInfo.x - 8
                  : hoverInfo.x + 8,
                top: hoverInfo.y,
                transform: hoverInfo.x > hoverInfo.containerWidth / 2
                  ? "translate(-100%, -50%)"
                  : "translate(0, -50%)",
              }}
            >
              <div className="text-magenta">{hoverInfo.yesPrice.toFixed(3)}</div>
              <div className="text-accent">{hoverInfo.noPrice.toFixed(3)}</div>
              <div className="text-neutral-600" style={{ fontSize: 9 }}>
                {hoverInfo.ttc}s to close
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
