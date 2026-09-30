/**
 * Display adapters for perp Sandwich positions.
 *
 * A perp Sandwich holds exactly one leg (`MAX_PERP_SANDWICH_LEGS`), so it can be
 * rendered by the same surfaces that already show a standalone Phoenix
 * position — the chart, the share card, the SL/TP editor. Mapping here rather
 * than forking those components keeps one design for "an open perp position",
 * which is what it is from the user's side; the only difference is where it came
 * from, and that travels alongside as `PerpSandwichContext`.
 */

import type { PerpSandwichPosition } from '@/lib/api';
import type { PhoenixPosition } from '@/lib/phoenix-api';

/** Provenance shown around the position: the podcast moment that produced it. */
export type PerpSandwichContext = {
  positionId: string;
  sandwichId: string;
  /** Prefers the moment's headline; falls back to the Sandwich's name. */
  title: string;
  speakerName: string | null;
  /** Deep link into the source video at the moment, when there is one. */
  sourceUrl: string | null;
  /** Offset into the episode. Null for any non-podcast source. */
  startMs: number | null;
  side: 'long' | 'short';
  leverage: number | null;
  mint: string | null;
  symbol: string;
  /**
   * Isolated child the leg was opened into.
   *
   * A Sandwich leg does not live in the parent cross account, and the cross
   * account may well hold a *different* position in the same symbol. Anything
   * re-reading this position from `/account` has to look in the right holder.
   */
  subaccountIndex: number | null;
};

/** `1:04:12` past an hour, `12:34` below it. Never renders a bare `0:00`. */
export function formatTimestamp(startMs: number | null | undefined): string | null {
  if (typeof startMs !== 'number' || !Number.isFinite(startMs) || startMs < 0) return null;
  const totalSeconds = Math.floor(startMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * A YouTube link that opens at the moment, when the source is a video.
 *
 * Built from the stored url rather than the bare video id so a source that is
 * already a full watch/share link keeps whatever form it was ingested in.
 */
export function momentDeepLink(position: PerpSandwichPosition): string | null {
  const { source } = position.sandwich;
  const base = source.url ?? (source.videoId ? `https://www.youtube.com/watch?v=${source.videoId}` : null);
  if (!base) return null;
  if (source.startMs === null) return base;
  const seconds = Math.max(0, Math.floor(source.startMs / 1000));
  return `${base}${base.includes('?') ? '&' : '?'}t=${seconds}`;
}

export function perpSandwichContext(position: PerpSandwichPosition): PerpSandwichContext | null {
  const leg = position.legs[0];
  if (!leg) return null;
  return {
    positionId: position.id,
    sandwichId: position.sandwich.id,
    // The headline is the speaker's actual claim; the Sandwich name is a
    // generated label. Prefer the claim, but never render an empty string.
    title: position.sandwich.headline?.trim() || position.sandwich.name,
    speakerName: position.sandwich.speakerName,
    sourceUrl: momentDeepLink(position),
    startMs: leg.startMs ?? position.sandwich.source.startMs,
    side: leg.side === 'short' ? 'short' : 'long',
    leverage: position.leverage,
    mint: leg.mint,
    symbol: leg.symbol,
    subaccountIndex: leg.subaccountIndex,
  };
}

/**
 * Present a perp Sandwich as the Phoenix position it is on chain.
 *
 * `positionSize` carries the side as its sign, which is the contract every
 * consumer of `PhoenixPosition` already relies on — a short whose size came
 * through positive would be drawn, and have its stop placed, as a long. When the
 * live read is unavailable the stored side still decides the sign, so the sheet
 * degrades to stale numbers rather than to a wrong direction.
 */
export function phoenixPositionFromPerpSandwich(
  position: PerpSandwichPosition,
): PhoenixPosition | null {
  const leg = position.legs[0];
  if (!leg) return null;
  const signedSize =
    leg.positionSize !== 0
      ? leg.positionSize
      : 0;
  return {
    symbol: leg.symbol,
    name: position.sandwich.headline?.trim() || position.sandwich.name,
    leverage: position.leverage,
    marginUsd: leg.marginUsdc ?? position.marginUsdc,
    positionSize: signedSize,
    entryPrice: leg.entryPrice ?? 0,
    positionValue: leg.notionalUsd ?? 0,
    unrealizedPnl: leg.unrealizedPnlUsd,
    initialMargin: leg.marginUsdc ?? 0,
    maintenanceMargin: 0,
    liquidationPrice: leg.liquidationPrice,
    unsettledFunding: leg.unsettledFundingUsd,
    accumulatedFunding: leg.accumulatedFundingUsd ?? 0,
    takeProfitPrice: null,
    stopLossPrice: leg.stopLossPrice,
  };
}
