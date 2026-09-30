import type { SandwichBuyLeg, SandwichLeg } from '@/lib/api';

/**
 * What a basket buy will be WORTH the instant it settles.
 *
 * The one rule this file exists to enforce: a quoted quantity and the price
 * that values it must share a BASIS.
 *
 * A swap quote returns wrapper TOKENS, so only the on-chain price of that same
 * mint (`leg.onchainPriceUsd`) can value it. `leg.currentPriceUsd` is the
 * listed SHARE price for a tokenized equity — the right basis for PnL, because
 * the entry was stamped the same way, and 5-18% away from the token (Lumentum:
 * $979.82 wrapper vs $827.60 share). Valuing quoted tokens with it reported
 * that gap as instant profit: $6 across three legs printed "Est. value ≈
 * $7.70" on a pad whose own price-impact row said 7.92%, so the line moved the
 * opposite way from the only cost on screen.
 *
 * Everything a quote can't reach still counts at its slice rather than sinking
 * the whole line: a prediction leg's slice IS its cost, a leg the venue
 * wouldn't quote costs what it costs, and so does a leg an older server sent
 * without an on-chain price.
 */
export function basketQuotedValueUsd(
  legs: readonly SandwichLeg[],
  plannedLegs: readonly SandwichBuyLeg[],
  quotedQuantity: (legId: string) => number | null,
): number | null {
  let total = 0;
  let anyQuoted = false;

  for (const leg of legs) {
    const planned = plannedLegs.find((row) => row.legId === leg.id);
    if (!planned) continue;
    const spendUsd = Number(planned.inputAmount) / 1_000_000;

    // No token to value — a prediction leg's slice IS its cost.
    if (planned.kind === 'prediction') {
      total += spendUsd;
      continue;
    }

    const qty = quotedQuantity(leg.id);
    if (qty !== null && leg.onchainPriceUsd) {
      // Capped at the slice: at the instant of the buy you cannot hold more
      // market value than you just paid — the spread is the difference, and it
      // only runs one way. Anything above the cap is a stale or mismatched
      // price rather than a gain, so it is never rendered as one.
      total += Math.min(qty * leg.onchainPriceUsd, spendUsd);
      anyQuoted = true;
      continue;
    }

    // Unquoted, or priced by a server too old to send `onchainPriceUsd`. This
    // is not an edge case: at $2 across three legs each slice is ~$0.67, under
    // the $1 minimum an Ondo prestock's RFQ makers enforce — so an
    // all-or-nothing rule would make the line disappear exactly when the
    // amount is small, which reads as a bug rather than as caution.
    total += spendUsd;
  }

  // Nothing quoted at all means we know nothing the typed amount doesn't
  // already say, so the caller hides the line instead of dressing a cached
  // figure up as a quote.
  return anyQuoted && total > 0 ? total : null;
}
