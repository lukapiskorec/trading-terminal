/**
 * Polymarket parabolic fee calculation.
 *
 * fee_per_share = price * (1 - price) * fee_rate_multiplier
 *
 * BTC 5-min markets: fee_rate_multiplier ≈ 0.0625 (makerBaseFee / takerBaseFee = 1000 bps)
 * This gives max fee of ~1.56% at p=0.50, dropping to ~0.30% at extremes.
 *
 * Simplified: we use the standard curve with multiplier = 1 (which already encodes
 * the parabolic shape). The fee_rate_bps from the API adjusts the multiplier.
 */

/** Default fee rate for BTC 5-min markets (basis points → decimal) */
const DEFAULT_FEE_RATE = 0.0625;

/** Calculate fee per share at a given price */
export function feePerShare(price: number, feeRate = DEFAULT_FEE_RATE): number {
  return price * (1 - price) * feeRate;
}

/** Calculate total fee for an order */
export function orderFee(price: number, quantity: number, feeRate = DEFAULT_FEE_RATE): number {
  return feePerShare(price, feeRate) * quantity;
}

/** Calculate total cost to buy shares (price * quantity + fee) */
export function buyCost(price: number, quantity: number, feeRate = DEFAULT_FEE_RATE): number {
  return price * quantity + orderFee(price, quantity, feeRate);
}

/** Calculate proceeds from selling shares (price * quantity - fee) */
export function sellProceeds(price: number, quantity: number, feeRate = DEFAULT_FEE_RATE): number {
  return price * quantity - orderFee(price, quantity, feeRate);
}

/** Format a fee as a readable percentage string */
export function feePercentage(price: number, feeRate = DEFAULT_FEE_RATE): string {
  const pct = feePerShare(price, feeRate) / price * 100;
  return isFinite(pct) ? `${pct.toFixed(2)}%` : "0.00%";
}
