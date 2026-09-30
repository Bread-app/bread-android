/**
 * The dollar amount a "Max" BUY puts on the pad.
 *
 * Never the whole cash balance. The balance on screen is the wallet store's
 * last good read, and the USDC actually in the account at signing time can be
 * a few cents lower (a fee or rent settled since, a float rounding at 1e-6),
 * so spending exactly what the screen shows made Max fail on the very tap
 * it exists for. Leave headroom: 0.5% of the balance, at least one cent and
 * at most one dollar, then floor to `decimals` so rounding can only go down.
 */
export function maxBuyAmount(balanceUsd: number, decimals = 2): number {
  if (!Number.isFinite(balanceUsd) || balanceUsd <= 0) return 0;
  const headroom = Math.min(1, Math.max(0.01, balanceUsd * 0.005));
  const factor = 10 ** Math.max(0, Math.min(decimals, 6));
  // The epsilon keeps 12.34 from flooring to 12.33 via 1233.9999999.
  const floored = Math.floor((balanceUsd - headroom) * factor + 1e-9) / factor;
  return Math.max(0, floored);
}
