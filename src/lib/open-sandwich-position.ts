import { isXPostSource } from '@/components/x-post-preview';
import { getBuilderTake, getSourcePostText } from '@/lib/sandwich-feed';
import type {
  PositionDetail,
  Sandwich,
  SandwichProvenance,
} from '@/lib/api';
import { getMomentWindow } from '@/lib/moment';
import type { SandwichPosition } from '@/lib/sandwich-positions';

/**
 * Build the position card from the Holdings row we already have.
 *
 * A freshly bought (or locally recovered) Sandwich can appear in Holdings
 * before its server-side position ledger is available. Taps must not depend on
 * that eventual sync: this snapshot is complete enough to draw and share the
 * selected position immediately, while the screen hydrates richer fill data in
 * the background when it exists.
 */
export function optimisticOpenSandwichPositionDetail(options: {
  position: SandwichPosition;
  sandwich?: Sandwich | null;
  provenance?: SandwichProvenance | null;
}): PositionDetail {
  const { position, sandwich = null, provenance = null } = options;
  const openedAt = position.createdAt || null;
  const headline = provenance?.headline?.trim() || position.summary.trim() || position.name;
  const costUsd = position.investedUsd;
  const sandwichMoment = sandwich ? getMomentWindow(sandwich) : null;

  return {
    kind: 'sandwich_spot',
    id: position.id,
    title: headline,
    subtitle: provenance?.speakerName?.trim() || null,
    logoUri: position.legs.find((leg) => leg.imageUrl)?.imageUrl ?? null,
    symbols: position.legs.flatMap((leg) => (leg.symbol ? [leg.symbol] : [])),
    mint: null,
    sandwichId: position.sandwichId,
    openedAt,
    closedAt: null,
    costUsd,
    proceedsUsd: null,
    realizedPnlUsd: null,
    realizedPnlPct: null,
    reason: null,
    leverage: null,
    sandwich: {
      headline,
      thesisText: sandwich
        ? (isXPostSource(sandwich.source) ? getSourcePostText(sandwich) : '') ||
          getBuilderTake(sandwich) ||
          null
        : null,
      speakerName: provenance?.speakerName ?? null,
      summary: position.summary,
      sourceId: provenance?.sourceId ?? null,
      sourceType: provenance?.source.sourceType ?? sandwich?.source.sourceType ?? null,
      sourceUrl: provenance?.source.url ?? sandwich?.source.sourceUrl ?? null,
      videoId: provenance?.source.videoId ?? sandwich?.source.videoId ?? null,
      startMs: provenance?.source.startMs ?? sandwichMoment?.startMs ?? null,
      endMs: provenance?.source.endMs ?? sandwichMoment?.endMs ?? null,
      authorHandle: provenance?.source.authorHandle ?? sandwich?.source.authorHandle ?? null,
      authorName: provenance?.source.authorName ?? sandwich?.source.authorName ?? null,
      authorAvatarUrl: sandwich?.source.authorAvatarUrl ?? null,
      builderName: sandwich?.builder?.name ?? null,
      builderUsername: sandwich?.builder?.username ?? null,
      builderAvatarUrl: sandwich?.builder?.avatarUrl ?? null,
      legIcons: position.legs.map((leg) => leg.imageUrl),
    },
    state: 'open',
    fills: openedAt
      ? [{
          id: `${position.id}:entry`,
          side: 'entry',
          occurredAt: openedAt,
          amountUsd: costUsd,
          quantity: null,
          priceUsd: null,
        }]
      : [],
    avgEntryPriceUsd: null,
    avgExitPriceUsd: null,
    chart: {
      openedAt,
      closedAt: null,
      legs: position.legs.map((leg) => ({
        id: leg.legId,
        type: leg.kind === 'prediction' ? 'prediction_market' : 'tokenized_stock',
        mint: leg.kind === 'prediction' ? null : leg.mint,
        marketId: leg.kind === 'prediction' ? (leg.marketId ?? leg.mint) : null,
        symbol: leg.symbol,
        label: leg.label,
        side: leg.kind === 'prediction' ? (leg.isYes === false ? 'no' : 'yes') : 'long',
        weightBps: leg.weightBps,
      })),
    },
  };
}
