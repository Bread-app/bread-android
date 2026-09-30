import type { Sandwich } from '@/lib/api';

type SignableLeg = {
  type?: 'tokenized_stock' | 'prediction_market' | 'perp' | null;
  side?: string | null;
};

/**
 * -1 for a short leg, mirroring the server's `stockLegMultiplier`
 * (stock-backend/lib/server/sandwich.ts). A short earns when the price falls,
 * so any return derived from raw prices on the client has to be signed the same
 * way the server signs `leg.pnlPct` — otherwise a winning short reads as a loss
 * of exactly the size of its gain.
 *
 * Prediction markets are never flipped: they price the OUTCOME directly, so a
 * "no" share rising IS a gain. Spot directional legs and Phoenix perps both
 * carry a direction that must be applied on top of their raw price candles.
 */
export function legSign(leg: SignableLeg): 1 | -1 {
  if (leg.type === 'prediction_market') return 1;
  const side = (leg.side ?? '').trim().toLowerCase();
  return side === 'sell' || side === 'short' ? -1 : 1;
}

export type EpisodeReturn = {
  pnlPct: number | null;
  /** How many of the episode's markets the figure actually covers. */
  counted: number;
  total: number;
  /** True when any counted market is priced on `underlying_move`. */
  mixedBasis: boolean;
};

/**
 * How an episode's calls have done overall.
 *
 * Nothing ranks or headlines on this today — the feed moved to
 * `bestMarketReturn` for both. Kept because it is the honest answer to a
 * different question ("what did this episode do?") and the one to reach for if
 * an episode-level figure is ever shown alongside the best call.
 *
 * An equal-weight mean is right here and `totalWeightBps` weighting would not
 * be: each timestamp is its own independent Sandwich, so weights only mean
 * something *inside* a basket, never across them.
 *
 * The two things this fixes over a bare `reduce`: markets with no price are
 * reported via `counted`/`total` instead of silently shrinking the denominator
 * (an episode of three shorts used to report its one long as "the episode"),
 * and `mixedBasis` flags a figure that blends realizable spot returns with
 * unlevered perp estimates.
 */
export function episodeReturn(sandwiches: Sandwich[]): EpisodeReturn {
  const counted = sandwiches.filter((s) => s.pnlPct != null);
  const sum = counted.reduce((acc, s) => acc + (s.pnlPct ?? 0), 0);

  return {
    pnlPct: counted.length > 0 ? sum / counted.length : null,
    counted: counted.length,
    total: sandwiches.length,
    mixedBasis: counted.some((s) => s.pnlBasis === 'underlying_move'),
  };
}

export type BestMarketReturn = {
  /** The best-performing priced market's OWN return — not an episode figure. */
  pnlPct: number | null;
  /** The market that return belongs to. Its ticker is what attributes the
   *  number on the card; without it "+42%" reads as the whole episode. */
  sandwich: Sandwich | null;
  /** How many of the episode's markets are priced at all. */
  counted: number;
  total: number;
};

/**
 * The episode's strongest call.
 *
 * Distinct from `episodeReturn`, and deliberately NOT a replacement for it: the
 * mean is what the episode as a whole did, this is what its best call did. The
 * feed card headlines this one because a card's job is to show that a call
 * worked — an episode of ten where one ran +80% is interesting, and a mean of
 * +4% hides that entirely.
 *
 * It must always be rendered next to the winning market's ticker. A bare
 * best-of percentage with the episode's name on it claims the episode returned
 * something it did not.
 *
 * `feedRank` ranks on this too, so the order a reader scrolls and the number on
 * each card are the same figure. The known cost, accepted: an episode gets one
 * chance per call to produce a winner. The cap in `feedRank` is what bounds it.
 *
 * When nothing is up, the best call is the least-bad one and renders negative —
 * the card reports the top of the episode, never a green number that is not
 * there.
 */
export function bestMarketReturn(sandwiches: Sandwich[]): BestMarketReturn {
  let best: Sandwich | null = null;
  let counted = 0;

  for (const sandwich of sandwiches) {
    if (sandwich.pnlPct == null) continue;
    counted += 1;
    // Strict `>` keeps the FIRST of equal returns, so a tie holds the list's
    // chronological order instead of shuffling between renders.
    if (best === null || sandwich.pnlPct > (best.pnlPct ?? Number.NEGATIVE_INFINITY)) {
      best = sandwich;
    }
  }

  return {
    pnlPct: best?.pnlPct ?? null,
    sandwich: best,
    counted,
    total: sandwiches.length,
  };
}
