# BTC Price Indicators

Reference for all 9 indicators computed from Binance BTCUSDT data, plus the composite bias score. All calculation logic lives in `packages/web/src/lib/indicators.ts` (browser) with a duplicated copy in `packages/scripts/src/collect-indicators.ts` (Node collector).

**If you change a formula, update both files.**

---

## Data Sources

All data comes from Binance via `packages/web/src/lib/binanceWs.ts`:

| Source | Method | Refresh | Buffer |
|--------|--------|---------|--------|
| **Orderbook** (top 20 levels) | REST poll `GET /api/v3/depth?symbol=BTCUSDT&limit=20` | Every 2s | Latest snapshot only |
| **Trades** | WebSocket `btcusdt@trade` | Real-time | Last 600s, capped at 5,000 |
| **Klines** (1-min candles) | WebSocket `btcusdt@kline_1m`, bootstrapped with REST `GET /api/v3/klines?interval=1m&limit=100` | Real-time (in-progress candle updates continuously) | Last 150 candles |

**Mid price** = `(best_bid + best_ask) / 2` from the orderbook.

---

## Indicator #1: Order Book Imbalance (OBI)

**Function:** `computeOBI(bids, asks, mid, band?)`

**What it measures:** Whether there is more resting buy or sell liquidity near the current price.

**Calculation:**
1. Define a band around mid price: `[mid × 0.99, mid × 1.01]` (default 1% band)
2. Sum all bid quantity where `price >= mid × 0.99` → `bidVol`
3. Sum all ask quantity where `price <= mid × 1.01` → `askVol`
4. `OBI = (bidVol - askVol) / (bidVol + askVol)`

**Output range:** -1.0 to +1.0

**Sentiment:**
- `OBI > +0.10` → **BULLISH** (more buy-side liquidity)
- `OBI < -0.10` → **BEARISH** (more sell-side liquidity)
- Otherwise → **NEUTRAL**

**Parameters:** `band = 0.01` (1% of mid price)

**Notes:**
- Only uses top 20 levels from orderbook (Binance REST limit parameter)
- Orderbook data is a snapshot — can be spoofed. Treat as a short-term signal, not conviction
- Not available historically (requires live orderbook)

---

## Indicator #2: Cumulative Volume Delta (CVD)

**Function:** `computeCVD(trades, windowSec?)`

**What it measures:** Net aggressive buying vs selling pressure over a rolling time window.

**Calculation:**
1. Filter trades within the last `windowSec` seconds (default 300s = 5 min)
2. For each trade:
   - If buyer-initiated (`isBuy = true`): add `qty` to delta
   - If seller-initiated (`isBuy = false`): subtract `qty` from delta
3. `CVD = sum of all signed quantities`

**How `isBuy` is determined:** Binance trade stream field `m` (buyer is maker). When `m = true`, the buyer placed a limit order and the seller hit it (seller-initiated). So `isBuy = !m`.

**Output:** Raw BTC quantity (e.g., +2.5 means 2.5 more BTC bought aggressively than sold)

**Sentiment:**
- `CVD > 0` → **BULLISH**
- `CVD < 0` → **BEARISH**
- `CVD = 0` → **NEUTRAL**

**Parameters:** `windowSec = 300` (5 minutes)

**Notes:**
- No dead-band threshold — any non-zero delta picks a side. Could add a threshold if too noisy
- Not available historically (requires live trade stream)
- The trade buffer holds up to 600s of data but CVD only uses the last 300s by default

---

## Indicator #3: RSI (Relative Strength Index)

**Function:** `computeRSI(klines, period?)`

**What it measures:** Momentum — whether recent price moves have been predominantly up or down.

**Calculation (simple SMA-based RSI, not Wilder's smoothed):**
1. Take the last `period + 1` closing prices (need `period` price changes)
2. For each consecutive pair, compute the change: `diff = close[i] - close[i-1]`
3. Sum all positive diffs → `gainSum`; sum absolute value of negative diffs → `lossSum`
4. `avgGain = gainSum / period`, `avgLoss = lossSum / period`
5. `RS = avgGain / avgLoss`
6. `RSI = 100 - (100 / (1 + RS))`

**Output range:** 0 to 100

**Sentiment (contrarian / mean-reversion):**
- `RSI < 30` → **BULLISH** (oversold, expect bounce)
- `RSI > 70` → **BEARISH** (overbought, expect pullback)
- Otherwise → **NEUTRAL**

**Parameters:** `period = 14`

**Notes:**
- Uses simple SMA for gain/loss averaging, not Wilder's exponential smoothing. This makes it slightly more responsive but less smooth than traditional RSI
- Requires at least 15 candles (`period + 1`). Returns `{value: 50, signal: NEUTRAL}` if insufficient data
- If `avgLoss = 0` (all gains), returns RSI = 100 → BEARISH (overbought extreme)

---

## Indicator #4: MACD (Moving Average Convergence Divergence)

**Function:** `computeMACD(klines, fast?, slow?, sigPeriod?)`

**What it measures:** Trend momentum via the relationship between fast and slow exponential moving averages.

**Calculation:**
1. Compute EMA(12) and EMA(26) over all closing prices
2. `MACD Line = EMA(12) - EMA(26)` for each bar where both exist
3. `Signal Line = EMA(9) of the MACD Line`
4. `Histogram = MACD Line - Signal Line` (latest value only)

**Output:** Histogram value (positive = bullish momentum, negative = bearish)

**Sentiment:**
- `histogram > 0` → **BULLISH**
- `histogram < 0` → **BEARISH**
- `histogram = 0` → **NEUTRAL**

**Parameters:** `fast = 12, slow = 26, sigPeriod = 9`

**Notes:**
- Requires at least `slow + sigPeriod` = 35 candles. Returns `{value: 0, signal: NEUTRAL}` if insufficient
- EMA is seeded with SMA of the first `period` values, then uses standard EMA formula: `EMA = price × k + prevEMA × (1-k)` where `k = 2/(period+1)`
- We only expose the histogram, not the MACD line or signal line separately. The histogram crossing zero is the key signal

---

## Indicator #5: EMA Cross

**Function:** `computeEMACross(klines, shortPeriod?, longPeriod?)`

**What it measures:** Short-term trend direction — whether fast momentum is above or below the slower trend.

**Calculation:**
1. Compute `EMA(5)` and `EMA(20)` over closing prices
2. `diff = EMA(5) - EMA(20)`

**Output:** Dollar difference between the two EMAs

**Sentiment (no neutral zone):**
- `EMA(5) > EMA(20)` → **BULLISH**
- `EMA(5) <= EMA(20)` → **BEARISH**

**Parameters:** `shortPeriod = 5, longPeriod = 20`

**Notes:**
- This is a binary indicator — no NEUTRAL state. It always picks a side
- Requires at least 20 candles. Returns `{value: "N/A", signal: NEUTRAL}` if insufficient
- Has the highest weight (10) in the composite bias score because EMA crossovers are strong trend confirmations on 1-min candles

---

## Indicator #6: VWAP (Volume-Weighted Average Price)

**Function:** `computeVWAP(klines, currentMid)`

**What it measures:** The average price weighted by volume — institutional benchmark for fair value.

**Calculation:**
1. For each candle, compute typical price: `TP = (high + low + close) / 3`
2. `VWAP = Σ(TP × volume) / Σ(volume)` across all candles in the buffer

**Output:** VWAP price level

**Sentiment:**
- `currentMid > VWAP` → **BULLISH** (price above fair value, buyers in control)
- `currentMid < VWAP` → **BEARISH** (price below fair value, sellers in control)
- `currentMid = VWAP` → **NEUTRAL**

**Parameters:** None (uses all candles in the kline buffer, up to 150)

**Notes:**
- VWAP is computed over the entire kline buffer (~2.5 hours of 1-min candles), not reset at session boundaries. Traditional VWAP resets daily, but BTC trades 24/7 so a rolling window makes more sense here
- If total volume is 0, falls back to `currentMid`

---

## Indicator #7: Heikin Ashi Streak

**Function:** `computeHeikinAshi(klines, streakThreshold?)`

**What it measures:** Trend persistence using smoothed (Heikin Ashi) candles — how many consecutive candles are the same color.

**Calculation:**
1. Convert standard candles to Heikin Ashi:
   - `HA Close = (Open + High + Low + Close) / 4`
   - `HA Open = (prevHA Open + prevHA Close) / 2` (first candle: `(Open + Close) / 2`)
2. Count consecutive green (`HA Close > HA Open`) or red candles from the most recent bar backwards
3. Return signed streak: positive = green streak, negative = red streak

**Output:** Signed integer (e.g., +5 = five consecutive green HA candles)

**Sentiment:**
- `streak >= 3` (green) → **BULLISH**
- `streak >= 3` (red, i.e., value <= -3) → **BEARISH**
- Streak < 3 in either direction → **NEUTRAL**

**Parameters:** `streakThreshold = 3`

**Notes:**
- Heikin Ashi smooths out noise — a 3-candle streak in HA is more meaningful than in standard candles
- The streak can grow very large during strong trends. In bias calculation, it's clamped: `contribution = clamp(streak × 2, -6, +6)`

---

## Indicator #8: Volume Profile / Point of Control (POC)

**Function:** `computePOC(klines, currentMid, bins?)`

**What it measures:** The price level with the highest traded volume — where the market spent most of its "energy."

**Calculation:**
1. Find the price range across all candles: `[min(low), max(high)]`
2. Divide range into 30 equal-width bins
3. For each candle, compute typical price `(H+L+C)/3`, find its bin, add the candle's volume to that bin
4. `POC = center of the bin with the highest volume`

**Output:** POC price level

**Sentiment:**
- `currentMid > POC` → **BULLISH** (price trading above the value area)
- `currentMid < POC` → **BEARISH** (price trading below the value area)
- `currentMid = POC` → **NEUTRAL**

**Parameters:** `bins = 30`

**Notes:**
- This is a simplified volume profile — it assigns each candle's entire volume to a single bin based on typical price, rather than distributing it across the candle's full range. Good enough for a signal, but not a precise VP
- With 150 candles at 1-min, this covers ~2.5 hours of price action. Short-term POC, not daily
- Has the lowest weight (3) in composite bias — it's a supporting signal, not a primary driver

---

## Indicator #9: Bid/Ask Walls

**Function:** `computeWalls(bids, asks, mult?)`

**What it measures:** Whether there are large resting orders (walls) on the bid or ask side of the orderbook.

**Calculation:**
1. Collect all quantities from both bid and ask levels (top 20 each)
2. Find the median quantity across all 40 levels
3. `wall threshold = median × mult` (default: median × 5)
4. Count bid levels where `qty >= threshold` → `bidWalls`
5. Count ask levels where `qty >= threshold` → `askWalls`
6. `net = bidWalls - askWalls`

**Output:** Net wall count (positive = more bid walls, negative = more ask walls)

**Sentiment:**
- `net > 0` → **BULLISH** (large buyers defending)
- `net < 0` → **BEARISH** (large sellers defending)
- `net = 0` → **NEUTRAL**

**Parameters:** `mult = 5`

**Notes:**
- Uses median (not mean) to be robust against the walls themselves skewing the threshold
- Only top 20 levels visible — deep walls beyond that are missed
- Walls can be pulled (spoofing). Short-term signal only
- Not available historically (requires live orderbook)

---

## Indicator #10: Bollinger Bands (%B)

**Function:** `computeBBands(klines, currentMid, period?, k?)`

**What it measures:** Price position relative to its volatility envelope — is price stretched to an extreme or near the mean?

**Calculation:**
1. Compute `SMA(20)` of closing prices → middle band
2. Compute standard deviation over the same 20 closes → `σ`
3. `Upper band = SMA + 2σ`, `Lower band = SMA - 2σ`
4. `%B = (currentMid - Lower) / (Upper - Lower)`

**Output range:** Typically 0 to 1 (can exceed when price breaks outside bands)

**Sentiment (contrarian):**
- `%B < 0.2` → **BULLISH** (price near lower band, oversold)
- `%B > 0.8` → **BEARISH** (price near upper band, overbought)
- Otherwise → **NEUTRAL**

**Parameters:** `period = 20, k = 2` (standard Bollinger settings)

**Notes:**
- Uses population standard deviation (not sample), consistent with most charting platforms
- Requires at least 20 candles. Returns `{value: 0.5, signal: NEUTRAL}` if insufficient
- Complements RSI — RSI measures momentum extremes, BBands measures volatility extremes
- Historically available from kline data

---

## Indicator #11: Flow Toxicity

**Function:** `computeFlowToxicity(trades, windowSec?)`

**What it measures:** Whether recent order flow is one-sided and "toxic" — indicating informed traders are active on one side.

**Calculation:**
1. Sum buy volume and sell volume over the last `windowSec` seconds
2. `toxicity = |Vbuy - Vsell| / (Vbuy + Vsell)` (0 to 1)
3. Sign by dominant side: positive if buy-dominated, negative if sell-dominated

**Output:** Signed toxicity ratio (-1 to +1). Magnitude = how one-sided; sign = which side.

**Sentiment:**
- `toxicity > 0.3` AND buy-dominated → **BULLISH** (informed buying)
- `toxicity > 0.3` AND sell-dominated → **BEARISH** (informed selling)
- `toxicity <= 0.3` → **NEUTRAL** (balanced flow)

**Parameters:** `windowSec = 300` (5 minutes)

**Notes:**
- This is a simplified VPIN proxy. True VPIN uses volume buckets and bulk classification; ours uses Binance's per-trade aggressor flag which is more accurate for individual trades
- Differs from CVD: CVD is raw BTC quantity delta, Flow Toxicity is normalized ratio. CVD tells you net direction, toxicity tells you how informed/confident that direction is
- Not available historically (requires live trade stream)

---

## Indicator #12: Rate of Change (ROC)

**Function:** `computeROC(klines, period?)`

**What it measures:** Simple price momentum — percentage change over a fixed lookback period.

**Calculation:**
1. `ROC = (close_now - close_N_ago) / close_N_ago × 100`

**Output:** Percentage (e.g., +0.25 means price up 0.25% over the period)

**Sentiment:**
- `ROC > +0.1%` → **BULLISH**
- `ROC < -0.1%` → **BEARISH**
- Otherwise → **NEUTRAL**

**Parameters:** `period = 10` (10-minute lookback on 1-min candles)

**Notes:**
- The 0.1% dead-band prevents noise from flat markets triggering signals. For BTC at $97k, 0.1% ≈ $97 — reasonable threshold for a 10-minute window
- Requires at least 11 candles. Returns `{value: 0, signal: NEUTRAL}` if insufficient
- Historically available from kline data
- Simpler than MACD but more responsive — no smoothing delay

---

## Composite Bias Score

**Function:** `computeBias(allIndicators)`

**What it measures:** A single sentiment score combining all 12 indicators with different weights.

**Calculation:**

Each indicator contributes to a weighted sum. The sum is then normalized to a -100 to +100 scale.

| Indicator | Weight | Contribution Method |
|-----------|--------|---------------------|
| EMA Cross | 10 | Binary: BULLISH → +10, else → -10 |
| OBI | 8 | Linear: `obi_value × 8` (OBI ranges -1 to +1, so contribution ranges -8 to +8) |
| MACD | 8 | Binary: BULLISH → +8, BEARISH → -8, NEUTRAL → 0 |
| CVD | 7 | Binary: BULLISH → +7, BEARISH → -7, NEUTRAL → 0 |
| Heikin Ashi | 6 | Streak-scaled: `clamp(streak × 2, -6, +6)` |
| Flow Toxicity | 6 | Linear: `clamp(signedToxicity × 6, -6, +6)` |
| VWAP | 5 | Binary: BULLISH → +5, BEARISH → -5, NEUTRAL → 0 |
| RSI | 5 | Linear ramp: `((50 - rsi) / 50) × 5` — maps RSI 0→+5, RSI 50→0, RSI 100→-5 |
| Bollinger Bands | 5 | Linear ramp: `((0.5 - %B) / 0.5) × 5` — maps %B 0→+5, %B 0.5→0, %B 1→-5 |
| Walls | 4 | Wall-count-scaled: `clamp(net × 2, -4, +4)` |
| ROC | 4 | Binary: ROC > +0.1% → +4, ROC < -0.1% → -4, else → 0 |
| POC | 3 | Binary: BULLISH → +3, BEARISH → -3, NEUTRAL → 0 |

**Maximum possible sum** = 10 + 8 + 8 + 7 + 6 + 6 + 5 + 5 + 5 + 4 + 4 + 3 = **71**

**Normalization:** `bias = (sum / 71) × 100`, clamped to [-100, +100]

**Sentiment:**
- `bias > +10` → **BULLISH**
- `bias < -10` → **BEARISH**
- Otherwise → **NEUTRAL**

**Weight rationale:**
- **EMA Cross (10):** Trend-following crossover is the strongest directional signal on short timeframes
- **OBI (8):** Real-time orderbook pressure is highly relevant for 5-min markets, but can be spoofed
- **MACD (8):** Momentum confirmation — when MACD and EMA Cross agree, it's a strong signal
- **CVD (7):** Actual executed volume intent, harder to fake than orderbook
- **Heikin Ashi (6):** Trend persistence — smoothed candles reduce noise
- **Flow Toxicity (6):** Informed flow detection — when high toxicity aligns with direction, it's a strong signal. Same weight as HA because both measure conviction
- **VWAP (5):** Institutional benchmark, but our rolling window is non-standard
- **RSI (5):** Useful for mean-reversion at extremes, but less meaningful at 50
- **Bollinger Bands (5):** Volatility-based mean-reversion — complements RSI with a different lens. Same weight since both are contrarian
- **Walls (4):** Informative but easily manipulated
- **ROC (4):** Simple momentum confirmation — overlaps with EMA/MACD so lower weight. Useful for its speed (no smoothing lag)
- **POC (3):** Supporting context, simplified calculation

---

## Shared Helper: EMA

Used by MACD, EMA Cross, and the collection script.

```
EMA(values, period):
  1. Seed: SMA of first `period` values
  2. For each subsequent value: EMA = value × k + prevEMA × (1 - k)
     where k = 2 / (period + 1)
```

Returns an array shorter than input by `period - 1` elements.

---

## Data Requirements

Minimum candles needed before each indicator produces a real signal:

| Indicator | Min Candles | Time to Fill (1-min candles) |
|-----------|-------------|------------------------------|
| OBI | 0 (orderbook only) | Immediate |
| CVD | 0 (trades only) | Immediate (but needs trades to accumulate) |
| RSI | 15 | 15 min |
| MACD | 35 | 35 min |
| EMA Cross | 20 | 20 min |
| VWAP | 1 | 1 min |
| Heikin Ashi | 2 | 2 min |
| POC | 1 | 1 min |
| Walls | 0 (orderbook only) | Immediate |
| Bollinger Bands | 20 | 20 min |
| Flow Toxicity | 0 (trades only) | Immediate (but needs trades to accumulate) |
| ROC | 11 | 11 min |

On connect, 100 historical candles are bootstrapped from Binance REST, so RSI, MACD, and EMA Cross are available immediately.

---

## Historical Availability

For backtesting against Polymarket outcomes:

| Indicator | Available Historically? | Source |
|-----------|------------------------|--------|
| OBI | No — requires live orderbook | Live collector only |
| CVD | No — requires live trade stream | Live collector only |
| RSI | Yes | Binance REST klines (`/api/v3/klines`) |
| MACD | Yes | Binance REST klines |
| EMA Cross | Yes | Binance REST klines |
| VWAP | Yes | Binance REST klines |
| Heikin Ashi | Yes | Binance REST klines |
| POC | Yes | Binance REST klines |
| Walls | No — requires live orderbook | Live collector only |
| Bollinger Bands | Yes | Binance REST klines |
| Flow Toxicity | No — requires live trade stream | Live collector only |
| ROC | Yes | Binance REST klines |

The live collector (`collect-indicators.ts`) stores all values to `btc_indicator_snapshots` at 1-second resolution. Historical backfill can only populate the 8 kline-based indicators; OBI, CVD, Walls, and Flow Toxicity will be null.

---

## Update Checklist

When modifying an indicator:

1. Update `packages/web/src/lib/indicators.ts` (browser calculations)
2. Update `packages/scripts/src/collect-indicators.ts` (Node collector — has duplicated math)
3. Update this file
4. If changing the bias weight table, update both `computeBias()` in `indicators.ts` and `calcBiasScore()` in `collect-indicators.ts`
5. If adding a new indicator, also update:
   - `indicatorStore.ts` (add to `Indicators` interface and `recalc()`)
   - `IndicatorPanel.tsx` (add to `INDICATOR_LABELS` array)
   - The `btc_indicator_snapshots` Supabase table schema
