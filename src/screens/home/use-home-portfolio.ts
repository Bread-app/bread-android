import { useEmbeddedSolanaWallet, usePrivy } from "@privy-io/expo";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useCash } from "@/hooks/use-cash";
import {
  getPerpSandwichPositions,
  getUserPortfolioHistory,
  type PerpSandwichPosition,
  type PortfolioHistory,
} from "@/lib/api";
import { sumHoldingsUsd } from "@/lib/holdings";
import { hasLivePerpSandwichExposure } from "@/lib/perp-sandwich-visibility";
import { getPhoenixAccount, type PhoenixAccountResponse } from "@/lib/phoenix-api";
import { useWalletStore } from "@/lib/wallet-store";

// The range picker is gone (it only ever drove a chart, which is gone too), so
// the P&L below the balance is fixed to one window rather than configurable.
const PNL_RANGE = "7d";

export type HomePortfolio = {
  walletAddress: string | null;
  /** True once both the balance read and the history read can be trusted. */
  ready: boolean;
  cashLoading: boolean;
  cashError: string | null;
  displayedValue: number;
  displayedChangeUsd: number | null;
  positive: boolean;
  refresh: () => Promise<void>;
};

/**
 * Everything behind the portfolio hero: the balance (cash + spot + perp
 * collateral) and its P&L over the last 7 days.
 *
 * The history series is still fetched — it is what the P&L is measured
 * against, since the window's opening value comes from its first point. The
 * wallet and cash stores are reconciled on every focus; a stale balance is the
 * one thing people actually open Home to check.
 */
export function useHomePortfolio(): HomePortfolio {
  const { user } = usePrivy();
  const solanaWallet = useEmbeddedSolanaWallet();
  const walletAddress = solanaWallet.wallets?.[0]?.address ?? null;
  const walletStore = useWalletStore();
  const cash = useCash();

  const [history, setHistory] = useState<PortfolioHistory | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [phoenixAccount, setPhoenixAccount] = useState<PhoenixAccountResponse | null>(null);
  const [perpSandwichPositions, setPerpSandwichPositions] = useState<PerpSandwichPosition[]>([]);
  const [phoenixLoading, setPhoenixLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void walletStore.refresh();
      void walletStore.reloadCostBasis();
      void cash.refresh();
      setRefreshKey((value) => value + 1);
      // Store and hook methods are stable; focus should always reconcile cash.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  useEffect(() => {
    if (!user?.id) {
      setHistory({ points: [], changePct: null });
      return;
    }
    let current = true;
    void getUserPortfolioHistory(user.id, PNL_RANGE)
      .then((next) => {
        if (current) setHistory(next);
      })
      .catch(() => {
        if (current) setHistory({ points: [], changePct: null });
      });
    return () => {
      current = false;
    };
  }, [refreshKey, user?.id]);

  useEffect(() => {
    if (!walletAddress) {
      setPhoenixAccount(null);
      setPerpSandwichPositions([]);
      setPhoenixLoading(false);
      return;
    }
    let current = true;
    setPhoenixLoading(true);
    void Promise.allSettled([getPhoenixAccount(), getPerpSandwichPositions()])
      .then(([accountResult, sandwichResult]) => {
        if (!current) return;
        if (accountResult.status === "fulfilled") setPhoenixAccount(accountResult.value);
        if (sandwichResult.status === "fulfilled") setPerpSandwichPositions(sandwichResult.value);
      })
      .catch(() => {
        // Keep the last good account snapshot so an upstream hiccup does not
        // make a real perp position disappear from Home.
      })
      .finally(() => {
        if (current) setPhoenixLoading(false);
      });
    return () => {
      current = false;
    };
  }, [refreshKey, walletAddress]);

  const ready = walletStore.hasLoaded && cash.hasLoaded && !phoenixLoading;

  const liveTotal = useMemo(
    () =>
      cash.totalCash +
      Math.max(0, phoenixAccount?.account.cross?.portfolioValue ?? 0) +
      // Same predicate as the Holdings rows below, so the headline can never
      // count collateral for a position the list refuses to show.
      perpSandwichPositions
        .filter(hasLivePerpSandwichExposure)
        .reduce((sum, position) => sum + Math.max(0, position.effectiveCollateralUsd ?? 0), 0) +
      // Cash is already counted above; un-traded SOL is swap rent, not a
      // position — the headline must match the rows listed below it.
      sumHoldingsUsd(walletStore.tokens, { solTraded: walletStore.solTraded }),
    [
      cash.totalCash,
      perpSandwichPositions,
      phoenixAccount?.account.cross?.portfolioValue,
      walletStore.tokens,
      walletStore.solTraded,
    ],
  );

  // The stored history is reconstructed from trades, so its last point drifts
  // from the live balance. Pin the last point to the live total and shift the
  // rest by the same offset, then read the range's opening value off the front.
  // The clamp at zero is load-bearing: a large offset can drag an early point
  // negative, and a portfolio was never worth less than nothing.
  const adjustedPoints = useMemo(() => {
    const points = history?.points ?? [];
    if (!ready || points.length === 0) return points;
    const reconstructedLast = points[points.length - 1].valueUsd;
    const offset = liveTotal - reconstructedLast;
    return points.map((point, index) =>
      index === points.length - 1
        ? { ...point, valueUsd: liveTotal }
        : { ...point, valueUsd: Math.max(0, point.valueUsd + offset) },
    );
  }, [history?.points, liveTotal, ready]);

  const periodFirstValue = adjustedPoints[0]?.valueUsd ?? null;
  const displayedChangePct =
    ready && periodFirstValue !== null && periodFirstValue > 0
      ? ((liveTotal - periodFirstValue) / periodFirstValue) * 100
      : null;
  const displayedChangeUsd =
    ready && periodFirstValue !== null ? liveTotal - periodFirstValue : null;

  const refresh = useCallback(async () => {
    await Promise.allSettled([
      walletStore.refresh(),
      walletStore.reloadCostBasis(),
      cash.refresh(true),
    ]);
    setRefreshKey((value) => value + 1);
  }, [cash, walletStore]);

  return {
    walletAddress,
    ready,
    cashLoading: walletStore.loading || cash.loading,
    cashError: walletStore.error || cash.error,
    displayedValue: liveTotal,
    displayedChangeUsd,
    positive: (displayedChangeUsd ?? displayedChangePct ?? 0) >= 0,
    refresh,
  };
}
