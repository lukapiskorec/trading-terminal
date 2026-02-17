import { useEffect, useState, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import * as ws from "@/lib/ws";
import type { ConnectionStatus, PriceUpdate } from "@/lib/ws";
import { MARKET_DURATION, marketSlug } from "@/lib/constants";
import { getEventBySlug, parseTokenIds } from "@/lib/gamma";

/** Extract time range from Gamma question string, e.g. "4:25PM–4:30PM ET" */
function extractTimeSlot(question: string): string {
  // Matches patterns like "4:25PM–4:30PM ET" or "4:25 PM - 4:30 PM ET"
  const m = question.match(
    /(\d{1,2}:\d{2}\s*[AP]M)\s*[–\-]\s*(\d{1,2}:\d{2}\s*[AP]M\s*ET)/i,
  );
  return m ? `${m[1]}–${m[2]}` : "";
}

/** Format seconds as M:SS countdown */
function fmtCountdown(sec: number): string {
  if (sec <= 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function LiveMarketPanel() {
  const [wsStatus, setWsStatus] = useState<ConnectionStatus>(ws.getStatus());
  const [timeSlot, setTimeSlot] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [yesPrice, setYesPrice] = useState<number | null>(null);
  const [bestBid, setBestBid] = useState<number | null>(null);
  const [bestAsk, setBestAsk] = useState<number | null>(null);
  const [volume, setVolume] = useState(0);

  const yesIdRef = useRef<string | null>(null);
  const marketEndRef = useRef(0);
  const volumeRef = useRef(0);

  // Track WS connection status
  useEffect(() => ws.onStatus(setWsStatus), []);

  // Subscribe to current market on connect
  useEffect(() => {
    if (wsStatus !== "connected") return;

    let cancelled = false;
    let resubTimer: ReturnType<typeof setTimeout> | null = null;

    async function subscribeToCurrentMarket() {
      const nowSec = Math.floor(Date.now() / 1000);
      const currentStartTs = Math.floor(nowSec / MARKET_DURATION) * MARKET_DURATION;
      const slug = marketSlug(currentStartTs);

      const event = await getEventBySlug(slug);
      if (cancelled) return;

      if (event && event.markets.length > 0) {
        const market = event.markets[0];
        const tokens = parseTokenIds(market);
        if (tokens) {
          yesIdRef.current = tokens.yes;
          marketEndRef.current = currentStartTs + MARKET_DURATION;
          volumeRef.current = 0;
          setVolume(0);
          setYesPrice(null);
          setBestBid(null);
          setBestAsk(null);

          // Extract time slot from question
          setTimeSlot(extractTimeSlot(market.question));

          ws.subscribe([tokens.yes, tokens.no]);

          // Schedule re-subscribe when this market ends
          const msUntilEnd =
            (marketEndRef.current - Math.floor(Date.now() / 1000)) * 1000 + 2000;
          if (msUntilEnd > 0) {
            resubTimer = setTimeout(() => {
              if (!cancelled) subscribeToCurrentMarket();
            }, msUntilEnd);
          }
          return;
        }
      }
      console.warn("[LiveMarket] Could not find current market:", slug);
    }

    subscribeToCurrentMarket();

    return () => {
      cancelled = true;
      if (resubTimer) clearTimeout(resubTimer);
      ws.unsubscribe();
    };
  }, [wsStatus]);

  // Listen for smoothed price updates
  useEffect(() => {
    return ws.onPrice((update: PriceUpdate) => {
      if (!update.assetId || update.assetId !== yesIdRef.current) return;
      if (update.price !== undefined) setYesPrice(update.price);
      if (update.bestBid !== undefined) setBestBid(update.bestBid);
      if (update.bestAsk !== undefined) setBestAsk(update.bestAsk);
      if (update.size) {
        volumeRef.current += update.size;
        setVolume(volumeRef.current);
      }
    });
  }, []);

  // Countdown timer
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

  if (wsStatus !== "connected") return null;

  const noPrice = yesPrice !== null ? 1 - yesPrice : null;
  const distance = yesPrice !== null ? yesPrice - 0.5 : null;

  return (
    <Card>
      <CardContent className="py-3">
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-7 text-center">
          {/* Time slot */}
          <Cell label="Market" value={timeSlot || "..."} />

          {/* Countdown */}
          <Cell
            label="Countdown"
            value={fmtCountdown(countdown)}
            className={countdown <= 30 ? "text-yellow-400" : "text-neutral-100"}
          />

          {/* UP (YES) price */}
          <Cell
            label="UP (YES)"
            value={yesPrice !== null ? `$${yesPrice.toFixed(3)}` : "-"}
            className="text-magenta"
          />

          {/* DOWN (NO) price */}
          <Cell
            label="DOWN (NO)"
            value={noPrice !== null ? `$${noPrice.toFixed(3)}` : "-"}
            className="text-accent"
          />

          {/* Bid / Ask */}
          <Cell
            label="Bid / Ask"
            value={
              bestBid !== null && bestAsk !== null
                ? `${bestBid.toFixed(3)} / ${bestAsk.toFixed(3)}`
                : "-"
            }
          />

          {/* Volume */}
          <Cell
            label="Volume"
            value={volume > 0 ? `$${Math.round(volume).toLocaleString()}` : "-"}
          />

          {/* Distance from $0.50 */}
          <Cell
            label="Dist $0.50"
            value={
              distance !== null
                ? `${distance >= 0 ? "↑" : "↓"} ${distance >= 0 ? "+" : ""}$${Math.abs(distance).toFixed(3)}`
                : "-"
            }
            className={
              distance !== null
                ? distance >= 0
                  ? "text-magenta"
                  : "text-accent"
                : undefined
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}

function Cell({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <div className="text-[10px] text-neutral-500 uppercase tracking-wider">
        {label}
      </div>
      <div
        className={cn(
          "text-sm font-mono font-semibold",
          className ?? "text-neutral-100",
        )}
      >
        {value}
      </div>
    </div>
  );
}
