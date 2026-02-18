# Randomness Test for a Binary Time Series (YES/NO)

This document records a lightweight Python approach for testing whether a binary time series
(e.g., YES/NO, 1/0) is consistent with an IID random process (coin flips), or whether it
contains detectable structure such as:

- imbalance away from 50/50,
- clustering (too few runs),
- over-alternation (too many runs),
- serial dependence / autocorrelation,
- abnormal run-length distribution,
- abnormal k-gram (block) frequencies,
- first-order Markov dependence (persistence).

The test suite is intentionally compact and uses only:

- `numpy`
- `scipy`

(plus optional `sklearn` not needed here)

---

## Full Python code

```python
import numpy as np
from collections import Counter
from math import sqrt
from scipy import stats

def _to_bits(x):
    """
    Accepts:
      - string like "010101"
      - list/array of booleans/0/1
      - list of strings like ["YES","NO",...]
    Returns numpy array of 0/1 ints.
    """
    if isinstance(x, np.ndarray):
        x = x.tolist()

    if isinstance(x, str):
        s = x.strip()
        # If it's already 0/1
        if set(s) <= {"0", "1"}:
            return np.fromiter((c == "1" for c in s), dtype=np.int8).astype(int)
        # If it's comma/space separated YES/NO
        tokens = [t for t in s.replace(",", " ").split() if t]
        if tokens and set(map(str.upper, tokens)) <= {"YES", "NO"}:
            return np.array([1 if t.upper() == "YES" else 0 for t in tokens], dtype=int)
        raise ValueError("String input must be '0101...' or whitespace/comma separated 'YES/NO' tokens.")

    # list-like
    if len(x) == 0:
        raise ValueError("Empty input.")
    if isinstance(x[0], str):
        if set(map(str.upper, x)) <= {"YES", "NO"}:
            return np.array([1 if t.upper() == "YES" else 0 for t in x], dtype=int)
        if set(x) <= {"0", "1"}:
            return np.array([1 if t == "1" else 0 for t in x], dtype=int)
        raise ValueError("String list must be YES/NO or '0'/'1'.")
    return np.array(x, dtype=int)

def runs_test(bits):
    """
    Wald–Wolfowitz runs test (approx normal).
    Detects clustering (too few runs) or over-alternation (too many runs).
    Returns z, p_value (two-sided), number_of_runs.
    """
    bits = np.asarray(bits, dtype=int)
    n = len(bits)
    n1 = bits.sum()
    n0 = n - n1
    if n0 == 0 or n1 == 0:
        return np.nan, np.nan, 1  # degenerate

    # count runs
    runs = 1 + np.sum(bits[1:] != bits[:-1])

    # expected runs and variance under IID
    mu = 1 + (2 * n0 * n1) / n
    var = (2 * n0 * n1 * (2 * n0 * n1 - n)) / (n**2 * (n - 1))
    z = (runs - mu) / sqrt(var) if var > 0 else np.nan
    p = 2 * (1 - stats.norm.cdf(abs(z))) if np.isfinite(z) else np.nan
    return z, p, int(runs)

def autocorr(bits, max_lag=20):
    """
    Sample autocorrelation for lags 1..max_lag on centered series.
    """
    x = np.asarray(bits, dtype=float)
    x = x - x.mean()
    n = len(x)
    denom = np.dot(x, x)
    if denom == 0:
        return np.zeros(max_lag)
    ac = []
    for k in range(1, max_lag + 1):
        ac.append(np.dot(x[:-k], x[k:]) / denom)
    return np.array(ac)

def ljung_box(bits, lags=20):
    """
    Ljung–Box Q test using sample autocorrelations.
    Lightweight implementation (no statsmodels).
    Approx chi-square with df=lags.
    """
    x = np.asarray(bits, dtype=float)
    n = len(x)
    ac = autocorr(x, max_lag=lags)
    # Q = n(n+2) sum_{k=1..m} r_k^2 / (n-k)
    Q = n * (n + 2) * np.sum((ac**2) / (n - np.arange(1, lags + 1)))
    p = 1 - stats.chi2.cdf(Q, df=lags)
    return Q, p

def run_lengths(bits):
    """
    Returns list of run lengths.
    Example: 0011100 -> [2,3,2]
    """
    bits = np.asarray(bits, dtype=int)
    if len(bits) == 0:
        return []
    lengths = []
    cur = 1
    for i in range(1, len(bits)):
        if bits[i] == bits[i-1]:
            cur += 1
        else:
            lengths.append(cur)
            cur = 1
    lengths.append(cur)
    return lengths

def run_length_chi2(bits, max_len=10):
    """
    Compare observed run length distribution to IID geometric expectation (p=0.5),
    grouped into 1..max_len-1 and >=max_len.

    Under IID with p=0.5, P(L = k) = (0.5)^k for k>=1 (when not conditioning on symbol).
    (More precisely: P(L=k)= (1-p)^{k-1} p with p=0.5 => (0.5)^k.)

    Returns chi2_stat, p_value, observed_counts, expected_counts.
    """
    rl = run_lengths(bits)
    if len(rl) == 0:
        return np.nan, np.nan, None, None

    obs = np.zeros(max_len, dtype=float)  # last bin is >=max_len
    for L in rl:
        if L >= max_len:
            obs[-1] += 1
        else:
            obs[L-1] += 1

    R = obs.sum()
    # Expected probabilities for run lengths
    probs = np.array([(0.5)**k for k in range(1, max_len)], dtype=float)
    probs_tail = 1 - probs.sum()  # P(L >= max_len)
    probs = np.append(probs, probs_tail)
    exp = R * probs

    # Guard against tiny expected counts: merge if needed (simple approach)
    # If any expected count < 5, results may be approximate.
    chi2 = np.sum((obs - exp)**2 / np.where(exp > 0, exp, np.nan))
    df = max_len - 1
    p = 1 - stats.chi2.cdf(chi2, df=df)
    return chi2, p, obs.astype(int), exp

def kgram_chi2(bits, k=2):
    """
    Count overlapping k-grams and compare to uniform (IID p=0.5 implies each k-gram prob = 1/2^k).
    Returns chi2_stat, p_value, counts dict.
    """
    bits = np.asarray(bits, dtype=int)
    n = len(bits)
    if n < k + 1:
        return np.nan, np.nan, None

    grams = []
    for i in range(n - k + 1):
        g = "".join(map(str, bits[i:i+k]))
        grams.append(g)
    c = Counter(grams)

    all_grams = [format(i, f"0{k}b") for i in range(2**k)]
    obs = np.array([c.get(g, 0) for g in all_grams], dtype=float)
    N = obs.sum()
    exp = np.full_like(obs, N / (2**k), dtype=float)

    chi2 = np.sum((obs - exp)**2 / np.where(exp > 0, exp, np.nan))
    df = (2**k) - 1
    p = 1 - stats.chi2.cdf(chi2, df=df)
    counts = {g: int(c.get(g, 0)) for g in all_grams}
    return chi2, p, counts

def markov_transition_test(bits):
    """
    Test whether transitions differ from IID (0.5) and whether staying prob > switching prob (clustering).
    Returns:
      - transition_matrix (2x2)
      - p_value for H0: P(1|0)=0.5 and P(0|1)=0.5 (two binomial tests combined via Fisher)
      - stay_probability, switch_probability
    """
    b = np.asarray(bits, dtype=int)
    if len(b) < 2:
        return None, np.nan, np.nan, np.nan

    n00 = np.sum((b[:-1] == 0) & (b[1:] == 0))
    n01 = np.sum((b[:-1] == 0) & (b[1:] == 1))
    n10 = np.sum((b[:-1] == 1) & (b[1:] == 0))
    n11 = np.sum((b[:-1] == 1) & (b[1:] == 1))

    # conditional probs
    p10 = n01 / (n00 + n01) if (n00 + n01) > 0 else np.nan  # P(1|0)
    p01 = n10 / (n10 + n11) if (n10 + n11) > 0 else np.nan  # P(0|1)

    # Binomial tests for each conditional probability vs 0.5
    pvals = []
    if np.isfinite(p10):
        pvals.append(stats.binomtest(n01, n00 + n01, 0.5, alternative="two-sided").pvalue)
    if np.isfinite(p01):
        pvals.append(stats.binomtest(n10, n10 + n11, 0.5, alternative="two-sided").pvalue)

    if len(pvals) == 0:
        combined = np.nan
    elif len(pvals) == 1:
        combined = pvals[0]
    else:
        # Fisher's method
        combined = stats.combine_pvalues(pvals, method="fisher").pvalue

    T = np.array([[n00, n01],
                  [n10, n11]], dtype=int)

    stay = (n00 + n11) / (len(b) - 1)
    switch = (n01 + n10) / (len(b) - 1)

    return T, combined, stay, switch

def evaluate_binary_randomness(data, max_lag=20, runlen_max=10, kgrams=(2,3,4)):
    bits = _to_bits(data)
    n = len(bits)
    if n < 10:
        raise ValueError("Need at least ~10 samples for meaningful diagnostics.")

    # 1) balance
    n1 = int(bits.sum())
    n0 = n - n1
    p_balance = stats.binomtest(n1, n, 0.5, alternative="two-sided").pvalue

    # 2) runs test
    z_runs, p_runs, runs = runs_test(bits)

    # 3) autocorr + Ljung–Box
    ac = autocorr(bits, max_lag=max_lag)
    Q, p_lb = ljung_box(bits, lags=max_lag)

    # 4) run length distribution
    chi2_rl, p_rl, obs_rl, exp_rl = run_length_chi2(bits, max_len=runlen_max)

    # 5) k-gram block tests
    kgram_results = {}
    for k in kgrams:
        chi2_k, p_k, counts = kgram_chi2(bits, k=k)
        kgram_results[k] = {"chi2": chi2_k, "p": p_k, "counts": counts}

    # 6) Markov transition check
    T, p_markov, stay, switch = markov_transition_test(bits)

    report = {
        "n": n,
        "counts": {"0": n0, "1": n1},
        "balance_binom_p": p_balance,
        "runs": {"runs": runs, "z": z_runs, "p": p_runs},
        "autocorr": {"max_lag": max_lag, "r": ac.tolist()},
        "ljung_box": {"Q": float(Q), "df": int(max_lag), "p": float(p_lb)},
        "run_length_chi2": {
            "max_len_bin": runlen_max,
            "chi2": float(chi2_rl),
            "df": int(runlen_max - 1),
            "p": float(p_rl),
            "observed": None if obs_rl is None else obs_rl.tolist(),
            "expected": None if exp_rl is None else exp_rl.tolist(),
        },
        "kgram_chi2": kgram_results,
        "markov": {
            "transition_counts": None if T is None else T.tolist(),  # [[00,01],[10,11]]
            "combined_p": float(p_markov) if np.isfinite(p_markov) else np.nan,
            "stay_prob": float(stay) if np.isfinite(stay) else np.nan,
            "switch_prob": float(switch) if np.isfinite(switch) else np.nan,
        },
    }
    return report

def pretty_print_report(rep, alpha=0.05):
    def flag(p):
        return "⚠️" if (p is not None and np.isfinite(p) and p < alpha) else "OK"

    print(f"n = {rep['n']}")
    print(f"counts: 0={rep['counts']['0']}, 1={rep['counts']['1']}")
    print(f"Balance (binomial p vs 0.5): {rep['balance_binom_p']:.4g}  [{flag(rep['balance_binom_p'])}]")

    r = rep["runs"]
    print(f"Runs test: runs={r['runs']}, z={r['z']:.3f}, p={r['p']:.4g}  [{flag(r['p'])}]")

    lb = rep["ljung_box"]
    print(f"Ljung–Box (lags={lb['df']}): Q={lb['Q']:.3f}, p={lb['p']:.4g}  [{flag(lb['p'])}]")

    rl = rep["run_length_chi2"]
    print(f"Run-length χ² (bins 1..{rl['max_len_bin']-1}, >= {rl['max_len_bin']}): "
          f"chi2={rl['chi2']:.3f}, p={rl['p']:.4g}  [{flag(rl['p'])}]")

    mk = rep["markov"]
    print(f"Markov transition (combined p): {mk['combined_p']:.4g}  [{flag(mk['combined_p'])}]")
    print(f"  stay_prob={mk['stay_prob']:.3f}, switch_prob={mk['switch_prob']:.3f}")
    if mk["transition_counts"] is not None:
        T = np.array(mk["transition_counts"])
        print("  transition counts [[00,01],[10,11]] =")
        print(f"    {T.tolist()}")

    for k, res in rep["kgram_chi2"].items():
        p = res["p"]
        print(f"{k}-gram χ²: p={p:.4g}  [{flag(p)}]")

# ---------------------------
# Example usage:
if __name__ == "__main__":
    s = "011110110000011010101100011001101010101010011101100001011111110011111010001010110110100010001001100000101010010010000101011001000110110111110000011010010110"
    rep = evaluate_binary_randomness(s, max_lag=10, runlen_max=8, kgrams=(2,3,4))
    pretty_print_report(rep)
```

---

## Example input used

The binary sample stream used in this run:

```text
011110110000011010101100011001101010101010011101100001011111110011111010001010110110100010001001100000101010010010000101011001000110110111110000011010010110
```

---

## Output

```
n = 156
counts: 0=80, 1=76
Balance (binomial p vs 0.5): 0.8103  [OK]
Runs test: runs=87, z=1.294, p=0.1956  [OK]
Ljung–Box (lags=10): Q=8.424, p=0.5875  [OK]
Run-length χ² (bins 1..7, >= 8): chi2=8.356, p=0.3022  [OK]
Markov transition (combined p): 0.4363  [OK]
  stay_prob=0.445, switch_prob=0.555
  transition counts [[00,01],[10,11]] =
    [[36, 43], [43, 33]]
2-gram χ²: p=0.5764  [OK]
3-gram χ²: p=0.7768  [OK]
4-gram χ²: p=0.7011  [OK]
```

