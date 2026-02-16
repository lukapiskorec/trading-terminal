import { NavLink } from "react-router-dom";
import { cn } from "@/lib/cn";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: "◫" },
  { to: "/analytics", label: "Analytics", icon: "◰" },
  { to: "/trade", label: "Trade", icon: "⇄" },
  { to: "/rules", label: "Rules", icon: "⚙" },
  { to: "/backtest", label: "Backtest", icon: "▶" },
] as const;

export function Sidebar() {
  return (
    <aside className="flex h-full w-48 flex-col border-r border-neutral-800 bg-neutral-950 px-2 py-4">
      <div className="mb-6 px-3">
        <h1 className="text-sm font-bold tracking-wider text-neutral-100 uppercase">Trading Terminal</h1>
      </div>
      <nav className="flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-neutral-800 text-neutral-100 font-medium"
                  : "text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200",
              )
            }
          >
            <span className="text-base leading-none">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="px-3 text-xs text-neutral-600">BTC 5m Up/Down</div>
    </aside>
  );
}
