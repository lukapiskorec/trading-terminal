import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import * as ws from "@/lib/ws";
import type { ConnectionStatus } from "@/lib/ws";
import { cn } from "@/lib/cn";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: "◫" },
  { to: "/analytics", label: "Analytics", icon: "◰" },
  { to: "/trade", label: "Trade", icon: "⇄" },
  { to: "/rules", label: "Rules", icon: "⚙" },
  { to: "/backtest", label: "Backtest", icon: "▶" },
  { to: "/settings", label: "Settings", icon: "☰" },
] as const;

export function TopNav() {
  const [wsStatus, setWsStatus] = useState<ConnectionStatus>(ws.getStatus());

  useEffect(() => {
    return ws.onStatus(setWsStatus);
  }, []);

  return (
    <nav className="relative flex h-10 items-center justify-center border-b border-theme bg-surface px-4">
      <div className="flex items-center gap-1">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-1.5 px-2.5 py-1 text-xs transition-colors",
                isActive
                  ? "bg-panel text-accent font-medium"
                  : "text-muted hover:bg-panel/50 hover:text-neutral-200",
              )
            }
          >
            <span className="text-sm leading-none">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </div>

      {/* WS status — absolute so it doesn't affect nav centering */}
      <div className="absolute right-4 flex items-center gap-1.5 text-xs text-neutral-600">
        <span
          className={cn(
            "inline-block h-1.5 w-1.5 rounded-full",
            wsStatus === "connected"
              ? "bg-magenta"
              : wsStatus === "connecting"
              ? "bg-white animate-pulse"
              : "bg-neutral-700",
          )}
        />
        WS
      </div>
    </nav>
  );
}
