import type { PerpSandwichPosition } from '@/lib/api';

/** Collateral below this is rent-sized dust, not a holding. */
const COLLATERAL_DUST_USD = 0.01;

/**
 * Whether a perp Sandwich row represents money that is actually at Phoenix.
 *
 * A `PerpSandwichPosition` row is created the moment a quote starts being
 * built, long before anything is signed — so most of its lifecycle states are
 * *paperwork*, not exposure: `building`, `allocated`, `registered`, and the
 * three `*_awaiting_signature` states all mean "a transaction was prepared and
 * the user never signed it". Nothing was opened, no collateral moved, and the
 * row simply stays that way forever if the user backs out of the sheet.
 *
 * Holdings used to hide these with a denylist of dead statuses, which meant
 * every prep state leaked through as a $0.00 row with no PnL and no tappable
 * action — a position the user never opened, sitting in their portfolio.
 * An allowlist is the only version that stays correct as statuses are added.
 *
 * Fails *open* on an unknown collateral figure: a failed Phoenix read must
 * never hide real money.
 */
export function hasLivePerpSandwichExposure(
  position: Pick<
    PerpSandwichPosition,
    'status' | 'effectiveCollateralUsd' | 'collateralBalanceUsd'
  >,
): boolean {
  // Exposure is live and closable — show it even if the account read failed
  // and every figure on the row is a fallback.
  if (position.status === 'open') return true;
  // `closed` is the one exit state that can still hold money: legs are flat but
  // the collateral sits at Phoenix until the user withdraws it. Everything else
  // (`failed`, `withdrawn`, `stopped_out`, `liquidated`) is settled, and every
  // prep state never started.
  if (position.status !== 'closed') return false;

  const collateral = position.effectiveCollateralUsd ?? position.collateralBalanceUsd;
  // Unknown, not zero — the read did not come back, so keep the row.
  if (collateral === null || collateral === undefined) return true;
  return collateral >= COLLATERAL_DUST_USD;
}
