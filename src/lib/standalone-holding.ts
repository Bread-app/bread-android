import { useEffect, useState } from 'react';

import type { CostBasisEntry } from './cost-basis';
import { getStoredSandwichPositions, type SandwichPosition } from './sandwich-positions';

/**
 * How much of a mint the user holds as the asset ITSELF — bought on its own
 * page — as opposed to as a leg of a Sandwich.
 *
 * The wallet balance cannot tell the two apart: a ZEC leg bought inside a
 * basket is the same token as ZEC bought directly. Reading the balance put
 * "Invested $X" and a Sell button on the ZEC page for a user who only ever
 * bought a Sandwich containing ZEC, and a sale from there would have quietly
 * gutted that Sandwich. The basket's units are reported, and sold, on the
 * Sandwich.
 *
 * Sources, most authoritative first:
 *  1. the server ledger's standalone split (`standaloneQty`), which tags every
 *     basket leg the execution engine filled;
 *  2. otherwise the balance, less this device's stored Sandwich legs of the
 *     mint (legs older than the tagged ledger). A leg with no recorded
 *     quantity claims the whole balance, as the Holdings list does, except
 *     for units a local ledger entry says were bought directly — only this
 *     device's single-asset trade engine writes those.
 */
export type StandaloneHolding = {
  qty: number;
  /** Average entry of THESE units. Null when no buy of them was recorded. */
  avgPriceUsd: number | null;
};

/** Units held via Sandwich legs, per mint. `null` = held, quantity unrecorded. */
export type SandwichLegReserve = Map<string, number | null>;

/**
 * A remainder under this share of the balance is float rounding between the
 * ledger and the chain, not a position. Relative, because token decimals differ
 * per mint — and small, because a real $5 direct buy can sit beside a basket
 * leg a thousand times its size.
 */
const DUST_SHARE = 1e-6;

export function standaloneHolding(input: {
  walletBalance: number;
  entry: CostBasisEntry | undefined;
  reserve?: SandwichLegReserve | null;
  mint: string;
}): StandaloneHolding {
  const balance = Number.isFinite(input.walletBalance) ? Math.max(0, input.walletBalance) : 0;
  const { entry } = input;
  if (balance <= 0) return { qty: 0, avgPriceUsd: null };

  let qty: number;
  let avgPriceUsd: number | null = null;
  if (entry && typeof entry.standaloneQty === 'number') {
    qty = Math.min(balance, entry.standaloneQty);
    avgPriceUsd =
      entry.standaloneAvgPriceUsd && entry.standaloneAvgPriceUsd > 0
        ? entry.standaloneAvgPriceUsd
        : null;
  } else {
    const local = entry && entry.qty > 0 ? entry : null;
    const reserved = input.reserve?.has(input.mint) ? input.reserve.get(input.mint) : 0;
    if (reserved === null) {
      // A leg of unknown size claims the balance; only a recorded direct buy
      // carves its own units back out.
      qty = local ? Math.min(balance, local.qty) : 0;
    } else {
      qty = Math.max(0, balance - (reserved ?? 0));
    }
    avgPriceUsd = local && local.avgPriceUsd > 0 ? local.avgPriceUsd : null;
  }

  if (qty <= balance * DUST_SHARE) return { qty: 0, avgPriceUsd: null };
  return { qty, avgPriceUsd };
}

/** Sum each mint's recorded leg quantity across the stored Sandwich positions. */
export function sandwichLegReserve(positions: SandwichPosition[]): SandwichLegReserve {
  const reserve: SandwichLegReserve = new Map();
  for (const position of positions) {
    for (const leg of position.legs) {
      if (leg.kind === 'prediction' || !leg.mint) continue;
      const decimals = leg.decimals;
      const raw = leg.outputAmount != null ? Number(leg.outputAmount) : NaN;
      const legQty =
        typeof decimals === 'number' && Number.isFinite(raw) && raw > 0
          ? raw / 10 ** decimals
          : null;
      const prior = reserve.has(leg.mint) ? reserve.get(leg.mint) : 0;
      // Once any leg's quantity is unknown the total is unknown.
      reserve.set(leg.mint, prior === null || legQty === null ? null : (prior ?? 0) + legQty);
    }
  }
  return reserve;
}

/**
 * The reserve for this device's stored Sandwich positions. Re-read when the
 * wallet or `refreshKey` changes (pass something that moves after a trade).
 */
export function useSandwichLegReserve(
  walletAddress: string | null,
  refreshKey?: unknown,
): SandwichLegReserve | null {
  const [reserve, setReserve] = useState<SandwichLegReserve | null>(null);
  useEffect(() => {
    if (!walletAddress) {
      setReserve(null);
      return;
    }
    let active = true;
    void getStoredSandwichPositions(walletAddress)
      .then((positions) => {
        if (active) setReserve(sandwichLegReserve(positions));
      })
      .catch(() => {
        if (active) setReserve(new Map());
      });
    return () => {
      active = false;
    };
  }, [walletAddress, refreshKey]);
  return reserve;
}
