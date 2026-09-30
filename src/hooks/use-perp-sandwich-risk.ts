import { useEffect, useMemo, useRef, useState } from 'react';

import { buildPerpSandwichMarginPlan, type Sandwich } from '@/lib/api';
import {
  getPhoenixAccount,
  getPhoenixPrices,
  listPhoenixMarkets,
  normalizePhoenixAssetSymbol,
  phoenixMarketMatchesAsset,
  type PhoenixMarket,
} from '@/lib/phoenix-api';
import {
  maxLeverageForSize,
  maxStopLossPctFromLiquidation,
  notionalToBaseLots,
  perpEntryCashRequirement,
  projectedLiquidationPrice,
  selectableMaxLeverage,
} from '@/lib/phoenix-risk';

/** Mark prices go stale on screen faster than the markets list does. */
const PRICE_REFRESH_MS = 15_000;
/** What the ruler offers before the markets list lands, and if it never does. */
const FALLBACK_MAX_LEVERAGE = 5;

export type PerpSandwichLegRisk = {
  legId: string;
  label: string;
  symbol: string;
  imageUrl: string | null;
  side: 'long' | 'short';
  weightBps: number;
  marginUsd: number;
  notionalUsd: number;
  markPrice: number | null;
  /** Tier maximum for *this* leg at *this* size — the on-chain cap. */
  maxLeverage: number | null;
  maintenanceMarginBps: number | null;
  liquidationPrice: number | null;
  /** `notionalUsd × market.takerFee`; 0 until this leg's market loads. */
  estimatedTakerFeeUsd: number;
};

export type PerpSandwichRisk = {
  legs: PerpSandwichLegRisk[];
  notionalUsd: number;
  /** Lowest tier max across the legs — every leg has to accept the leverage. */
  bindingMaxLeverage: number;
  /** Highest whole-x that remains valid under every leg's maintenance factor. */
  selectableMaxLeverage: number;
  /** Largest stop-loss % the backend will accept at the current leverage. */
  maxStopLossPct: number;
  /** Σ per-leg taker fee the entry pre-funds on top of the margin. */
  estimatedTakerFeeUsd: number;
  /**
   * Collateral already in the Phoenix parent that the entry can spend before it
   * touches the wallet. 0 while the account read is pending or failed — unknown
   * collateral must not loosen the balance gate.
   */
  availableMarginUsd: number;
  /** Wallet USDC this entry will actually debit. What the pad gates on. */
  cashMovedUsd: number;
  /** True until the first markets+prices round trip settles. */
  loading: boolean;
  /** Set when the Phoenix lookups failed — numbers fall back, buying still works. */
  degraded: boolean;
};

/**
 * Live risk readout for a perp Sandwich entry, computed the way the backend
 * computes it so the pad can show liquidation and stop levels *before* the
 * server quote exists.
 *
 * Everything here mirrors `stock-backend/lib/server/phoenix/trade.ts` via
 * `@/lib/phoenix-risk`. Where Phoenix data is missing the hook degrades to nulls
 * and a conservative leverage ceiling rather than guessing — the server stays
 * the authority, and a missing mark must never block a buy.
 */
export function usePerpSandwichRisk(options: {
  sandwich: Sandwich | null;
  marginUsd: number;
  leverage: number;
  /** Skip all network work while the pad is closed. */
  enabled: boolean;
}): PerpSandwichRisk {
  const { sandwich, marginUsd, leverage, enabled } = options;

  const [markets, setMarkets] = useState<PhoenixMarket[] | null>(null);
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const [availableMarginUsd, setAvailableMarginUsd] = useState(0);
  const [loading, setLoading] = useState(false);
  const [degraded, setDegraded] = useState(false);

  const symbols = useMemo(() => {
    if (!sandwich || sandwich.venue !== 'perp') return [] as string[];
    return [...sandwich.legs]
      .sort((a, b) => a.order - b.order)
      .map((leg) =>
        normalizePhoenixAssetSymbol(leg.underlyingSymbol ?? leg.symbol ?? leg.label),
      );
  }, [sandwich]);

  // Keyed on the joined symbols rather than the array identity so a re-render
  // with an equivalent list doesn't restart the poll.
  const symbolKey = symbols.join(',');
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled || symbolKey.length === 0) return;
    const list = symbolKey.split(',');
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      // A sandwich caps at 3 legs and the price endpoint batches 8, so this is
      // one call each — no chunking needed. The account read rides along because
      // the entry spends parent collateral before wallet cash, so the pad cannot
      // size the debit without it.
      const [marketsResult, pricesResult, accountResult] = await Promise.allSettled([
        listPhoenixMarkets(),
        getPhoenixPrices(list),
        getPhoenixAccount(),
      ]);
      if (cancelled || !mountedRef.current) return;

      if (marketsResult.status === 'fulfilled') setMarkets(marketsResult.value);
      if (pricesResult.status === 'fulfilled') setPrices(pricesResult.value.prices);
      // Mirrors `trade.ts`'s `cross.effectiveCollateral - cross.initialMargin`.
      // A failed read falls back to 0, which can only over-state the debit — the
      // safe direction, since the server is still the authority.
      setAvailableMarginUsd(
        accountResult.status === 'fulfilled' && accountResult.value.account.cross
          ? Math.max(
              0,
              accountResult.value.account.cross.effectiveCollateral -
                accountResult.value.account.cross.initialMargin,
            )
          : 0,
      );
      setDegraded(marketsResult.status === 'rejected' || pricesResult.status === 'rejected');
      setLoading(false);
    };

    void load();
    const timer = setInterval(() => void load(), PRICE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, symbolKey]);

  return useMemo(() => {
    const rawLegs = sandwich ? [...sandwich.legs].sort((a, b) => a.order - b.order) : [];
    const totalWeight = rawLegs.reduce((sum, leg) => sum + leg.weightBps, 0);
    const hasMargin = Number.isFinite(marginUsd) && marginUsd > 0 && totalWeight > 0;

    let remainingMargin = hasMargin ? marginUsd : 0;
    const legs: PerpSandwichLegRisk[] = rawLegs.map((leg, index) => {
      const normalized = normalizePhoenixAssetSymbol(
        leg.underlyingSymbol ?? leg.symbol ?? leg.label,
      );
      const market = markets?.find((m) => phoenixMarketMatchesAsset(m, normalized)) ?? null;
      const markPrice = prices[normalized] ?? null;

      let legMarginUsd = 0;
      if (hasMargin) {
        if (index === rawLegs.length - 1) {
          legMarginUsd = remainingMargin;
        } else {
          legMarginUsd =
            Math.floor(((marginUsd * leg.weightBps) / totalWeight) * 1_000_000) / 1_000_000;
          remainingMargin -= legMarginUsd;
        }
      }

      const notionalUsd = legMarginUsd * leverage;

      // The tier depends on the size, which depends on the leverage being
      // priced — the same single pass the server validates against, not a
      // fixed-point iteration.
      const baseLots =
        market && markPrice && notionalUsd > 0
          ? notionalToBaseLots({
              notionalUsd,
              markPrice,
              baseLotsDecimals: market.baseLotsDecimals,
            })
          : null;
      const legMaxLeverage = market
        ? baseLots === null || baseLots === 0
          ? market.maxLeverage
          : maxLeverageForSize(market.leverageTiers, baseLots)
        : null;

      const liquidationPrice =
        markPrice !== null &&
        legMaxLeverage !== null &&
        market?.maintenanceMarginBps !== null &&
        market?.maintenanceMarginBps !== undefined
          ? projectedLiquidationPrice({
              side: leg.side === 'short' ? 'short' : 'long',
              markPrice,
              leverage,
              maxLeverage: legMaxLeverage,
              maintenanceMarginBps: market.maintenanceMarginBps,
            })
          : null;

      return {
        legId: leg.id,
        label: leg.label,
        symbol: normalized,
        imageUrl: leg.imageUrl,
        side: leg.side === 'short' ? 'short' : 'long',
        weightBps: leg.weightBps,
        marginUsd: legMarginUsd,
        notionalUsd,
        markPrice,
        maxLeverage: legMaxLeverage,
        maintenanceMarginBps: market?.maintenanceMarginBps ?? null,
        liquidationPrice,
        estimatedTakerFeeUsd: market ? notionalUsd * market.takerFee : 0,
      };
    });

    const tierMaxima = legs
      .map((leg) => leg.maxLeverage)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const bindingMaxLeverage =
      tierMaxima.length > 0 ? Math.min(...tierMaxima) : FALLBACK_MAX_LEVERAGE;
    const selectableMaxima = legs.flatMap((leg) =>
      leg.maxLeverage !== null && leg.maintenanceMarginBps !== null
        ? [selectableMaxLeverage(leg.maxLeverage, leg.maintenanceMarginBps)]
        : [],
    );
    const selectableMax =
      selectableMaxima.length > 0
        ? Math.min(...selectableMaxima)
        : FALLBACK_MAX_LEVERAGE;
    const stopCeilings = legs.flatMap((leg) => {
      const ceiling = maxStopLossPctFromLiquidation(leg.markPrice, leg.liquidationPrice);
      return ceiling === null ? [] : [ceiling];
    });

    const estimatedTakerFeeUsd = legs.reduce((sum, leg) => sum + leg.estimatedTakerFeeUsd, 0);
    const cash = perpEntryCashRequirement({
      marginUsd,
      estimatedTakerFeeUsd,
      availableMarginUsd,
    });

    return {
      legs,
      notionalUsd: legs.reduce((sum, leg) => sum + leg.notionalUsd, 0),
      bindingMaxLeverage,
      selectableMaxLeverage: Math.min(bindingMaxLeverage, selectableMax),
      maxStopLossPct: stopCeilings.length > 0 ? Math.min(...stopCeilings) : 0,
      estimatedTakerFeeUsd,
      availableMarginUsd,
      cashMovedUsd: cash.cashMovedUsd,
      loading: loading && markets === null,
      degraded,
    };
  }, [availableMarginUsd, degraded, leverage, loading, marginUsd, markets, prices, sandwich]);
}
