## 10) bbands (Bollinger Bands)

### What it means

Bollinger Bands measure **volatility** and **relative price position** versus a moving average.

### Calculation

Using a window length ( n ) (often 20):

* Middle band:
  [
  MB = SMA_n(price)
  ]

* Standard deviation:
  [
  \sigma = STD_n(price)
  ]

* Upper band:
  [
  UB = MB + k\sigma
  ]

* Lower band:
  [
  LB = MB - k\sigma
  ]

Commonly: ( n=20 ), ( k=2 )

### Signal logic (typical)

* Price near **upper band** → “overbought” / breakout
* Price near **lower band** → “oversold”
* **Band expansion** → volatility increasing
* **Band squeeze** → volatility compression

---

## 11) flow_toxic (Order Flow Toxicity)

### What it means

A measure of whether current trading flow is **informed / one-sided**, i.e. “toxic” to market makers.

This is not a single universal formula — it’s usually a proxy derived from:

* aggressive buy/sell imbalance
* short-term adverse selection
* VPIN-like metrics
* signed volume pressure

### Typical calculation approach

A common proxy:
[
toxicity \approx \frac{|V_{buy} - V_{sell}|}{V_{buy}+V_{sell}}
]
computed over a short rolling window.

More advanced versions incorporate:

* price impact per unit volume
* imbalance persistence
* volatility scaling

---

## 12) roc (Rate of Change)

### What it means

Simple momentum indicator: how much price moved over a period.

### Calculation

[
ROC_n = \frac{P_t - P_{t-n}}{P_{t-n}} \times 100
]

### Signal logic

* Positive ROC → upward momentum
* Negative ROC → downward momentum

---