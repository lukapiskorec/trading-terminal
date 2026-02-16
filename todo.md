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
