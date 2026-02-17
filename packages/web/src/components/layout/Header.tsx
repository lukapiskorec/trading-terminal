import { useEffect, useState } from "react";
import * as ws from "@/lib/ws";
import type { ConnectionStatus } from "@/lib/ws";
import { cn } from "@/lib/cn";

interface HeaderProps {
  date: string; // YYYY-MM-DD
  onDateChange: (date: string) => void;
}

export function Header({ date, onDateChange }: HeaderProps) {
  const [wsStatus, setWsStatus] = useState<ConnectionStatus>(ws.getStatus());

  useEffect(() => {
    return ws.onStatus(setWsStatus);
  }, []);

  return (
    <header className="flex h-12 items-center justify-between border-b border-theme bg-surface px-4">
      <div className="text-sm text-muted">
        {formatDateLabel(date)}
      </div>
      <div className="flex items-center gap-3">
        {/* WS status indicator */}
        <div className="flex items-center gap-1.5 text-xs text-neutral-500">
          <span className={cn(
            "inline-block h-1.5 w-1.5 rounded-full",
            wsStatus === "connected" ? "bg-magenta" : wsStatus === "connecting" ? "bg-white animate-pulse" : "bg-neutral-600",
          )} />
          WS
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          className="h-8 rounded-md border border-theme bg-panel px-2 text-sm text-neutral-200 outline-none focus:border-accent"
        />
      </div>
    </header>
  );
}

function formatDateLabel(date: string): string {
  try {
    return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return date;
  }
}
