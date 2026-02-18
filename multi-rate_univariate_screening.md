# Multi‑rate Univariate Screening (shift + window + aggregation)

This document describes and records an example workflow for **multi‑rate univariate screening** where:

- The **target** is a low‑frequency binary time series (YES/NO) with **288** samples.
- The **predictors** are **12** high‑frequency indicator time series with **86,400** samples each.
- Each target sample corresponds to a **block** of **300** high‑frequency samples (86,400 = 288 × 300).
- For each indicator, we compute windowed features of the form:

\[
\phi_{k}(\text{shift},\text{window},\text{agg}) = \text{Agg}\Big(x\big[t_{end}(k)-\text{shift}-\text{window} :\ t_{end}(k)-\text{shift}\big]\Big)
\]

where:

- \(k\) is the label index (block index),
- \(t_{end}(k) = (k+1)\cdot 300\) is the end of the block in high‑frequency sample coordinates,
- **shift** and **window** are measured in high‑frequency ticks (1..300),
- **Agg** is one of:
  - `mean` (level)
  - `last_first` (trend proxy: last − first)
  - `std` (volatility)

We then evaluate, **univariately**, how well each single feature predicts the **next** label:

- Feature computed on block \(k\) is used to predict \(y_{k+1}\).
- Metrics reported:
  - **AUC** (ROC AUC) using the feature as the score
  - **auc_best_dir** = max(AUC, 1 − AUC) to treat inverse predictors symmetrically
  - Pearson correlation (`corr_r`) between feature and \(y_{k+1}\) plus `corr_p`

---

## Why multi‑rate screening?

When indicators are sampled much more frequently than the target label (e.g., intrabar signals predicting next bar direction), a single lagged point can be too noisy. Windowed aggregates:

- improve signal‑to‑noise (mean),
- capture momentum/shape (last−first),
- capture realized variability (std),

and the **(shift, window)** grid allows testing multiple temporal scales.

---

## Log‑spaced grids

To limit the hypothesis space (and reduce false discoveries), shifts and windows are chosen from **log‑spaced** integer grids. In the example run:

- `shift_choices = [1, 2, 4, 7, 13, 24, 45, 84, 159, 300]`
- `window_choices = [2, 4, 8, 17, 35, 72, 147, 300]`

---

## Full Python code

```python
import numpy as np
import pandas as pd
from scipy import stats
from sklearn.metrics import roc_auc_score

# ============================================================
# 1) Synthetic multi-rate data generator
#    - y: 288 binary labels (YES/NO)
#    - Xhf: 12 indicators at high frequency, 86,400 samples
#      (300 HF samples per label)
#    - y_{k+1} depends on indicator window-features from block k
# ============================================================

def _sigmoid(z):
    # numerically stable-ish for our ranges
    z = np.clip(z, -30, 30)
    return 1.0 / (1.0 + np.exp(-z))

def _window_mean(a):
    return float(np.mean(a))

def _window_std(a):
    return float(np.std(a, ddof=0))

def _window_last_first(a):
    # "trend" proxy: last - first
    return float(a[-1] - a[0])

def make_sample_multirate_data(
    n_labels: int = 288,
    n_indicators: int = 12,
    hf_per_label: int = 300,
    seed: int = 7,
    signal_strength: float = 2.0,
    noise_strength: float = 1.0,
):
    """
    Returns:
      - y: pd.Series of length n_labels, binary 0/1
      - Xhf: pd.DataFrame of shape (n_labels*hf_per_label, n_indicators) with values in [-1, 1]
      - meta: dict with block sizing info
    """
    rng = np.random.default_rng(seed)

    n_hf = n_labels * hf_per_label  # 86,400 by default

    # Common latent HF factor to induce inter-correlation (market-like)
    f = rng.standard_normal(n_hf)
    # Light smoothing to introduce autocorrelation
    kernel = np.ones(9) / 9
    f = np.convolve(f, kernel, mode="same")

    X = np.zeros((n_hf, n_indicators), dtype=float)

    # Build correlated indicators: mix latent factor + idiosyncratic + mild AR
    for j in range(n_indicators):
        eps = rng.standard_normal(n_hf)
        x = 0.6 * f + 0.9 * eps

        # mild AR(1)-ish process
        for t in range(1, n_hf):
            x[t] = 0.85 * x[t - 1] + 0.15 * x[t]

        X[:, j] = x

    # Normalize each indicator to [-1, 1] (min-max per series)
    Xn = np.zeros_like(X)
    for j in range(n_indicators):
        mn, mx = X[:, j].min(), X[:, j].max()
        Xn[:, j] = -1.0 + 2.0 * (X[:, j] - mn) / (mx - mn + 1e-12)

    # Create labels y such that y_{k+1} depends on window features from block k.
    # Each label k corresponds to HF block [k*300, (k+1)*300).
    # We'll compute features from the *end of block k* with a chosen (shift, window).
    def compute_feat(ind_idx, block_k, shift, window, agg):
        t_end = (block_k + 1) * hf_per_label  # end of block k
        t2 = t_end - shift
        t1 = t2 - window
        if t1 < 0 or t2 > n_hf:
            return np.nan
        seg = Xn[t1:t2, ind_idx]
        if len(seg) != window:
            return np.nan
        if agg == "mean":
            return _window_mean(seg)
        if agg == "std":
            return _window_std(seg)
        if agg == "last_first":
            return _window_last_first(seg)
        raise ValueError("Unknown agg")

    # Plant a few true predictive relationships (for demo)
    # y_{k+1} depends on features from block k:
    planted = [
        # (indicator_index, shift, window, agg, weight)
        (2,  8,  32, "mean",       +1.2),  # ind_03 mean, near end of block
        (7, 16,  64, "last_first", -1.0),  # ind_08 trend, slightly older
        (0, 32,  16, "std",        +0.8),  # ind_01 volatility
    ]

    y = np.zeros(n_labels, dtype=int)

    # We generate y[0] as random; for k>=0 we generate y[k+1] from block k
    y[0] = rng.binomial(1, 0.5)

    for k in range(n_labels - 1):
        z = 0.0
        for (ind_idx, shift, window, agg, w) in planted:
            feat = compute_feat(ind_idx, k, shift, window, agg)
            z += w * (0.0 if np.isnan(feat) else feat)
        # add noise
        z = signal_strength * z + noise_strength * rng.standard_normal()
        p = float(np.clip(_sigmoid(z), 1e-6, 1 - 1e-6))
        y[k + 1] = rng.binomial(1, p)

    # Build indexes
    # HF timestamps (e.g., 1-second sampling): 86,400 seconds = 1 day
    hf_idx = pd.date_range("2025-01-01", periods=n_hf, freq="s")
    cols = [f"ind_{i+1:02d}" for i in range(n_indicators)]
    Xhf = pd.DataFrame(Xn, index=hf_idx, columns=cols)

    # Label timestamps at end of each block (so label k aligns with end of block k)
    y_idx = hf_idx[hf_per_label - 1 :: hf_per_label][:n_labels]
    y = pd.Series(y, index=y_idx, name="y_yes")

    meta = dict(n_labels=n_labels, n_hf=n_hf, hf_per_label=hf_per_label, planted=planted)
    return y, Xhf, meta


# ============================================================
# 2) Log-spaced grid for shift and window
# ============================================================

def log_spaced_ints(min_v: int, max_v: int, n: int):
    """
    Returns sorted unique ints, roughly log-spaced between [min_v, max_v].
    """
    if min_v < 1 or max_v < min_v:
        raise ValueError("Bad min/max for log spacing.")
    vals = np.unique(np.round(np.geomspace(min_v, max_v, num=n)).astype(int))
    vals = vals[(vals >= min_v) & (vals <= max_v)]
    return np.unique(vals)


# ============================================================
# 3) Multi-rate univariate screening
#    Feature = Agg( indicator[t_end - shift - window : t_end - shift] )
#    Predict target y_{k+1} from feature computed on block k
# ============================================================

def multirate_univariate_screening(
    y: pd.Series,
    Xhf: pd.DataFrame,
    hf_per_label: int = 300,
    shift_choices=None,
    window_choices=None,
    aggs=("mean", "last_first", "std"),
):
    """
    Returns a DataFrame with rows:
      indicator, agg, shift, window, n_used, auc, auc_best_dir, corr_r, corr_p

    Alignment:
      - label index k corresponds to end of HF block k
      - features computed from block k predict y_{k+1}
    """
    if shift_choices is None:
        shift_choices = log_spaced_ints(1, hf_per_label, 10)
    if window_choices is None:
        window_choices = log_spaced_ints(2, hf_per_label, 8)

    # Ensure time index assumptions are met
    n_labels = len(y)
    n_hf = len(Xhf)
    expected_hf = n_labels * hf_per_label
    if n_hf != expected_hf:
        raise ValueError(f"Expected {expected_hf} HF samples (n_labels*hf_per_label), got {n_hf}.")

    # y_{k+1} aligned to feature at k
    y_fwd = y.shift(-1)

    # We'll use integer slicing on numpy arrays for speed/stability.
    Xarr = Xhf.to_numpy(dtype=float)
    indicators = list(Xhf.columns)

    results = []

    for j, ind in enumerate(indicators):
        xj = Xarr[:, j]
        for agg in aggs:
            for shift in shift_choices:
                for window in window_choices:
                    # Feature for block k uses HF segment [t_end-shift-window, t_end-shift)
                    feats = np.full(n_labels, np.nan, dtype=float)

                    for k in range(n_labels):
                        t_end = (k + 1) * hf_per_label
                        t2 = t_end - shift
                        t1 = t2 - window
                        if t1 < 0 or t2 > n_hf:
                            continue
                        seg = xj[t1:t2]
                        if seg.shape[0] != window:
                            continue
                        if agg == "mean":
                            feats[k] = seg.mean()
                        elif agg == "std":
                            feats[k] = seg.std(ddof=0)
                        elif agg == "last_first":
                            feats[k] = seg[-1] - seg[0]
                        else:
                            raise ValueError(f"Unknown agg: {agg}")

                    df = pd.DataFrame(
                        {"feat": feats, "y": y_fwd.to_numpy(dtype=float)},
                        index=y.index,
                    ).dropna()

                    if len(df) < 40:
                        continue  # too few aligned samples to be meaningful

                    xvals = df["feat"].to_numpy(dtype=float)
                    yvals = df["y"].to_numpy(dtype=int)

                    # Correlation and p-value
                    r, p_corr = stats.pearsonr(xvals, yvals)

                    # AUC (single-feature score)
                    try:
                        auc = roc_auc_score(yvals, xvals)
                        auc_best_dir = max(auc, 1 - auc)
                    except ValueError:
                        auc = np.nan
                        auc_best_dir = np.nan

                    results.append(
                        dict(
                            indicator=ind,
                            agg=agg,
                            shift=int(shift),
                            window=int(window),
                            n_used=int(len(df)),
                            auc=float(auc) if np.isfinite(auc) else np.nan,
                            auc_best_dir=float(auc_best_dir) if np.isfinite(auc_best_dir) else np.nan,
                            corr_r=float(r),
                            corr_p=float(p_corr),
                        )
                    )

    res = pd.DataFrame(results)
    if res.empty:
        return res

    res["abs_corr"] = res["corr_r"].abs()
    # Sort by best-direction AUC, then |corr|
    res = res.sort_values(["auc_best_dir", "abs_corr"], ascending=False).reset_index(drop=True)
    return res


def summarize_screening(screen_df: pd.DataFrame, top_n: int = 15):
    if screen_df.empty:
        print("No screening results (check grid sizes / alignment).")
        return

    cols = ["indicator", "agg", "shift", "window", "n_used", "auc", "auc_best_dir", "corr_r", "corr_p"]

    print("\nTop hits overall (by auc_best_dir, then |corr|):")
    print(screen_df.loc[: top_n - 1, cols].to_string(index=False))

    print("\nBest (shift,window,agg) per indicator:")
    best_per_ind = (
        screen_df.sort_values(["indicator", "auc_best_dir", "abs_corr"], ascending=[True, False, False])
        .groupby("indicator", as_index=False)
        .head(1)
        .sort_values("auc_best_dir", ascending=False)
    )
    print(best_per_ind[cols].to_string(index=False))

    print("\nBest per (indicator, agg):")
    best_per_ind_agg = (
        screen_df.sort_values(["indicator", "agg", "auc_best_dir", "abs_corr"], ascending=[True, True, False, False])
        .groupby(["indicator", "agg"], as_index=False)
        .head(1)
        .sort_values("auc_best_dir", ascending=False)
    )
    print(best_per_ind_agg[cols].to_string(index=False))


# ============================================================
# 4) Demo run
# ============================================================

if __name__ == "__main__":
    # Generate sample data
    y, Xhf, meta = make_sample_multirate_data(
        n_labels=288,
        n_indicators=12,
        hf_per_label=300,
        seed=7,
        signal_strength=2.0,
        noise_strength=1.0,
    )

    # Log-spaced choices for shift and window (within 300 HF ticks)
    shift_choices = log_spaced_ints(1, 300, 10)
    window_choices = log_spaced_ints(2, 300, 8)

    print("Shift choices:", shift_choices.tolist())
    print("Window choices:", window_choices.tolist())
    print("Planted signal (indicator_index, shift, window, agg, weight):")
    for tup in meta["planted"]:
        print(" ", tup)

    # Run screening
    screen = multirate_univariate_screening(
        y=y,
        Xhf=Xhf,
        hf_per_label=300,
        shift_choices=shift_choices,
        window_choices=window_choices,
        aggs=("mean", "last_first", "std"),
    )

    summarize_screening(screen, top_n=15)
```

---

## Example output

```
Shift choices: [1, 2, 4, 7, 13, 24, 45, 84, 159, 300]
Window choices: [2, 4, 8, 17, 35, 72, 147, 300]
Planted signal (indicator_index, shift, window, agg, weight):
  (2, 8, 32, 'mean', 1.2)
  (7, 16, 64, 'last_first', -1.0)
  (0, 32, 16, 'std', 0.8)

Top hits overall (by auc_best_dir, then |corr|):
indicator        agg  shift  window  n_used      auc  auc_best_dir    corr_r   corr_p
   ind_08       mean     13       4     287 0.354427      0.645573 -0.242895 0.000032
   ind_08       mean     13       8     287 0.354477      0.645523 -0.254691 0.000013
   ind_08       mean      2      17     287 0.368066      0.631934 -0.227838 0.000098
   ind_08       mean      4      17     287 0.369790      0.630210 -0.226380 0.000109
   ind_08       mean     13       2     287 0.369891      0.630109 -0.220979 0.000161
   ind_08 last_first     13      72     287 0.370804      0.629196 -0.230223 0.000083
   ind_08       mean      1      17     287 0.372021      0.627979 -0.218652 0.000189
   ind_01       mean     84      72     287 0.618345      0.618345  0.180312 0.002166
   ind_08       mean      2       4     287 0.382466      0.617534 -0.202972 0.000541
   ind_08       mean      7      17     287 0.383328      0.616672 -0.210576 0.000328
   ind_08 last_first      7      72     287 0.384140      0.615860 -0.202324 0.000564
   ind_08       mean      2       2     287 0.384241      0.615759 -0.201892 0.000580
   ind_12 last_first     13      72     287 0.386878      0.613122 -0.177826 0.002498
   ind_08 last_first     45      35     287 0.388956      0.611044 -0.174263 0.003056
   ind_09       mean    159       2     287 0.610993      0.610993  0.179019 0.002333

Best (shift,window,agg) per indicator:
indicator        agg  shift  window  n_used      auc  auc_best_dir    corr_r   corr_p
   ind_08       mean     13       4     287 0.354427      0.645573 -0.242895 0.000032
   ind_01       mean     84      72     287 0.618345      0.618345  0.180312 0.002166
   ind_12 last_first     13      72     287 0.386878      0.613122 -0.177826 0.002498
   ind_09       mean    159       2     287 0.610993      0.610993  0.179019 0.002333
   ind_11 last_first      7     300     286 0.389687      0.610313 -0.173152 0.003307
   ind_02 last_first      2       2     287 0.396258      0.603742 -0.179289 0.002297
   ind_07        std    159      35     287 0.600091      0.600091  0.152403 0.009718
   ind_06        std    159     147     286 0.402783      0.597217 -0.138842 0.018817
   ind_05        std     13      17     287 0.406805      0.593195 -0.135959 0.021225
   ind_04       mean     45     147     287 0.592435      0.592435  0.167071 0.004540
   ind_10        std    300     147     286 0.587242      0.587242  0.126927 0.031888
   ind_03 last_first     24      35     287 0.583815      0.583815  0.132446 0.024840

Best per (indicator, agg):
indicator        agg  shift  window  n_used      auc  auc_best_dir    corr_r   corr_p
   ind_08       mean     13       4     287 0.354427      0.645573 -0.242895 0.000032
   ind_08 last_first     13      72     287 0.370804      0.629196 -0.230223 0.000083
   ind_01       mean     84      72     287 0.618345      0.618345  0.180312 0.002166
   ind_12 last_first     13      72     287 0.386878      0.613122 -0.177826 0.002498
   ind_09       mean    159       2     287 0.610993      0.610993  0.179019 0.002333
   ind_11 last_first      7     300     286 0.389687      0.610313 -0.173152 0.003307
   ind_01 last_first     84     300     286 0.609648      0.609648  0.186162 0.001566
   ind_09 last_first    159     147     286 0.605606      0.605606  0.165505 0.005015
   ind_02 last_first      2       2     287 0.396258      0.603742 -0.179289 0.002297
   ind_07        std    159      35     287 0.600091      0.600091  0.152403 0.009718
   ind_09        std      7       4     287 0.599179      0.599179  0.142403 0.015767
   ind_06        std    159     147     286 0.402783      0.597217 -0.138842 0.018817
   ind_05        std     13      17     287 0.406805      0.593195 -0.135959 0.021225
   ind_04       mean     45     147     287 0.592435      0.592435  0.167071 0.004540
   ind_05 last_first     13      72     287 0.408427      0.591573 -0.153318 0.009283
   ind_04 last_first     45       4     287 0.409745      0.590255 -0.124261 0.035370
   ind_10        std    300     147     286 0.587242      0.587242  0.126927 0.031888
   ind_06 last_first      2      35     287 0.584931      0.584931  0.131734 0.025634
   ind_03 last_first     24      35     287 0.583815      0.583815  0.132446 0.024840
   ind_12       mean     84       2     287 0.583105      0.583105  0.142370 0.015792
   ind_08        std    159       2     287 0.582852      0.582852  0.118220 0.045386
   ind_10 last_first     45      35     287 0.417909      0.582091 -0.139449 0.018095
   ind_03       mean     84      35     287 0.581128      0.581128  0.152370 0.009733
   ind_12        std     45       8     287 0.423385      0.576615 -0.098618 0.095420
   ind_04        std     24       2     287 0.424247      0.575753 -0.132335 0.024962
   ind_03        std      1       2     287 0.424247      0.575753 -0.058066 0.326970
   ind_06       mean     84       8     287 0.573319      0.573319  0.134040 0.023139
   ind_10       mean     24       4     287 0.573015      0.573015  0.099220 0.093406
   ind_02        std     45       2     287 0.572812      0.572812  0.125222 0.033965
   ind_07 last_first      2       2     287 0.572660      0.572660  0.128744 0.029212
   ind_11       mean    300      17     286 0.570106      0.570106  0.122204 0.038890
   ind_01        std      2     147     287 0.566829      0.566829  0.128242 0.029852
   ind_05       mean     45       4     287 0.434134      0.565866 -0.127123 0.031323
   ind_11        std    159      35     287 0.565815      0.565815  0.098837 0.094684
   ind_02       mean     24     147     287 0.560339      0.560339  0.099173 0.093561
   ind_07       mean     84       8     287 0.553341      0.553341  0.091962 0.120080
```

---

## Notes

- The best rows may not match the planted (shift, window) exactly when the grid does not contain the planted values; nearby grid points can “snap” to the closest scales.
- Because indicators are correlated (by design in the synthetic generator), proxy predictors can appear strong even if they are not the true planted source.

