import type {
  ClosedPosition,
  PositionChartLeg,
  PositionDetail,
  PositionFill,
  PublicSandwichHolding,
  Sandwich,
} from '@/lib/api';
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
