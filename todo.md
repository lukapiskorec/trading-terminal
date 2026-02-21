# TODO — Deferred Concerns

## Dashboard
- [x] consistent naming - always mention both UP (YES) and DOWN (NO) to keep consistent - apply to the whole app
- [x] add data on hover over arrows at Outcomes - temporal sequence is not clear from this design (which market is earlier and which is later)
- [x] live Polymarket prices don't seem to update - check connection and stream


## Phase 4: Analytics Dashboard
- [x] `packages/web/.env` must be configured with Supabase publishable key for Analytics page to load data
- [x] 608KB JS bundle (mostly lightweight-charts ~200KB) — can code-split with dynamic imports later
- [x] apply chart and app styling from this app (dark background, magenta text, cyan and green highlights...) - https://github.com/lukapiskorec/strategy-utils
- [x] normalized price overlay seems to not display all the markets, or the graph lines are too faint to see
- [x] normalized price overlay seems to disappear when I resize the browser window, comes back when I click the tabs on the left again
- [x] Outcome Timeline cannot fit all arrows from 288 daily markets - resolve with scaling
- [x] add data on hover over arrows at Outcome Timeline



## Phase 5: Trading Simulator
- [x] Market settlement is manual ("Settle All Resolved" button) — bot engine auto-settles on market transition using WS price heuristic
- [x] Trading uses last historical snapshot price as fill price — Trade page now uses live WebSocket prices exclusively
- [x] No SELL UI in the order panel — bots auto-settle positions on market resolution; Trade page is now bot-based
- [ ] Virtual trades stored in localStorage only — migrate to Supabase if cloud persistence is needed


## Phase 6: Trading Rules
- [x] Wire rules engine into WebSocket live price feed for automatic triggering — bot engine on Trade page evaluates rules on each WS price tick
- [x] Rules can be tested via backtester (Phase 7) against historical data


## Phase 7: Backtesting
- [ ] Worker inlines fee/rules logic — if `lib/fees.ts` or `lib/rulesEngine.ts` change, the worker copy needs updating. Refactor to shared pure-function module with relative imports later
- [ ] Only ~5 price snapshots per market (1-min fidelity) — rules depending on fine-grained price movement may not trigger often. Improves with live-collected 10-sec data (Phase 8)
- [ ] Sharpe ratio annualization assumes 288*365 periods — only meaningful with multi-day backtests


## Phase 8: Live Data Collection & Polish
- [ ] `collect-live.ts` requires `ws` npm package and `SUPABASE_URL`/`SUPABASE_SECRET_KEY` env vars — run with `pnpm --filter scripts collect`
- [x] Browser WS manager (`lib/ws.ts`) does not yet auto-execute rules on price ticks — bot engine on Trade page wires `evaluateRules()` into WS price listener
- [ ] Dashboard WS connect/disconnect is manual unless "Auto-connect on Dashboard load" is toggled in Settings
- [ ] `collect-live.ts` market slug calculation assumes BTC 5-min markets start at exact multiples of 300s from epoch — if Polymarket changes timing, slug generation breaks
- [ ] No skeleton shimmer animations — loading states use simple text + `animate-pulse`
- [ ] Browser WS ping sends a text frame (`"ping"`) — browser WebSocket API doesn't expose `.ping()`. May need testing against Polymarket to confirm keepalive works
