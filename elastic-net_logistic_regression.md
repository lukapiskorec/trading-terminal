# Elastic-Net Logistic Regression (Leakage-Aware)

## Multi-Rate Feature Screening + Stability Filtering + Nested Walk-Forward CV

This document captures the final approach for predicting the **next YES/NO outcome** (binary market direction) from:

* a low-rate binary label stream: **288 samples**
* multiple high-rate normalized indicator streams: **12 indicators**
* each label has **300 preceding high-frequency samples** per indicator
  → total HF length = `288 * 300 = 86,400`

The pipeline combines:

1. **Multi-rate univariate screening** (train-only)
2. **Stability filtering** (train-only)
3. **Sparse elastic-net logistic regression** (lasso-heavy)
4. **Nested walk-forward cross-validation** (to avoid selection bias / leakage)

---

## 1) Problem Setup

We have:

* `y[t] ∈ {0,1}` = market direction at low rate (e.g., 5min candles)
* `Xhf[t, j] ∈ [-1, 1]` = indicator j at high rate (e.g., 1 second)
* for each `y[k]`, there is a block of 300 HF samples preceding it.

We want to predict:

> **y[k+1]** using only information available up to the end of block **k**.

This is critical: **no future leakage**.

---

## 2) Multi-Rate Feature Specification

Each candidate feature is defined by a “spec”:

* `indicator`: which indicator (e.g. `ind_08`)
* `agg`: aggregation type
* `shift`: how far back from the label boundary (in HF samples)
* `window`: size of HF window (in HF samples)

### Aggregations used

We used 3 causal aggregations:

| agg          | meaning                      | interpretation          |
| ------------ | ---------------------------- | ----------------------- |
| `mean`       | average value in window      | “level / bias”          |
| `last_first` | last - first in window       | “trend / slope”         |
| `std`        | standard deviation in window | “volatility / activity” |

### Feature window geometry

For label-block `k`, define:

* `t_end = (k+1) * hf_per_label`
* `t2 = t_end - shift`
* `t1 = t2 - window`

Feature = aggregation of HF segment:

> `Xhf[t1:t2, indicator]`

This ensures the feature uses only data strictly **before** the prediction time.

---

## 3) Why We Needed the Parameter Changes

Your first elastic-net attempt produced this pattern:

* inner CV AUC extremely high (0.9+)
* test AUC poor or unstable
* many non-zero coefficients (almost all selected)

This is a classic symptom of:

* **too many hypotheses tested**
* **too little data per fold**
* **screening noise being mistaken for signal**
* and **feature selection instability**

### The key improvements were:

---

## 4) Final Pipeline Improvements

### (1) Enforce a minimum training size

With only 288 labels, the early walk-forward folds were tiny.

Example from earlier output:

* Fold 1: train=51
* Fold 2: train=98
* Fold 3: train=145
* Fold 4: train=192
* Fold 5: train=239

At train=51, univariate screening across thousands of candidates is basically guaranteed to overfit.

So we enforced:

> `min_train_size = 150`

Result: only folds 4 and 5 were evaluated.

---

### (2) Stability filtering (inside fold)

Even with leakage-free selection, you are still doing a large multiple-testing search.

Stability filtering reduces false discoveries:

* split the TRAIN set into inner walk-forward splits
* run screening repeatedly on inner-train subsets
* keep only feature specs that recur in the top K results

We used:

* `inner_screen_splits = 4`
* `top_k_per_split = 40`
* `min_stability = 3`

So a feature spec must appear in at least **3 out of 4** screening runs.

This strongly improves robustness.

---

### (3) Tune for sparsity (lasso-heavy elastic net)

Your indicators and their derived window features are strongly correlated.

Pure ridge → keeps everything
Pure lasso → unstable
Elastic net → best compromise

We tuned:

* `l1_ratio ∈ [0.5, 0.7, 0.85, 0.95, 1.0]`
* `C ∈ logspace(-5, 1)`

This is much more sparse than the earlier setup.

---

### (4) Print per-fold selected specs + top coefficients

We updated the script so each fold prints:

* selected specs (indicator + agg + shift + window + stability_count + auc_best_dir)
* top coefficients by absolute magnitude

This makes the model interpretable.

---

### (5) Reduce the screening grid

The original log-spaced grid was still too wide.

We reduced it to:

**Shift choices**
`[10, 25, 45, 85, 160, 300]`

**Window choices**
`[10, 35, 70, 150, 300]`

This reduces hypothesis count drastically while still covering:

* short memory
* medium memory
* long memory
* near-full-block windows

---

## 5) Final Script (Fully Leakage-Aware)

```python
"""
Leakage-aware + stabilized nested walk-forward pipeline with:

1) Minimum train size enforcement
2) Stability filtering (train-only): keep specs that recur across inner CV splits
3) Sparsity-oriented elastic net tuning (lasso-heavy)
4) Automatic printing of per-fold selected specs + top coefficients
5) Reduced screening grid (provided)

Assumptions:
- y has length n_labels (binary 0/1)
- Xhf has length n_labels * hf_per_label (here hf_per_label=300)
- label k aligns to end of HF block k (block k = [k*300, (k+1)*300))
- features computed on block k predict y_{k+1}

Dependencies:
  numpy, pandas, scipy, scikit-learn
"""

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.metrics import roc_auc_score, log_loss
from sklearn.model_selection import TimeSeriesSplit, GridSearchCV
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression


# ============================================================
# 0) OPTIONAL: synthetic data generator (for quick testing)
# ============================================================

def _sigmoid(z):
    z = np.clip(z, -30, 30)
    return 1.0 / (1.0 + np.exp(-z))

def make_sample_multirate_data(
    n_labels: int = 288,
    n_indicators: int = 12,
    hf_per_label: int = 300,
    seed: int = 7,
    signal_strength: float = 2.0,
    noise_strength: float = 1.0,
):
    rng = np.random.default_rng(seed)
    n_hf = n_labels * hf_per_label

    f = rng.standard_normal(n_hf)
    f = np.convolve(f, np.ones(9) / 9, mode="same")

    X = np.zeros((n_hf, n_indicators), dtype=float)
    for j in range(n_indicators):
        eps = rng.standard_normal(n_hf)
        x = 0.6 * f + 0.9 * eps
        for t in range(1, n_hf):
            x[t] = 0.85 * x[t - 1] + 0.15 * x[t]
        X[:, j] = x

    # normalize to [-1, 1]
    Xn = np.zeros_like(X)
    for j in range(n_indicators):
        mn, mx = X[:, j].min(), X[:, j].max()
        Xn[:, j] = -1.0 + 2.0 * (X[:, j] - mn) / (mx - mn + 1e-12)

    planted = [
        (7,  45,  70, "last_first", -1.0),
        (2,  25,  35, "mean",       +1.2),
        (0,  85,  10, "std",        +0.8),
    ]

    def compute_feat(ind_idx, block_k, shift, window, agg):
        t_end = (block_k + 1) * hf_per_label
        t2 = t_end - shift
        t1 = t2 - window
        if t1 < 0 or t2 > n_hf:
            return np.nan
        seg = Xn[t1:t2, ind_idx]
        if len(seg) != window:
            return np.nan
        if agg == "mean":
            return float(seg.mean())
        if agg == "std":
            return float(seg.std(ddof=0))
        if agg == "last_first":
            return float(seg[-1] - seg[0])
        raise ValueError("Unknown agg")

    y = np.zeros(n_labels, dtype=int)
    y[0] = rng.binomial(1, 0.5)
    for k in range(n_labels - 1):
        z = 0.0
        for (ind_idx, shift, window, agg, w) in planted:
            feat = compute_feat(ind_idx, k, shift, window, agg)
            z += w * (0.0 if np.isnan(feat) else feat)
        z = signal_strength * z + noise_strength * rng.standard_normal()
        p = float(np.clip(_sigmoid(z), 1e-6, 1 - 1e-6))
        y[k + 1] = rng.binomial(1, p)

    hf_idx = pd.date_range("2025-01-01", periods=n_hf, freq="s")
    cols = [f"ind_{i+1:02d}" for i in range(n_indicators)]
    Xhf = pd.DataFrame(Xn, index=hf_idx, columns=cols)
    y_idx = hf_idx[hf_per_label - 1 :: hf_per_label][:n_labels]
    y = pd.Series(y, index=y_idx, name="y_yes")
    meta = {"hf_per_label": hf_per_label, "planted": planted}
    return y, Xhf, meta


# ============================================================
# 1) Feature computation helpers
# ============================================================

def compute_feature_for_block(xj, block_k, hf_per_label, shift, window, agg, n_hf):
    t_end = (block_k + 1) * hf_per_label
    t2 = t_end - shift
    t1 = t2 - window
    if t1 < 0 or t2 > n_hf:
        return np.nan
    seg = xj[t1:t2]
    if seg.shape[0] != window:
        return np.nan
    if agg == "mean":
        return float(seg.mean())
    if agg == "std":
        return float(seg.std(ddof=0))
    if agg == "last_first":
        return float(seg[-1] - seg[0])
    raise ValueError(f"Unknown agg: {agg}")

def build_Xy_from_specs(y, Xhf, specs, hf_per_label, block_indices):
    """
    Build X (rows=selected blocks k) and y_next (target=y_{k+1}).
    Drops blocks without y_{k+1} and blocks with any NaNs.
    """
    required = {"indicator", "agg", "shift", "window"}
    if not required.issubset(specs.columns):
        raise ValueError(f"specs must include columns {required}")

    n_labels = len(y)
    n_hf = len(Xhf)
    if n_hf != n_labels * hf_per_label:
        raise ValueError("Assumes len(Xhf) == len(y) * hf_per_label.")

    y_next_all = y.shift(-1).to_numpy()
    Xarr = Xhf.to_numpy(dtype=float)
    col_index = {c: i for i, c in enumerate(Xhf.columns)}

    block_indices = np.asarray(block_indices, dtype=int)
    keep = np.ones(len(block_indices), dtype=bool)
    y_next = np.zeros(len(block_indices), dtype=int)

    for i, k in enumerate(block_indices):
        if k < 0 or k >= n_labels - 1:
            keep[i] = False
            continue
        if not np.isfinite(y_next_all[k]):
            keep[i] = False
            continue
        y_next[i] = int(y_next_all[k])

    feat_names = []
    X = np.zeros((len(block_indices), len(specs)), dtype=float)

    for fi, row in enumerate(specs.itertuples(index=False)):
        ind, agg, shift, window = row.indicator, row.agg, int(row.shift), int(row.window)
        j = col_index[ind]
        xj = Xarr[:, j]

        col = np.full(len(block_indices), np.nan, dtype=float)
        for ri, k in enumerate(block_indices):
            if not keep[ri]:
                continue
            col[ri] = compute_feature_for_block(
                xj=xj,
                block_k=int(k),
                hf_per_label=hf_per_label,
                shift=shift,
                window=window,
                agg=agg,
                n_hf=n_hf,
            )
        X[:, fi] = col
        feat_names.append(f"{ind}__{agg}__s{shift}__w{window}")

    finite = np.isfinite(X).all(axis=1)
    keep = keep & finite

    X = X[keep]
    y_next = y_next[keep]
    kept_blocks = block_indices[keep]
    return X, y_next, feat_names, kept_blocks


# ============================================================
# 2) Train-only univariate screening (reduced grid)
# ============================================================

def screen_univariate_train_only(
    y, Xhf, hf_per_label, train_blocks,
    shift_choices, window_choices,
    aggs=("mean", "last_first", "std"),
    min_samples=40,
):
    n_labels = len(y)
    n_hf = len(Xhf)

    y_next_all = y.shift(-1).to_numpy()
    Xarr = Xhf.to_numpy(dtype=float)
    indicators = list(Xhf.columns)

    results = []
    for j, ind in enumerate(indicators):
        xj = Xarr[:, j]
        for agg in aggs:
            for shift in shift_choices:
                for window in window_choices:
                    feats, ys = [], []
                    for k in train_blocks:
                        k = int(k)
                        if k < 0 or k >= n_labels - 1:
                            continue
                        yv = y_next_all[k]
                        if not np.isfinite(yv):
                            continue
                        feat = compute_feature_for_block(
                            xj=xj, block_k=k, hf_per_label=hf_per_label,
                            shift=int(shift), window=int(window), agg=agg, n_hf=n_hf
                        )
                        if not np.isfinite(feat):
                            continue
                        feats.append(feat)
                        ys.append(int(yv))

                    if len(ys) < min_samples:
                        continue

                    xvals = np.asarray(feats, dtype=float)
                    yvals = np.asarray(ys, dtype=int)

                    r, p_corr = stats.pearsonr(xvals, yvals)
                    try:
                        auc = roc_auc_score(yvals, xvals)
                        auc_best_dir = max(auc, 1 - auc)
                    except ValueError:
                        auc, auc_best_dir = np.nan, np.nan

                    results.append(dict(
                        indicator=ind, agg=agg, shift=int(shift), window=int(window),
                        n_used=int(len(ys)),
                        auc=float(auc) if np.isfinite(auc) else np.nan,
                        auc_best_dir=float(auc_best_dir) if np.isfinite(auc_best_dir) else np.nan,
                        corr_r=float(r), corr_p=float(p_corr),
                    ))

    res = pd.DataFrame(results)
    if res.empty:
        return res
    res["abs_corr"] = res["corr_r"].abs()
    res = res.sort_values(["auc_best_dir", "abs_corr"], ascending=False).reset_index(drop=True)
    return res


# ============================================================
# 3) Stability filtering inside fold
# ============================================================

def stability_filter_specs(
    y, Xhf, hf_per_label,
    train_blocks,
    shift_choices, window_choices,
    aggs=("mean", "last_first", "std"),
    inner_screen_splits=4,
    top_k_per_split=40,
    min_stability=3,
    min_samples_screen=30,
):
    train_blocks = np.asarray(train_blocks, dtype=int)
    if len(train_blocks) < 60:
        screen = screen_univariate_train_only(
            y, Xhf, hf_per_label, train_blocks,
            shift_choices, window_choices, aggs=aggs, min_samples=min_samples_screen
        )
        if screen.empty:
            return pd.DataFrame()
        specs = (screen[["indicator","agg","shift","window","auc_best_dir","corr_r"]]
                 .drop_duplicates(["indicator","agg","shift","window"])
                 .head(top_k_per_split))
        specs["stability_count"] = 1
        return specs.reset_index(drop=True)

    inner_cv = TimeSeriesSplit(n_splits=inner_screen_splits)
    stability_counter = {}
    best_score_store = {}

    for split_id, (tr_pos, _val_pos) in enumerate(inner_cv.split(train_blocks), start=1):
        inner_train_blocks = train_blocks[tr_pos]

        screen = screen_univariate_train_only(
            y, Xhf, hf_per_label, inner_train_blocks,
            shift_choices, window_choices, aggs=aggs, min_samples=min_samples_screen
        )
        if screen.empty:
            continue

        top = (screen[["indicator","agg","shift","window","auc_best_dir","corr_r"]]
               .drop_duplicates(["indicator","agg","shift","window"])
               .head(top_k_per_split))

        for row in top.itertuples(index=False):
            key = (row.indicator, row.agg, int(row.shift), int(row.window))
            stability_counter[key] = stability_counter.get(key, 0) + 1
            best_score_store[key] = max(best_score_store.get(key, -np.inf), float(row.auc_best_dir))

    if not stability_counter:
        return pd.DataFrame()

    rows = []
    for key, cnt in stability_counter.items():
        if cnt >= min_stability:
            ind, agg, shift, window = key
            rows.append(dict(
                indicator=ind, agg=agg, shift=shift, window=window,
                stability_count=int(cnt),
                auc_best_dir=float(best_score_store.get(key, np.nan)),
            ))

    specs = pd.DataFrame(rows)
    if specs.empty:
        rows = []
        for key, cnt in sorted(stability_counter.items(), key=lambda kv: (-kv[1], -best_score_store.get(kv[0], -np.inf))):
            ind, agg, shift, window = key
            rows.append(dict(
                indicator=ind, agg=agg, shift=shift, window=window,
                stability_count=int(cnt),
                auc_best_dir=float(best_score_store.get(key, np.nan)),
            ))
        specs = pd.DataFrame(rows)

    specs = specs.sort_values(["stability_count", "auc_best_dir"], ascending=False).reset_index(drop=True)
    return specs


# ============================================================
# 4) Sparse elastic net tuning (lasso-heavy)
# ============================================================

def tune_sparse_elastic_net_inner_cv(
    X_train, y_train,
    inner_splits=4,
    random_state=0,
):
    base = LogisticRegression(
        penalty="elasticnet",
        solver="saga",
        max_iter=50_000,
        random_state=random_state,
    )

    pipe = Pipeline([
        ("scaler", StandardScaler()),
        ("clf", base),
    ])

    param_grid = {
        "clf__C": np.logspace(-5, 1, 14),
        "clf__l1_ratio": [0.5, 0.7, 0.85, 0.95, 1.0],
    }

    inner_cv = TimeSeriesSplit(n_splits=inner_splits)

    gs = GridSearchCV(
        pipe,
        param_grid=param_grid,
        scoring="roc_auc",
        cv=inner_cv,
        n_jobs=-1,
        refit=True,
        return_train_score=False,
    )
    gs.fit(X_train, y_train)
    return gs


# ============================================================
# 5) Outer evaluation with minimum train size + printing
# ============================================================

def nested_walk_forward_stable_sparse(
    y, Xhf,
    hf_per_label=300,
    outer_splits=5,
    min_train_size=150,
    top_n_features=25,
    shift_choices=(10, 25, 45, 85, 160, 300),
    window_choices=(10, 35, 70, 150, 300),
    aggs=("mean", "last_first", "std"),
    inner_screen_splits=4,
    top_k_per_split=40,
    min_stability=3,
    min_samples_screen=30,
    inner_model_splits=4,
    random_state=0,
    print_top_specs=12,
    print_top_coefs=12,
):
    n_labels = len(y)
    all_blocks = np.arange(n_labels - 1)
    outer_cv = TimeSeriesSplit(n_splits=outer_splits)

    fold_results = []

    for fold, (tr_pos, te_pos) in enumerate(outer_cv.split(all_blocks), start=1):
        train_blocks = all_blocks[tr_pos]
        test_blocks = all_blocks[te_pos]

        if len(train_blocks) < min_train_size:
            print(f"Fold {fold}: skipped (train_blocks={len(train_blocks)} < min_train_size={min_train_size})")
            continue

        stable_specs = stability_filter_specs(
            y=y, Xhf=Xhf, hf_per_label=hf_per_label,
            train_blocks=train_blocks,
            shift_choices=shift_choices,
            window_choices=window_choices,
            aggs=aggs,
            inner_screen_splits=inner_screen_splits,
            top_k_per_split=top_k_per_split,
            min_stability=min_stability,
            min_samples_screen=min_samples_screen,
        )

        if stable_specs.empty:
            raise RuntimeError(f"Fold {fold}: no specs from stability filtering.")

        specs = stable_specs.copy().head(top_n_features).reset_index(drop=True)

        X_train, y_train, feat_names, _ = build_Xy_from_specs(
            y=y, Xhf=Xhf, specs=specs[["indicator","agg","shift","window"]],
            hf_per_label=hf_per_label, block_indices=train_blocks
        )
        X_test, y_test, _, _ = build_Xy_from_specs(
            y=y, Xhf=Xhf, specs=specs[["indicator","agg","shift","window"]],
            hf_per_label=hf_per_label, block_indices=test_blocks
        )

        inner_splits = min(inner_model_splits, max(2, X_train.shape[0] // 50))

        gs = tune_sparse_elastic_net_inner_cv(
            X_train=X_train,
            y_train=y_train,
            inner_splits=inner_splits,
            random_state=random_state,
        )
        best_model = gs.best_estimator_
        best_params = gs.best_params_
        best_inner_auc = gs.best_score_

        p_test = best_model.predict_proba(X_test)[:, 1]
        auc_test = roc_auc_score(y_test, p_test)
        ll_test = log_loss(y_test, p_test, labels=[0, 1])

        clf = best_model.named_steps["clf"]
        coef = clf.coef_.ravel()
        nnz = int(np.sum(np.abs(coef) > 1e-10))

        print("\n" + "="*78)
        print(f"Fold {fold} (train={X_train.shape[0]}, test={X_test.shape[0]}): "
              f"innerAUC={best_inner_auc:.4f} testAUC={auc_test:.4f} logloss={ll_test:.4f} "
              f"nnz={nnz}/{len(coef)}  params={best_params}")
        print("-"*78)

        print(f"Selected specs (top {min(print_top_specs, len(specs))} of {len(specs)}):")
        cols_to_show = ["indicator","agg","shift","window"]
        if "stability_count" in specs.columns:
            cols_to_show = ["stability_count"] + cols_to_show
        if "auc_best_dir" in specs.columns:
            cols_to_show = cols_to_show + ["auc_best_dir"]
        print(specs[cols_to_show].head(print_top_specs).to_string(index=False))

        topk = min(print_top_coefs, len(coef))
        order = np.argsort(-np.abs(coef))[:topk]
        print("\nTop coefficients (by |weight|):")
        for idx in order:
            print(f"{feat_names[idx]:40s} coef={coef[idx]: .4f}")

        fold_results.append(dict(
            fold=fold,
            n_train=int(X_train.shape[0]),
            n_test=int(X_test.shape[0]),
            inner_best_auc=float(best_inner_auc),
            test_auc=float(auc_test),
            test_logloss=float(ll_test),
            best_params=best_params,
            n_features=int(len(feat_names)),
            nnz=int(nnz),
            selected_specs=specs,
            feature_names=feat_names,
            coefficients=coef,
        ))

    return fold_results


def summarize_fold_results(fold_results):
    if not fold_results:
        print("No folds evaluated.")
        return None

    df = pd.DataFrame(
        [
            {
                "fold": r["fold"],
                "n_train": r["n_train"],
                "n_test": r["n_test"],
                "inner_best_auc": r["inner_best_auc"],
                "test_auc": r["test_auc"],
                "test_logloss": r["test_logloss"],
                "nnz": r["nnz"],
                "n_features": r["n_features"],
                "C": r["best_params"]["clf__C"],
                "l1_ratio": r["best_params"]["clf__l1_ratio"],
            }
            for r in fold_results
        ]
    )
    print("\nPer-fold summary:")
    print(df.to_string(index=False))

    print("\nAggregate:")
    print(f"Mean test AUC:     {df['test_auc'].mean():.4f}  (std {df['test_auc'].std():.4f})")
    print(f"Mean test LogLoss: {df['test_logloss'].mean():.4f}  (std {df['test_logloss'].std():.4f})")
    print(f"Mean nnz:          {df['nnz'].mean():.1f} / {df['n_features'].iloc[0]}")
    return df


if __name__ == "__main__":
    # Replace with your real y, Xhf in production
    y, Xhf, meta = make_sample_multirate_data(
        n_labels=288, n_indicators=12, hf_per_label=300,
        seed=7, signal_strength=2.0, noise_strength=1.0
    )

    shift_choices = [10, 25, 45, 85, 160, 300]
    window_choices = [10, 35, 70, 150, 300]

    print("Shift choices:", shift_choices)
    print("Window choices:", window_choices)

    fold_results = nested_walk_forward_stable_sparse(
        y=y, Xhf=Xhf, hf_per_label=meta["hf_per_label"],
        outer_splits=5,
        min_train_size=150,
        top_n_features=25,
        shift_choices=shift_choices,
        window_choices=window_choices,
        aggs=("mean", "last_first", "std"),
        inner_screen_splits=4,
        top_k_per_split=40,
        min_stability=3,
        min_samples_screen=30,
        inner_model_splits=4,
        random_state=0,
        print_top_specs=12,
        print_top_coefs=12,
    )

    summarize_fold_results(fold_results)
```

---

## 6) Output From The Run (Relevant Parts)

### Outer-fold performance

```text
Fold 4 (train=192, test=47): innerAUC=0.5986 testAUC=0.5920 logloss=0.7293 nnz=19/21
Fold 5 (train=240, test=47): innerAUC=0.6362 testAUC=0.5348 logloss=0.7541 nnz=10/15

Aggregate:
Mean test AUC:     0.5634  (std 0.0404)
Mean test LogLoss: 0.7417  (std 0.0176)
Mean nnz:          14.5 / 21
```

**Interpretation:**

* The model is no longer massively overfitting.
* innerAUC and testAUC are now in a similar range (good sign).
* testAUC ≈ 0.56 is plausible for synthetic + stability filtering.
* nnz dropped meaningfully (from ~25/25 to ~10–19 active features).

---

## 7) Stable Specs

You extracted the stability-filtered specs:

```text
indicator  agg         shift  window  stability_count  auc_best_dir
ind_07     mean           45      10                4      0.734266
ind_12     std            10     150                4      0.725524
ind_08     last_first     45      70                4      0.720280
ind_08     mean           45      10                4      0.711538
ind_10     mean           45      10                4      0.690559
ind_04     last_first     45     150                3      0.783217
ind_03     std            45     150                3      0.723776
ind_05     std            45      70                3      0.722028
ind_06     mean           45      35                3      0.715035
ind_08     last_first     45     150                3      0.699301
ind_12     std            25      70                3      0.695982
ind_12     std            45      70                3      0.680357
ind_12     std            10      70                3      0.670089
ind_12     mean           10      35                3      0.658482
ind_12     last_first     25     150                3      0.640625
```

**Interpretation:**

* The stability filtering is doing what we wanted:

  * it heavily favors **shift=45** and **window sizes 10, 35, 70, 150**
* The dominance of `shift=45` suggests the planted signal is near that horizon.
* Multiple specs from the same indicator (especially `ind_12`, `ind_08`) is expected due to correlation between windowed transforms.

---

## 8) Top Coefficients (Fold 4 and Fold 5)

You extracted the learned weights.

Example fold 4:

```text
ind_08__last_first__s45__w70   -0.5686
ind_12__std__s25__w70          +0.4292
ind_05__std__s45__w70          +0.3877
...
```

Example fold 5:

```text
ind_08__last_first__s45__w70   -0.4133
ind_12__std__s25__w70          +0.2316
ind_05__std__s45__w70          +0.2243
...
```

**Interpretation:**

* Signs are consistent across folds → good.
* Magnitudes shrink in fold 5 because regularization became stronger:

  * fold 4: `C ≈ 1.19, l1_ratio=0.5`
  * fold 5: `C ≈ 0.142, l1_ratio=0.7`
* This is exactly what “tuning for sparsity” does.

---

## 9) Why These Parameter Changes Improved Results

### Why the earlier model had innerAUC ~0.93 but testAUC ~0.37

Because:

* screening picked “lucky” noise features in small folds
* elastic net was too ridge-like (`l1_ratio=0.05`)
* too many features survived (nnz ~ 25/25)
* inner CV was still “too close” to the training distribution

### Why the final model is better

Because:

* folds with too little data were skipped
* stable specs were selected repeatedly (less luck)
* lasso-heavy tuning produced fewer active weights
* reduced grid lowered the multiple-testing burden

---

## 10) Final Notes

### This is still *not* a full “production trading model”

It is a **statistically correct baseline** that:

* avoids leakage
* is interpretable
* is stable enough for small samples
