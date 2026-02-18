# BTC Indicators — Candidates to Add

Reference for indicators not yet implemented. Formulas are written in plain text to match `btc_indicators.md` style.

---

## Indicator: Bollinger Bands

**What it measures:** Volatility and relative price position versus a moving average.

**Calculation:**

Using window length `n` (default `n = 20`, `k = 2`):

1. Middle band: `MB = SMA(price, n)`
2. Standard deviation: `σ = STD(price, n)`
3. Upper band: `UB = MB + k × σ`
4. Lower band: `LB = MB - k × σ`
5. `%B = (currentPrice - LB) / (UB - LB)`

**Signal logic:**

- Price near **upper band** (`%B > 0.8`) → overbought / breakout
- Price near **lower band** (`%B < 0.2`) → oversold
- **Band expansion** → volatility increasing
- **Band squeeze** → volatility compression

**Parameters:** `n = 20`, `k = 2`

---

## Indicator: Order Flow Toxicity

**What it measures:** Whether current trading flow is **informed / one-sided** ("toxic" to market makers). Not a single universal formula — it is a proxy derived from aggressive buy/sell imbalance, short-term adverse selection, VPIN-like metrics, and signed volume pressure.

**Calculation:**

Common proxy over a short rolling window:

1. Sum aggressive buy volume `V_buy` and sell volume `V_sell` over the window
2. `toxicity = |V_buy - V_sell| / (V_buy + V_sell)`
3. Sign by dominant side: positive if buy-dominated, negative if sell-dominated

More advanced versions incorporate:

- Price impact per unit volume
- Imbalance persistence
- Volatility scaling

**Output range:** -1 to +1 (magnitude = how one-sided; sign = which side)

**Signal logic:**

- `toxicity > 0.3` AND buy-dominated → informed buying pressure
- `toxicity > 0.3` AND sell-dominated → informed selling pressure
- `toxicity ≤ 0.3` → balanced / noise flow

---

## Indicator: Rate of Change (ROC)

**What it measures:** Simple momentum — how much price moved over a fixed lookback period.

**Calculation:**

1. `ROC = (P_t - P_{t-n}) / P_{t-n} × 100`

Where `P_t` is the current close and `P_{t-n}` is the close `n` periods ago.

**Output:** Percentage (e.g., `+0.25` means price up 0.25% over the period)

**Signal logic:**

- Positive ROC → upward momentum
- Negative ROC → downward momentum

**Parameters:** `n = 10` (10-minute lookback on 1-min candles)

---
