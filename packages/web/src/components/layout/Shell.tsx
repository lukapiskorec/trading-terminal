import { Outlet, useOutletContext } from "react-router-dom";
import { useState } from "react";
import { TopNav } from "./TopNav";

const DEFAULT_DATE = "2026-02-13";

export interface ShellContext {
  date: string;
  setDate: (date: string) => void;
}

const ASCII_BANNER = `████████╗██████╗  █████╗ ██████╗ ██╗███╗   ██╗ ██████╗     ████████╗███████╗██████╗ ███╗   ███╗██╗███╗   ██╗ █████╗ ██╗
╚══██╔══╝██╔══██╗██╔══██╗██╔══██╗██║████╗  ██║██╔════╝     ╚══██╔══╝██╔════╝██╔══██╗████╗ ████║██║████╗  ██║██╔══██╗██║
   ██║   ██████╔╝███████║██║  ██║██║██╔██╗ ██║██║  ███╗       ██║   █████╗  ██████╔╝██╔████╔██║██║██╔██╗ ██║███████║██║
   ██║   ██╔══██╗██╔══██║██║  ██║██║██║╚██╗██║██║   ██║       ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║██║██║╚██╗██║██╔══██║██║
   ██║   ██║  ██║██║  ██║██████╔╝██║██║ ╚████║╚██████╔╝       ██║   ███████╗██║  ██║██║ ╚═╝ ██║██║██║ ╚████║██║  ██║███████╗
   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚═╝╚═╝  ╚═══╝ ╚═════╝        ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚══════╝`;

export function Shell() {
  const [date, setDate] = useState(DEFAULT_DATE);

  return (
    <div className="flex h-screen flex-col bg-surface text-neutral-100">
      {/* ASCII art banner — centered with top/bottom buffer */}
      <div className="flex justify-center border-b border-theme bg-surface py-3 overflow-x-hidden">
        <pre
          className="text-magenta select-none leading-none"
          style={{ fontSize: 8, fontFamily: "monospace", whiteSpace: "pre" }}
        >
          {ASCII_BANNER}
        </pre>
      </div>

      <TopNav />

      <main className="flex-1 overflow-y-auto p-4">
        <Outlet context={{ date, setDate } satisfies ShellContext} />
      </main>

      {/* Footer */}
      <footer className="flex-shrink-0 border-t border-theme bg-surface px-6 py-1.5 text-center">
        <p className="text-neutral-700" style={{ fontSize: 10 }}>
          © 2026{" "}
          <span className="text-neutral-500">{"{protocell:labs}"}</span>
          {" · "}AI-assisted by{" "}
          <span className="text-neutral-500">Claude (Anthropic)</span>
          {" · "}For research &amp; educational purposes only
          {" · "}Not financial advice
          {" · "}Past performance does not predict future results
        </p>
      </footer>
    </div>
  );
}

export function useShellContext() {
  return useOutletContext<ShellContext>();
}
