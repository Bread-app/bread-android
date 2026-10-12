import { isXPostSource } from '@/components/x-post-preview';
import type { Sandwich, SandwichLeg } from '@/lib/api';
import { getSourceAuthorMeta, getSourceVideo } from '@/lib/sandwich-feed';

export type CallAttribution = {
  /** The X account or YouTube channel the call came from, else the Bread creator. */
  name: string;
  avatarUrl: string | null;
  platform: 'x' | 'youtube' | null;
};

/**
 * Who a call belongs to, as Home bylines it: the X account or YouTube channel
 * it was sourced from, falling back to the Bread creator who built it. The
 * asset chart pins the same face, so a row and its pin always agree.
 */
export function callAttribution(sandwich: Sandwich): CallAttribution {
  const handle = sandwich.builder?.username?.trim().replace(/^@+/, '');
  const creator = handle ? `@${handle}` : sandwich.builder?.name?.trim() || 'Bread';
  const video = getSourceVideo(sandwich);
  const author = getSourceAuthorMeta(sandwich);
  const platform = video ? 'youtube' : isXPostSource(sandwich.source) ? 'x' : null;
  return {
    name:
      (video?.channelName ?? null) ||
      (author ? (author.isHandle ? `@${author.name}` : author.name) : null) ||
      creator,
    avatarUrl: video?.channelAvatarUrl ?? author?.avatarUrl ?? sandwich.builder?.avatarUrl ?? null,
    platform,
  };
}

/** The ticker a leg is known by — its underlying, not the wrapper's symbol. */
export function legTicker(leg: SandwichLeg): string {
  return leg.underlyingSymbol ?? leg.symbol ?? leg.label;
}

/** Whether two legs are the same asset: same mint, or same ticker. */
export function legsShareAsset(a: SandwichLeg, b: SandwichLeg): boolean {
  if (a.type !== 'tokenized_stock' || b.type !== 'tokenized_stock') return false;
  if (a.mint && a.mint === b.mint) return true;
  return legTicker(a).trim().toUpperCase() === legTicker(b).trim().toUpperCase();
}
