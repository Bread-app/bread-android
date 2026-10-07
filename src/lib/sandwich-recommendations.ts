import type { Sandwich, SandwichLeg } from "@/lib/api";

/**
 * "Recommended for you" on the sandwich detail screen.
 *
 * Ranked client-side from a page of the public feed: sandwiches that share
 * assets with the one being viewed come first (more shared assets, higher),
 * then the rest of the feed fills in by likes so the row is never empty just
 * because a basket is niche.
 */
export const RECOMMENDED_SANDWICH_LIMIT = 6;

/**
 * Identity keys for a leg. A spot leg is its mint; a prediction leg is its
 * market (and event, so sibling outcomes of one question still match); a perp
 * leg is its ticker, since it often has no mint — the same rule the asset
 * sheet uses to find "sandwiches with this asset".
 */
function legKeys(leg: SandwichLeg): string[] {
  const keys: string[] = [];
  if (leg.mint) keys.push(`mint:${leg.mint}`);
  if (leg.marketId) keys.push(`market:${leg.marketId}`);
  if (leg.eventId) keys.push(`event:${leg.eventId}`);
  // Tickers only for equities: a perp TSLA and a spot TSLAx are the same bet,
  // while a token's symbol can collide with an unrelated stock's.
  const ticker = (leg.underlyingSymbol ?? leg.symbol)?.trim().toUpperCase();
  if (ticker && leg.type === "tokenized_stock") {
    keys.push(`ticker:${ticker.replace(/(ON|X)$/, "") || ticker}`);
  }
  return keys;
}

function sandwichKeys(sandwich: Sandwich): Set<string> {
  const keys = new Set<string>();
  for (const leg of sandwich.legs) for (const key of legKeys(leg)) keys.add(key);
  return keys;
}

/** How many of `candidate`'s legs hold an asset that `target` also holds. */
function sharedLegCount(target: Set<string>, candidate: Sandwich): number {
  let count = 0;
  for (const leg of candidate.legs) {
    if (legKeys(leg).some((key) => target.has(key))) count += 1;
  }
  return count;
}

export function recommendSandwiches(
  current: Sandwich,
  pool: Sandwich[],
  limit = RECOMMENDED_SANDWICH_LIMIT,
): Sandwich[] {
  const target = sandwichKeys(current);
  const seen = new Set<string>([current.id]);
  // An episode's markets share one source; recommending a sibling call from
  // the same video is "more of this", not a recommendation.
  const scored: { sandwich: Sandwich; shared: number }[] = [];
  for (const sandwich of pool) {
    if (seen.has(sandwich.id)) continue;
    if (current.sourceId && sandwich.sourceId === current.sourceId) continue;
    if (sandwich.legs.length === 0) continue;
    seen.add(sandwich.id);
    scored.push({ sandwich, shared: sharedLegCount(target, sandwich) });
  }
  scored.sort(
    (a, b) => b.shared - a.shared || b.sandwich.likeCount - a.sandwich.likeCount,
  );
  return scored.slice(0, limit).map((entry) => entry.sandwich);
}
