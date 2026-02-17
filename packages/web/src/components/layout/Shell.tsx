import { Outlet, useOutletContext } from "react-router-dom";
import { useState } from "react";
import { TopNav } from "./TopNav";
import { Header } from "./Header";

/** Default to Feb 13, 2026 — the date we have historical data for */
const DEFAULT_DATE = "2026-02-13";

export interface ShellContext {
  date: string;
}

export function Shell() {
  const [date, setDate] = useState(DEFAULT_DATE);

  return (
    <div className="flex h-screen flex-col bg-surface text-neutral-100">
      <TopNav />
      <Header date={date} onDateChange={setDate} />
      <main className="flex-1 overflow-y-auto p-4">
        <Outlet context={{ date } satisfies ShellContext} />
      </main>
    </div>
  );
}

/** Hook for child routes to access the selected date */
export function useShellContext() {
  return useOutletContext<ShellContext>();
}
