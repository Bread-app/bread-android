/**
 * Client-side mirrors of the perp risk math the backend actually executes.
 *
 * Every function here has a named counterpart in
 * `stock-backend/lib/server/phoenix/trade.ts` (or `markets.ts`). They exist so a
 * pad can show live liquidation/stop numbers *before* the server quote comes
 * back, and they are transcriptions rather than re-derivations: if the number on
 * screen disagrees with the preview the user signs, the pad is lying about the
 * risk of the position.
 *
 * The one deliberate difference: the server throws where a value is
 * uncomputable, this returns `null`, because a pad renders "—" while the user is
 * still dragging a slider.
 */

import type { PhoenixLeverageTier } from '@/lib/phoenix-api';

/** trade.ts: LIQUIDATION_SAFETY_SHARE — share of the mark→liq gap a stop must leave. */
export const LIQUIDATION_SAFETY_SHARE = 0.2;
/** trade.ts: MIN_STOP_LOSS_PCT. */
export const MIN_STOP_LOSS_PCT = 0.1;
/** trade.ts: MIN_MARGIN_USD. */
export const MIN_MARGIN_USD = 1;
/** trade.ts: MAX_MARGIN_USD. */
export const MAX_MARGIN_USD = 100_000;
/**
 * trade.ts: the `Math.max(0.1, estimatedTakerFeeUsd)` floor the entry funds on
 * top of the margin. An entry deposits margin *plus* fees, so a wallet holding
 * exactly the margin is always short — which is what
 * `phoenix_insufficient_cash` was firing on.
 */
export const PERP_ENTRY_MIN_FEE_BUFFER_USD = 0.1;

/**
 * Leverage the market will accept for a position of `baseLots`.
 *
 * Mirrors `markets.ts:maxLeverageForSize`. Leverage is tiered by size and
 * collapses hard past tier 1 (AAPL is 20x, then 1x), so `market.maxLeverage` —
 * the headline, tier-1 number — is not what the chain enforces.
 */
export function maxLeverageForSize(tiers: PhoenixLeverageTier[], baseLots: number): number {
  for (const tier of tiers) {
    if (baseLots <= tier.maxSizeBaseLots) return tier.maxLeverage;
  }
  return tiers.at(-1)?.maxLeverage ?? 1;
}

/**
 * Pre-trade liquidation estimate — mirrors Rise SDK's
 * `calculateLiquidationPriceUsd` and `trade.ts:projectedLiquidationPrice`.
 *
 * User leverage sizes the position. The size tier's max leverage determines
 * initial margin, then Phoenix's separate maintenance factor determines where
 * liquidation begins. Treating max leverage as maintenance incorrectly made a
 * valid 25x position appear to have zero liquidation distance.
 */
export function projectedLiquidationPrice(options: {
  side: 'long' | 'short';
  markPrice: number;
  leverage: number;
  maxLeverage: number;
  maintenanceMarginBps: number;
}): number | null {
  const { side, markPrice, leverage, maxLeverage, maintenanceMarginBps } = options;
  if (!Number.isFinite(markPrice) || markPrice <= 0) return null;
  if (!Number.isFinite(leverage) || leverage <= 0 || leverage > maxLeverage) return null;
  if (
    !Number.isFinite(maintenanceMarginBps) ||
    maintenanceMarginBps <= 0 ||
    maintenanceMarginBps > 10_000
  ) {
    return null;
  }

  // Algebraically identical to the Rise SDK closed-form equation with $1 of
  // fresh collateral and no other positions/orders in the account.
  const signedPositionSize = (side === 'long' ? 1 : -1) * (leverage / markPrice);
  const maintenanceRatio = maintenanceMarginBps / 10_000 / maxLeverage;
  const numerator = 1 - markPrice * signedPositionSize;
  const denominator = Math.abs(signedPositionSize) * maintenanceRatio - signedPositionSize;
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-12) return null;
  const price = numerator / denominator;
  return Number.isFinite(price) && price > 0 ? price : null;
}

/**
 * Largest `stopLossPct` the server will accept at this leverage.
 *
 * Mirrors the inequality in `trade.ts:stopPriceWithSafety`: the stop must leave
 * at least {@link LIQUIDATION_SAFETY_SHARE} of the mark→liquidation gap. That
 * gap is calculated from Phoenix's size-tier leverage and maintenance risk
 * factor, so any stop control must be clamped to this derived ceiling.
 */
export function maxStopLossPct(
  leverage: number,
  maxLeverage: number,
  maintenanceMarginBps: number,
  side: 'long' | 'short',
): number {
  const markPrice = 100;
  const liquidationPrice = projectedLiquidationPrice({
    side,
    markPrice,
    leverage,
    maxLeverage,
    maintenanceMarginBps,
  });
  return maxStopLossPctFromLiquidation(markPrice, liquidationPrice) ?? 0;
}

/**
 * Highest whole-x leverage that still leaves room for the mandatory stop on
 * both long and short entries. With ordinary Phoenix maintenance factors this
 * is the market's full advertised maximum; the loop remains fail-closed for a
 * future market whose maintenance threshold is unusually tight.
 */
export function selectableMaxLeverage(
  maxLeverage: number,
  maintenanceMarginBps: number | null,
): number {
  if (!Number.isFinite(maxLeverage) || maxLeverage <= 1) return 1;
  if (
    maintenanceMarginBps === null ||
    !Number.isFinite(maintenanceMarginBps) ||
    maintenanceMarginBps <= 0 ||
    maintenanceMarginBps > 10_000
  ) {
    return 1;
  }
  for (let leverage = Math.floor(Math.min(maxLeverage, 100)); leverage > 1; leverage--) {
    const longCeiling = maxStopLossPct(
      leverage,
      maxLeverage,
      maintenanceMarginBps,
      'long',
    );
    const shortCeiling = maxStopLossPct(
      leverage,
      maxLeverage,
      maintenanceMarginBps,
      'short',
    );
    if (Math.min(longCeiling, shortCeiling) >= MIN_STOP_LOSS_PCT) return leverage;
  }
  return 1;
}

/**
 * Base lots a leg's notional works out to — the input `maxLeverageForSize` tiers on.
 * Mirrors the sizing in `trade.ts:buildPhoenixBasketOrderTransaction`.
 */
export function notionalToBaseLots(options: {
  notionalUsd: number;
  markPrice: number;
  baseLotsDecimals: number;
}): number | null {
  const { notionalUsd, markPrice, baseLotsDecimals } = options;
  if (!Number.isFinite(markPrice) || markPrice <= 0) return null;
  if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) return null;
  return Math.floor((notionalUsd / markPrice) * 10 ** baseLotsDecimals);
}

/**
 * Wallet USDC a perp Sandwich entry will actually move — mirrors the deposit
 * sizing at the end of `trade.ts:buildPhoenixBasketOrderTransaction`.
 *
 * The entry is one atomic transaction that deposits collateral *before* it opens
 * anything, and it tops up to `margin + fees` rather than depositing the margin
 * flat. Two consequences the pad has to show, because both produced failures
 * that only surfaced after the user tapped Open:
 *
 * 1. Collateral already sitting in the Phoenix parent counts, so the wallet is
 *    debited only the shortfall — often far less than the margin, and sometimes
 *    nothing at all. Gating on the raw margin would refuse an entry the server
 *    would have accepted.
 * 2. The fee buffer is real money on top of the margin, so a wallet holding
 *    exactly the margin fails. Gating without it produced
 *    `phoenix_insufficient_cash` at, for example, $100.34 needed against a
 *    $100.00 request.
 *
 * `availableMarginUsd` is the caller's `max(0, effectiveCollateral −
 * initialMargin)` on the Phoenix parent, and 0 whenever that read is missing —
 * unknown collateral must never loosen the gate.
 */
export function perpEntryCashRequirement(options: {
  marginUsd: number;
  /** Σ per-leg `notionalUsd × market.takerFee`. 0 when no market is loaded yet. */
  estimatedTakerFeeUsd: number;
  availableMarginUsd: number;
}): { feeBufferUsd: number; targetAvailableUsd: number; cashMovedUsd: number } {
  const marginUsd = Number.isFinite(options.marginUsd) ? Math.max(0, options.marginUsd) : 0;
  const fees = Number.isFinite(options.estimatedTakerFeeUsd)
    ? Math.max(0, options.estimatedTakerFeeUsd)
    : 0;
  const available = Number.isFinite(options.availableMarginUsd)
    ? Math.max(0, options.availableMarginUsd)
    : 0;

  const feeBufferUsd = Math.max(PERP_ENTRY_MIN_FEE_BUFFER_USD, fees);
  const targetAvailableUsd = marginUsd + feeBufferUsd;
  return {
    feeBufferUsd,
    targetAvailableUsd,
    cashMovedUsd: Math.max(0, targetAvailableUsd - available),
  };
}

/**
 * Largest `stopLossPct` that still clears a *known* liquidation price.
 *
 * The leverage-derived {@link maxStopLossPct} is only available before a
 * position exists; once it is open the account reports its real liquidation
 * price, which has since moved with funding, fees and any collateral top-up.
 * This is the same inequality — `stopDistance ≤ liqDistance × (1 − safety)` —
 * read off that reported price instead of re-deriving it from leverage.
 *
 * Mirrors `trade.ts:stopPriceWithSafety`, which is the rule the entry path
 * enforces and the rule `buildPhoenixTpSlTransaction` now enforces too. A stop
 * set past liquidation is not merely risky: it is a dead order, because the
 * liquidation engine reaches the price first and there is no position left for
 * the trigger to close.
 */
export function maxStopLossPctFromLiquidation(
  markPrice: number | null,
  liquidationPrice: number | null,
): number | null {
  if (markPrice === null || !Number.isFinite(markPrice) || markPrice <= 0) return null;
  if (liquidationPrice === null || !Number.isFinite(liquidationPrice) || liquidationPrice <= 0) {
    return null;
  }
  const liquidationDistance = Math.abs(liquidationPrice - markPrice) / markPrice;
  const ceiling = liquidationDistance * (1 - LIQUIDATION_SAFETY_SHARE) * 100;
  return Number.isFinite(ceiling) && ceiling > 0 ? ceiling : 0;
}

/**
 * The tier maximum that actually binds a prospective position.
 *
 * `market.maxLeverage` is the tier-1 headline and is **not** what the chain
 * enforces: leverage is tiered by size and collapses hard past the first tier
 * (`maxLeverageForSize`). The binding tier controls initial margin and is also
 * an input to Phoenix's maintenance ratio, so a pad that reads only the
 * headline can report a liquidation price further away than the real one.
 *
 * Falls back to the headline when the size cannot be computed yet, which is
 * exactly the moment no size has been chosen either.
 */
export function bindingMaxLeverage(options: {
  market: { leverageTiers: PhoenixLeverageTier[]; baseLotsDecimals: number; maxLeverage: number };
  notionalUsd: number;
  markPrice: number | null;
}): number {
  const { market, notionalUsd, markPrice } = options;
  if (markPrice === null) return market.maxLeverage;
  const baseLots = notionalToBaseLots({
    notionalUsd,
    markPrice,
    baseLotsDecimals: market.baseLotsDecimals,
  });
  if (baseLots === null) return market.maxLeverage;
  return maxLeverageForSize(market.leverageTiers, baseLots);
}

/**
 * Everything a pad needs to state the risk of a position that does not exist yet.
 *
 * One function because the numbers have to agree: the order ticket and the Auto
 * Close screen sit on top of each other showing the same trade, and they used to
 * disagree because each surface used a different approximation. Neither pad
 * computes this any more; both receive the same maintenance-aware projection.
 *
 * `liquidationPrice` is null when the inputs cannot support an honest answer —
 * never a fallback guess. `maxStopPct` is null for the same reason, and 0 when
 * the safe band is genuinely closed, which the caller must render differently:
 * "not known yet" and "no legal stop exists" are different facts.
 */
export function entryRisk(options: {
  side: 'long' | 'short';
  markPrice: number | null;
  leverage: number;
  notionalUsd: number;
  market: {
    leverageTiers: PhoenixLeverageTier[];
    baseLotsDecimals: number;
    maxLeverage: number;
    maintenanceMarginBps: number | null;
  } | null;
}): { maxLeverage: number | null; liquidationPrice: number | null; maxStopPct: number | null } {
  const { side, markPrice, leverage, notionalUsd, market } = options;
  if (market === null || markPrice === null || !Number.isFinite(markPrice) || markPrice <= 0) {
    return { maxLeverage: null, liquidationPrice: null, maxStopPct: null };
  }
  const maxLeverage = bindingMaxLeverage({ market, notionalUsd, markPrice });
  if (!Number.isFinite(maxLeverage) || leverage > maxLeverage) {
    return { maxLeverage, liquidationPrice: null, maxStopPct: 0 };
  }
  if (market.maintenanceMarginBps === null) {
    return { maxLeverage, liquidationPrice: null, maxStopPct: null };
  }
  const liquidationPrice = projectedLiquidationPrice({
    side,
    markPrice,
    leverage,
    maxLeverage,
    maintenanceMarginBps: market.maintenanceMarginBps,
  });
  return {
    maxLeverage,
    liquidationPrice,
    maxStopPct: maxStopLossPctFromLiquidation(markPrice, liquidationPrice),
  };
}

/**
 * What a trigger level books, in dollars and as a return on the user's cash.
 *
 * `units × (trigger − entry)`, signed by side — **not** `notional × move%`.
 * Notional is quoted at the live mark while the money is booked against the
 * entry, so the percentage form carries a hidden `mark / entry` factor: a
 * position already 20% in profit promised 20% more at its take profit than it
 * would actually pay, and 20% more loss at its stop. The two forms agree on a
 * position that has not moved, which is why the error only ever appeared on
 * open positions and never on a fresh entry.
 *
 * `returnPercent` is against **collateral**, not notional. The ruler's
 * percentage is a *price* move; on a 5x position that is a fifth of what
 * happens to the user's money, and it is their money they are deciding about.
 */
export function triggerOutcome(options: {
  side: 'long' | 'short';
  /** Units held. For a prospective entry, `notionalUsd / fillPrice`. */
  quantity: number | null;
  /** Price the PnL is booked against: the entry, or the fill price of an entry. */
  basisPrice: number | null;
  triggerPrice: number | null;
  /** Collateral behind the position. Null when it is not known. */
  marginUsd: number | null;
}): { pnlUsd: number | null; returnPercent: number | null } {
  const { side, quantity, basisPrice, triggerPrice, marginUsd } = options;
  if (
    quantity === null ||
    basisPrice === null ||
    triggerPrice === null ||
    !(quantity > 0) ||
    !(basisPrice > 0) ||
    !Number.isFinite(triggerPrice)
  ) {
    return { pnlUsd: null, returnPercent: null };
  }
  const move = triggerPrice - basisPrice;
  const pnlUsd = quantity * (side === 'long' ? move : -move);
  const returnPercent =
    marginUsd !== null && marginUsd > 0 ? (pnlUsd / marginUsd) * 100 : null;
  return { pnlUsd, returnPercent };
}
