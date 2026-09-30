import { hasValidMint } from '@/lib/trading';

/**
 * Choosing which mint a sell actually spends.
 *
 * One asset ships as several tokenized *variants* — Backpack xStock ("TSLAX"),
 * Ondo prestock ("TSLAON"), … — each with its own mint. A detail screen is
 * opened on one variant, but the wallet may hold another, and the UI has always
 * matched holdings suffix-insensitively by ticker. Execution must follow: it
 * spends whichever mint the wallet genuinely holds, or the user sees a position
 * they're told they don't own.
 */

/** Suffix-insensitive ticker key: "TSLAX" / "TSLAON" / "tsla" all → "TSLA". */
export function normalizeTicker(symbol: string | null | undefined): string {
  return (symbol ?? '').replace(/(ON|X)$/i, '').trim().toUpperCase();
}

export type SellCandidateToken = {
  mint: string | null;
  symbol: string | null;
  balance: number;
};

/**
 * Mints that could satisfy a sell of `symbol`, in preference order: the mint on
 * screen first, then held variants of the same ticker, largest balance first.
 * De-duplicated and capped — one screen mint plus the three biggest matches is
 * already more variants than any real asset has.
 */
export function collectSellCandidateMints(
  screenMint: string | null | undefined,
  symbol: string | null | undefined,
  tokens: readonly SellCandidateToken[],
  limit = 4,
): string[] {
  const out: string[] = [];
  if (hasValidMint(screenMint)) out.push(screenMint);

  const target = normalizeTicker(symbol);
  if (target) {
    tokens
      .filter(
        (token) =>
          (token.balance ?? 0) > 0 &&
          hasValidMint(token.mint) &&
          normalizeTicker(token.symbol) === target,
      )
      .slice()
      .sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0))
      .forEach((token) => {
        if (hasValidMint(token.mint) && !out.includes(token.mint)) out.push(token.mint);
      });
  }

  return out.slice(0, limit);
}
