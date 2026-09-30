/** The bits of a stored leg and a wallet token this valuation actually reads. */
export type ValuedLeg = {
  kind?: 'swap' | 'prediction';
  investedUsd: number | null;
  /** USDC smallest units originally sent for this leg, on older rows. */
  inputAmount: string | null;
  /** Token base units bought for this particular position. */
  outputAmount?: string | null;
  decimals?: number | null;
};

export type ValuedToken = {
  balance: number;
  /** The mint's on-chain decimals, when the wallet read reported them. */
  decimals?: number | null;
  /** Null when the wallet feed knows the balance but not what it is worth. */
  usdValue: number | null;
};

export type PositionValuation = {
  costUsd: number;
  valueUsd: number;
  pnlUsd: number;
  returnPct: number | null;
};

/**
 * Value the units this position acquired, capped by the wallet's current
 * balance. This keeps a late buyer's return anchored to their own fill while
 * still preventing two positions that share a mint from each claiming the
 * wallet's whole balance.
 */
export function valueSandwichPosition(
  legs: ValuedLeg[],
  tokensByMint: Map<string, ValuedToken>,
  balancesKnown: boolean,
  mints: string[],
): PositionValuation {
  let costUsd = 0;
  let valueUsd = 0;

  for (let index = 0; index < legs.length; index += 1) {
    const leg = legs[index];
    const cost = leg.investedUsd ?? (() => {
      const input = Number(leg.inputAmount);
      return Number.isFinite(input) && input > 0 ? input / 1_000_000 : 0;
    })();
    costUsd += cost;
    // Prediction positions do not expose token units in the wallet feed. Their
    // live settlement is handled by that venue, so retain the entry basis here
    // instead of treating a missing mint balance as a zero-value stock leg.
    if (leg.kind === 'prediction') {
      valueUsd += cost;
      continue;
    }
    const token = tokensByMint.get(mints[index]);
    const raw = leg.outputAmount;
    // The wallet row's decimals come straight from the token account, so they
    // stand in for a leg synced from the backend, which never stores them.
    const decimals = leg.decimals ?? token?.decimals ?? null;
    if (
      token && token.balance > 0 && token.usdValue !== null &&
      raw && /^\d+$/.test(raw) && decimals != null && decimals >= 0
    ) {
      const acquired = Number(BigInt(raw)) / 10 ** decimals;
      const price = token.usdValue / token.balance;
      valueUsd += Math.min(acquired, token.balance) * price;
      continue;
    }
    // Old rows lack the received quantity. Retain their cost until they are
    // refreshed; importantly, never apply the sandwich's pre-entry return.
    valueUsd += sandwichLegValueUsd(leg, token ?? null, balancesKnown);
  }

  const pnlUsd = valueUsd - costUsd;
  return {
    costUsd,
    valueUsd,
    pnlUsd,
    returnPct: costUsd > 0 ? (pnlUsd / costUsd) * 100 : null,
  };
}

/**
 * What one sandwich leg is worth right now.
 *
 * The cost-basis fallback below exists for a real failure — a price source
 * blinking out must not blank a position the user still holds — but it is only
 * ever correct for an UNKNOWN balance, never for one known to be zero.
 *
 * `balancesKnown` is that distinction, and without it a fully-exited sandwich
 * was immortal. The wallet held none of the legs, so every leg valued at zero
 * and each one fell through to what the user originally paid; the row rendered
 * at its purchase price, was mirrored back up to the backend on the next
 * profile load, and returned even after the position had been deleted.
 *
 * The wallet is ground truth here, deliberately. A stored position row can
 * desync for many reasons — legs sold one at a time from the asset sheet, an
 * exit taken on another device, a sell whose bookkeeping never ran — and keying
 * off the balance corrects all of them at once, instead of one cause at a time.
 */
export function sandwichLegValueUsd(
  leg: ValuedLeg,
  token: ValuedToken | null,
  balancesKnown: boolean,
): number {
  const live = token?.usdValue ?? 0;
  if (live > 0) return live;

  // Balances loaded and this mint is absent or empty: the user does not hold
  // it. That is not a price failure, so there is nothing to fall back to.
  if (balancesKnown && (token === null || token.balance <= 0)) return 0;

  if (leg.investedUsd !== null && leg.investedUsd > 0) return leg.investedUsd;

  // Older synced positions can carry the USDC input amount but no explicit
  // investedUsd. Recover that cost basis rather than filtering the row as dust.
  const inputAmount = Number(leg.inputAmount);
  return Number.isFinite(inputAmount) && inputAmount > 0 ? inputAmount / 1_000_000 : 0;
}

/**
 * The sandwich's own return: its legs' weighted move since the sandwich was
 * created, priced by the backend. `null` when it could not be priced, which is
 * shown as a missing figure rather than as a flat zero.
 */
export function sandwichSinceReturnPct(
  sandwich:
    | { pnlPct: number | null; pnlStatus: 'live' | 'partial' | 'unavailable' }
    | null
    | undefined,
): number | null {
  if (!sandwich || sandwich.pnlStatus === 'unavailable') return null;
  const pct = sandwich.pnlPct;
  return pct !== null && Number.isFinite(pct) ? pct : null;
}

/**
 * What a holding is worth: what the viewer put in, moved by the sandwich's own
 * return.
 *
 * Wallet balances are deliberately not consulted. A leg's wallet value covers
 * EVERY source of that mint — a second sandwich sharing the leg, a standalone
 * buy, an earlier separate entry — so each position claiming it valued itself
 * at the whole lot and printed returns in the hundreds of percent. Deriving the
 * value from the one number the sandwich already publishes also means a holding
 * can never disagree with the percentage shown above it.
 *
 * The window is since the sandwich was CREATED, not since this buy, so a late
 * entry is credited with the move it missed. Callers wanting a true per-entry
 * return need the tokens received per leg, which positions do not record.
 */
export function sandwichHoldingValueUsd(
  investedUsd: number | null,
  returnPct: number | null,
): number {
  const invested = investedUsd ?? 0;
  if (returnPct === null || !Number.isFinite(returnPct)) return invested;
  return Math.max(0, invested * (1 + returnPct / 100));
}
