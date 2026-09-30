/**
 * The ruler a dollar-denominated SELL is converted to tokens with.
 *
 * A sell is typed in dollars and executed in tokens, so something has to turn
 * one into the other. The card price is the wrong ruler whenever the pool is
 * wide: Micron's Ondo wrapper prints $949.52 on the card and pays $872.78 for a
 * $5 clip, so sizing "sell $5" off the card sold 0.005266 tokens and returned
 * $4.60. The same gap in the other direction is what returned $5.18.
 *
 * No cached price can fix that, because the discrepancy IS the pool's spread
 * and impact — only the venue knows it. So the first quote is sized off the
 * card, and the effective price it reports (`pricePerTokenUsd`, all-in) sizes
 * the next one. Measured against live quotes, one pass converges: $4.60 →
 * $5.00, with the effective price stable to 0.007% between passes.
 *
 * This module is the decision of whether to adopt a quoted price, kept pure so
 * the two guards that stop it re-quoting forever are testable:
 *
 *   - the FLOOR: a quote that agrees with the ruler we already use changes
 *     nothing, and adopting it would only mint another request for the same
 *     trade;
 *   - the PASS CAP: a pool whose effective price genuinely moves with every
 *     re-size would otherwise trade requests with the venue indefinitely, so
 *     one typed amount gets a bounded number of refinements.
 */

/** Below this the quote agrees with the ruler in use and is not worth adopting. */
export const SELL_SIZING_FLOOR = 0.0025;
/** Refinements allowed per typed amount. Measured, the first one suffices. */
export const MAX_SELL_SIZING_PASSES = 2;

export type SellSizingPrice = {
  /** The mint this ruler was learned for — never applied to another asset. */
  mint: string;
  price: number;
  /** `${mint}:${typed amount}`, so a new amount gets a fresh pass budget. */
  key: string;
  passes: number;
};

/**
 * The ruler after a quote comes back, or `current` unchanged when the quote
 * should not be adopted.
 *
 * `cardPrice` is the fallback basis: on the first quote for an asset there is
 * no learned ruler yet, and the card price is what sized the quote we are
 * judging.
 */
export function nextSellSizingPrice(options: {
  current: SellSizingPrice | null;
  mint: string;
  key: string;
  quotedPrice: number;
  cardPrice: number | null;
}): SellSizingPrice | null {
  const { current, mint, key, quotedPrice, cardPrice } = options;
  if (!Number.isFinite(quotedPrice) || quotedPrice <= 0) return current;

  // A ruler learned for another mint says nothing about this one.
  const live = current && current.mint === mint ? current : null;
  const basis = live?.price ?? cardPrice;
  if (basis !== null && basis > 0 && Math.abs(quotedPrice - basis) / basis < SELL_SIZING_FLOOR) {
    return current;
  }

  const passes = live && live.key === key ? live.passes : 0;
  if (passes >= MAX_SELL_SIZING_PASSES) return current;
  return { mint, price: quotedPrice, key, passes: passes + 1 };
}

/** The price a typed sell amount is converted to tokens with. */
export function sellSizingPriceFor(
  learned: SellSizingPrice | null,
  mint: string | null,
  cardPrice: number | null,
): number | null {
  if (mint && learned && learned.mint === mint) return learned.price;
  return cardPrice;
}

/**
 * What the sell pad should call the holding worth: the venue's answer for the
 * whole position when it has one, otherwise the position marked at the best
 * price available.
 *
 * This figure is spent, not just read — "Max" takes it, "50%" halves it, and
 * the insufficient-balance check bounds the typed amount by it — so a mark the
 * pool will not pay puts an unfillable number on the pad. The gap is real and
 * size-dependent: Micron's Ondo wrapper realizes 8% under its mark on a small
 * clip and roughly par on a large one, where the route changes.
 *
 * The marked fallbacks are deliberately kept: a slightly stale figure beats
 * "loading" on a balance the user can see in their wallet, and a quote that
 * never lands must not leave the pad unusable.
 */
export function sellBalanceUsd(options: {
  /** The venue's expected proceeds for the entire position, when quoted. */
  realizableUsd: number | null;
  positionTokens: number;
  /** The sell ruler, then the card price — first positive one is used. */
  marks: (number | null | undefined)[];
}): number | null {
  const { realizableUsd, positionTokens, marks } = options;
  if (realizableUsd !== null && Number.isFinite(realizableUsd) && realizableUsd >= 0) {
    return realizableUsd;
  }
  for (const mark of marks) {
    if (typeof mark === 'number' && Number.isFinite(mark) && mark > 0) return positionTokens * mark;
  }
  return null;
}
