# TODO — Deferred Concerns


## Phase 4: Analytics Dashboard
- [ ] `packages/web/.env` must be configured with Supabase publishable key for Analytics page to load data
- [ ] 608KB JS bundle (mostly lightweight-charts ~200KB) — can code-split with dynamic imports later
- [ ] apply chart and app styling from this app (dark background, magenta text, cyan and green highlights...) - https://github.com/lukapiskorec/strategy-utils



## Phase 5: Trading Simulator
- [ ] Market settlement is manual ("Settle All Resolved" button) — auto-settlement needs WebSocket integration (Phase 8)
- [ ] Trading uses last historical snapshot price as fill price — works for simulation, but live trading needs WebSocket prices
- [ ] No SELL UI in the order panel — positions auto-settle on resolution or user can reset; add explicit sell button if needed
- [ ] Virtual trades stored in localStorage only — migrate to Supabase if cloud persistence is needed


## Phase 6: Trading Rules
- [ ] Wire rules engine into WebSocket live price feed for automatic triggering (Phase 8)
- [ ] Rules can be tested via backtester (Phase 7) against historical data


## Phase 7: Backtesting
- [ ] Worker inlines fee/rules logic — if `lib/fees.ts` or `lib/rulesEngine.ts` change, the worker copy needs updating. Refactor to shared pure-function module with relative imports later
- [ ] Only ~5 price snapshots per market (1-min fidelity) — rules depending on fine-grained price movement may not trigger often. Improves with live-collected 10-sec data (Phase 8)
- [ ] Sharpe ratio annualization assumes 288*365 periods — only meaningful with multi-day backtests


## Phase 8: Live Data Collection & Polish
- [ ] `collect-live.ts` requires `ws` npm package and `SUPABASE_URL`/`SUPABASE_SECRET_KEY` env vars — run with `pnpm --filter scripts collect`
- [ ] Browser WS manager (`lib/ws.ts`) does not yet auto-execute rules on price ticks — needs wiring `evaluateRules()` + `tradeStore.buy()` in a listener (currently display-only)
- [ ] Dashboard WS connect/disconnect is manual unless "Auto-connect on Dashboard load" is toggled in Settings
- [ ] `collect-live.ts` market slug calculation assumes BTC 5-min markets start at exact multiples of 300s from epoch — if Polymarket changes timing, slug generation breaks
- [ ] Bundle size grew to 657KB (from 645KB) — code-splitting deferred
- [ ] No skeleton shimmer animations — loading states use simple text + `animate-pulse`
- [ ] Browser WS ping sends a text frame (`"ping"`) — browser WebSocket API doesn't expose `.ping()`. May need testing against Polymarket to confirm keepalive works
