import { NavLink } from "react-router-dom";
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
  return (
    <nav className="flex h-10 items-center border-b border-theme bg-surface px-4">
      <h1 className="mr-6 text-sm font-bold tracking-wider text-magenta uppercase">Trading Terminal</h1>
      <div className="flex items-center gap-1">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors",
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
      <div className="ml-auto text-xs text-muted">BTC 5m Up/Down</div>
    </nav>
  );
}
