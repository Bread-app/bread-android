import { useEmbeddedSolanaWallet, usePrivy } from "@privy-io/expo";
import { useFocusEffect } from "@react-navigation/native";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useCash } from "@/hooks/use-cash";
import {
  getPerpSandwichPositions,
  getUserPnlHistory,
  type PerpSandwichPosition,
} from "@/lib/api";
import { sumHoldingsUsd } from "@/lib/holdings";
import { hasLivePerpSandwichExposure } from "@/lib/perp-sandwich-visibility";
import {
  getPhoenixAccount,
  phoenixStandaloneChildrenValue,
  type PhoenixAccountResponse,
} from "@/lib/phoenix-api";
import { useWalletStore } from "@/lib/wallet-store";
import { useDemoBuyMode } from "@/lib/demo-buy-mode";

// The range picker is gone (it only ever drove a chart, which is gone too), so
// the P&L below the balance is fixed to one window rather than configurable.
const PNL_RANGE = "7d";

// Last-good P&L per user. The summary walks the trade ledger and reads Phoenix
// live (several seconds cold), so Home shows the previous figure until the new
// one lands rather than an empty line.
function pnlCacheKey(privyUserId: string): string {
  // SecureStore keys allow only [A-Za-z0-9._-]; Privy ids contain colons.
  return `home_pnl_${PNL_RANGE}_v1_${privyUserId.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

async function readPnlCache(privyUserId: string): Promise<number | null> {
  try {
    const raw = await SecureStore.getItemAsync(pnlCacheKey(privyUserId));
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writePnlCache(privyUserId: string, value: number): void {
  SecureStore.setItemAsync(pnlCacheKey(privyUserId), String(value)).catch(() => {
    // Best-effort: the cache only shortens the blank on the next cold start.
  });
}

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
 * The P&L is trading P&L — realized on everything closed in the window
 * (Sandwiches, standalone perps including liquidations and fired stops, token
 * round trips) plus unrealized on what is still open — from the same
 * `/pnl/history` summary the Profile chart uses. It used to be the change in
 * the wallet's reconstructed value, which counted deposits and withdrawals as
 * gains and losses and never saw money inside Phoenix at all: a liquidated
 * $4 perp read as −$0.05.
 */
export function useHomePortfolio(): HomePortfolio {
  // Re-read the perps account when Demo buys flips the portfolio over.
  const [demoMode] = useDemoBuyMode();
  const { user } = usePrivy();
  const solanaWallet = useEmbeddedSolanaWallet();
  const walletAddress = solanaWallet.wallets?.[0]?.address ?? null;
  const walletStore = useWalletStore();
  const cash = useCash();

  // undefined = not loaded yet; null = no figure (demo, or the read failed).
  const [pnlUsd, setPnlUsd] = useState<number | null | undefined>(undefined);
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
    if (!user?.id || demoMode) {
      // A demo account's trades are paper; the server's record is the real one.
      setPnlUsd(null);
      return;
    }
    const privyUserId = user.id;
    let current = true;
    void readPnlCache(privyUserId).then((cached) => {
      if (current && cached !== null) setPnlUsd((value) => (value === undefined ? cached : value));
    });
    void getUserPnlHistory(privyUserId, PNL_RANGE).then((next) => {
      if (!current) return;
      // The client maps a failed read to an empty series; a real answer always
      // carries one point per day. Keep the last good figure on failure.
      if (next.points.length === 0) {
        setPnlUsd((value) => (value === undefined ? null : value));
        return;
      }
      setPnlUsd(next.changeUsd);
      writePnlCache(privyUserId, next.changeUsd);
    });
    return () => {
      current = false;
    };
  }, [demoMode, refreshKey, user?.id]);

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
  }, [demoMode, refreshKey, walletAddress]);

  const ready = walletStore.hasLoaded && cash.hasLoaded && !phoenixLoading;

  const liveTotal = useMemo(
    () =>
      cash.totalCash +
      Math.max(0, phoenixAccount?.account.cross?.portfolioValue ?? 0) +
      // Standalone perps each live in their own isolated child.
      phoenixStandaloneChildrenValue(phoenixAccount) +
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
      phoenixAccount,
      walletStore.tokens,
      walletStore.solTraded,
    ],
  );

  const displayedChangeUsd = pnlUsd ?? null;

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
    positive: (displayedChangeUsd ?? 0) >= 0,
    refresh,
  };
}
