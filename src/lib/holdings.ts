import {
  SOLANA_NATIVE_SOL_MINT,
  SOLANA_USDC_MINT,
  SOLANA_WRAPPED_SOL_MINT,
} from '@/lib/trading';

/**
 * What counts as a *holding* — the single rule every screen shares.
 *
 * The wallet feed reports every token account, which is not the same thing as
 * "assets the user owns":
 *  - USDC is cash. It's shown as the cash balance, so listing it again as a
 *    holding double-counts it on screen.
 *  - SOL accrues on its own. Every swap leaves ~0.002 SOL of routing rent in the
 *    wallet (the integrator payer funds a temporary wSOL account that closes
 *    back to the user), so a wallet that only ever bought stocks still shows a
 *    SOL row worth a few dimes. Only the server's `solTraded` flag — derived
 *    from the app's own trade records — separates a real SOL position from that
 *    residue; a balance or cost-basis check cannot.
 *  - Dust rows (emptied token accounts, rounding remainders) are worth less than
 *    a cent and are noise.
 */

/** Below this USD value a row is rounding residue, not a position. */
export const DUST_USD = 0.01;

export type HoldingToken = {
  mint: string | null;
  symbol: string | null;
  balance: number;
  usdValue: number | null;
};

/** USDC — the wallet's cash, surfaced as the cash balance rather than a holding. */
export function isCashToken(token: HoldingToken): boolean {
  return (
    token.mint === SOLANA_USDC_MINT || (token.symbol ?? '').trim().toUpperCase() === 'USDC'
  );
}

/** Native or wrapped SOL, however the upstream feed spells it. */
export function isSolToken(token: HoldingToken): boolean {
  if (token.mint === SOLANA_WRAPPED_SOL_MINT || token.mint === SOLANA_NATIVE_SOL_MINT) {
    return true;
  }
  return !token.mint && (token.symbol ?? '').trim().toUpperCase() === 'SOL';
}

/**
 * Whether a wallet row is a position the user actually holds.
 *
 * `solTraded` must come from the server ledger (`useWalletStore().solTraded`).
 * When it's false the SOL row is swap rent, not a position.
 */
export function isHoldingToken(
  token: HoldingToken,
  options: { solTraded: boolean; dustUsd?: number },
): boolean {
  const dust = options.dustUsd ?? DUST_USD;
  if (!(token.balance > 0)) return false;
  if ((token.usdValue ?? 0) < dust) return false;
  if (isCashToken(token)) return false;
  if (isSolToken(token) && !options.solTraded) return false;
  return true;
}

/** Holdings only, largest first. */
export function selectHoldings<T extends HoldingToken>(
  tokens: readonly T[],
  options: { solTraded: boolean; dustUsd?: number },
): T[] {
  return tokens
    .filter((token) => isHoldingToken(token, options))
    .sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0));
}

/**
 * USD value of everything held *besides* cash — the asset half of the portfolio
 * headline. Uses the same rule as the list beneath it, so the number and the
 * rows can never disagree.
 */
export function sumHoldingsUsd(
  tokens: readonly HoldingToken[],
  options: { solTraded: boolean; dustUsd?: number; exclude?: (token: HoldingToken) => boolean },
): number {
  return tokens.reduce((sum, token) => {
    if (!isHoldingToken(token, options)) return sum;
    if (options.exclude?.(token)) return sum;
    return sum + (token.usdValue ?? 0);
  }, 0);
}
