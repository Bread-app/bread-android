import type {
  ClosedPosition,
  EnrichedHolding,
  PositionChartLeg,
  PositionDetail,
  PositionFill,
  PublicSandwichHolding,
  Sandwich,
} from '@/lib/api';
import type { PublicPerpPosition } from '@/lib/phoenix-api';
import type { ViewedPosition } from '@/lib/sandwich-detail-store';

/**
 * Position cards for SOMEONE ELSE's profile, built from the rows the screen
 * already holds.
 *
 * `/api/holdings/position-detail` answers only for the signed-in wallet, so a
 * viewer can never fetch another user's detail. Everything the card draws —
 * cost, value, return, the dates, the source — is already on the public
 * position rows, so the sheet opens on the tap with no request in front of it.
 * The Sandwich, fetched in the background, only adds the chart's legs.
 */

/** Chart legs from the Sandwich definition; empty until it has loaded. */
export function chartLegsFromSandwich(sandwich: Sandwich | null | undefined): PositionChartLeg[] {
  if (!sandwich) return [];
  const perp = sandwich.venue === 'perp';
  return sandwich.legs.map((leg) => ({
    id: leg.id,
    type: perp ? 'perp' : leg.type,
    mint: leg.type === 'prediction_market' ? null : leg.mint,
    marketId: leg.type === 'prediction_market' ? (leg.marketId ?? leg.mint) : null,
    symbol: leg.symbol,
    label: leg.label,
    side: leg.side,
    weightBps: leg.weightBps,
  }));
}

function fill(id: string, side: PositionFill['side'], occurredAt: string | null, amountUsd: number | null): PositionFill[] {
  return occurredAt ? [{ id, side, occurredAt, amountUsd, quantity: null, priceUsd: null }] : [];
}

/** A position another user has already closed. */
export function publicClosedPositionDetail(
  position: ClosedPosition,
  sandwich?: Sandwich | null,
): PositionDetail {
  return {
    ...position,
    state: 'closed',
    fills: [
      ...fill(`${position.id}:entry`, 'entry', position.openedAt, position.costUsd),
      ...fill(`${position.id}:exit`, 'exit', position.closedAt, position.proceedsUsd),
    ],
    avgEntryPriceUsd: null,
    avgExitPriceUsd: null,
    chart: {
      openedAt: position.openedAt,
      closedAt: position.closedAt,
      legs: chartLegsFromSandwich(sandwich),
    },
  };
}

/** Figures the sheet reads beside the detail for an OPEN position. */
export type PublicOpenPositionMetrics = {
  currentValueUsd: number | null;
  pnlUsd: number | null;
  /** Percent, not fraction: 40 is +40%. */
  pnlPct: number | null;
};

function openDetail(
  base: Omit<PositionDetail, 'state' | 'closedAt' | 'proceedsUsd' | 'realizedPnlUsd' | 'realizedPnlPct' | 'reason' | 'avgExitPriceUsd'>,
): PositionDetail {
  return {
    ...base,
    state: 'open',
    closedAt: null,
    proceedsUsd: null,
    realizedPnlUsd: null,
    realizedPnlPct: null,
    reason: null,
    avgExitPriceUsd: null,
  };
}

/** A Sandwich another user still holds. */
export function publicOpenSandwichDetail(
  holding: PublicSandwichHolding,
  sandwich?: Sandwich | null,
): { detail: PositionDetail; metrics: PublicOpenPositionMetrics } {
  return {
    detail: openDetail({
      kind: holding.venue === 'perp' ? 'sandwich_perp' : 'sandwich_spot',
      id: holding.id,
      title: holding.title,
      subtitle: holding.subtitle,
      logoUri: holding.logoUri,
      symbols: holding.symbols,
      mint: null,
      sandwichId: holding.sandwichId,
      openedAt: holding.openedAt,
      costUsd: holding.costUsd,
      leverage: holding.leverage,
      sandwich: holding.sandwich,
      fills: fill(`${holding.id}:entry`, 'entry', holding.openedAt, holding.costUsd),
      avgEntryPriceUsd: null,
      chart: { openedAt: holding.openedAt, closedAt: null, legs: chartLegsFromSandwich(sandwich) },
    }),
    metrics: {
      currentValueUsd: holding.valueUsd,
      pnlUsd: holding.unrealizedPnlUsd,
      pnlPct: holding.unrealizedPnlPct === null ? null : holding.unrealizedPnlPct * 100,
    },
  };
}

/**
 * A Phoenix perp another user holds. Their margin is not public, so the return
 * is on notional at entry — the same basis the row's PnL is.
 */
export function publicOpenPerpDetail(
  position: PublicPerpPosition,
): { detail: PositionDetail; metrics: PublicOpenPositionMetrics } {
  const size = Math.abs(position.positionSize);
  const side = position.positionSize < 0 ? 'short' : 'long';
  const entryNotional = size * position.entryPrice;
  const id = `perp:${position.symbol}`;
  return {
    detail: openDetail({
      kind: 'phoenix_perp',
      id,
      title: position.name ?? position.symbol,
      subtitle: `${position.symbol} ${side.toUpperCase()}`,
      logoUri: position.logoUri ?? position.iconUri ?? null,
      symbols: [position.symbol],
      mint: null,
      sandwichId: null,
      openedAt: null,
      costUsd: entryNotional > 0 ? entryNotional : null,
      leverage: null,
      sandwich: null,
      fills: [],
      avgEntryPriceUsd: position.entryPrice > 0 ? position.entryPrice : null,
      chart: {
        openedAt: null,
        closedAt: null,
        legs: [{
          id,
          type: 'perp',
          mint: null,
          marketId: null,
          symbol: position.symbol,
          label: position.name ?? position.symbol,
          side,
          weightBps: 10_000,
        }],
      },
    }),
    metrics: {
      currentValueUsd: Math.abs(position.positionValue),
      pnlUsd: position.unrealizedPnl,
      pnlPct: entryNotional > 0 ? (position.unrealizedPnl / entryNotional) * 100 : null,
    },
  };
}

/** A token (stock, ETF, crypto) another user holds. */
export function publicOpenTokenDetail(
  holding: EnrichedHolding,
): { detail: PositionDetail; metrics: PublicOpenPositionMetrics } {
  const { stock } = holding;
  const id = `token:${holding.mint}`;
  const pnlUsd =
    holding.valueUsd != null && holding.costUsd != null ? holding.valueUsd - holding.costUsd : null;
  return {
    detail: openDetail({
      kind: 'token',
      id,
      title: stock.name,
      subtitle: stock.symbol,
      logoUri: stock.icon ?? null,
      symbols: [stock.symbol],
      mint: holding.mint,
      sandwichId: null,
      openedAt: null,
      costUsd: holding.costUsd,
      leverage: null,
      sandwich: null,
      // A quantity-only entry, so the sheet can price "Current" per unit.
      fills: holding.units > 0
        ? [{ id: `${id}:entry`, side: 'entry', occurredAt: '', amountUsd: holding.costUsd, quantity: holding.units, priceUsd: null }]
        : [],
      avgEntryPriceUsd:
        holding.costUsd != null && holding.units > 0 ? holding.costUsd / holding.units : null,
      chart: {
        openedAt: null,
        closedAt: null,
        legs: [{
          id,
          type: 'tokenized_stock',
          mint: holding.mint,
          marketId: null,
          symbol: stock.symbol,
          label: stock.name,
          side: 'long',
          weightBps: 10_000,
        }],
      },
    }),
    metrics: {
      currentValueUsd: holding.valueUsd,
      pnlUsd,
      pnlPct: pnlUsd != null && holding.costUsd ? (pnlUsd / holding.costUsd) * 100 : null,
    },
  };
}

/**
 * Another user's open holding in the shape the Sandwich detail screen shows
 * beside the post, valued with the figures their profile row already carried.
 */
export function viewedPositionFromHolding(holding: PublicSandwichHolding): ViewedPosition {
  return {
    position: {
      id: holding.id,
      sandwichId: holding.sandwichId,
      name: holding.title,
      summary: holding.sandwich?.summary ?? holding.title,
      investedUsd: holding.costUsd,
      createdAt: holding.openedAt,
      updatedAt: holding.openedAt,
      pendingSync: false,
      strictAtomic: false,
      legs: [],
    },
    valuation: {
      costUsd: holding.costUsd,
      valueUsd: holding.valueUsd,
      pnlUsd: holding.unrealizedPnlUsd,
      returnPct: holding.unrealizedPnlPct === null ? null : holding.unrealizedPnlPct * 100,
    },
  };
}
