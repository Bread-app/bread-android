import { useEmbeddedSolanaWallet, usePrivy } from "@privy-io/expo";
import { useFocusEffect } from "@react-navigation/native";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

// Tab focus re-reads only what is older than this. Every focus used to refetch
// balances, cost basis, Phoenix and P&L from scratch, and the hero blinked back
// to a skeleton each time while they ran.
const FOCUS_REFRESH_MAX_AGE_MS = 30_000;
// The longest the headline waits on the Phoenix read before it settles on the
// last account it has. A late answer still lands; it just rolls the figure once
// more instead of holding the hero on a skeleton.
const PHOENIX_SETTLE_CAP_MS = 6_000;

// Last-good headline TOTAL per wallet. The wallet store caches its token rows,
// but the total also needs Phoenix, which has no cache — so a cold start sat on
// a skeleton until the perps read answered even with every balance on disk.
function totalCacheKey(roundKey: string): string {
  return `home_total_v1_${roundKey.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

async function readTotalCache(roundKey: string): Promise<number | null> {
  try {
    const raw = await SecureStore.getItemAsync(totalCacheKey(roundKey));
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeTotalCache(roundKey: string, value: number): void {
  SecureStore.setItemAsync(totalCacheKey(roundKey), String(value)).catch(() => {
    // Best-effort, like the P&L cache.
  });
}

export type HomePortfolio = {
  walletAddress: string | null;
  /**
   * True once there is a figure to show — the last-good total from disk, or a
   * settled live one. Never goes back to false on a background refresh.
   */
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
  const { refresh: refreshWallet, reloadCostBasis } = walletStore;
  const cash = useCash();

  // undefined = not loaded yet; null = no figure (demo, or the read failed).
  const [pnlUsd, setPnlUsd] = useState<number | null | undefined>(undefined);
  const [refreshKey, setRefreshKey] = useState(0);
  const [phoenixAccount, setPhoenixAccount] = useState<PhoenixAccountResponse | null>(null);
  const [perpSandwichPositions, setPerpSandwichPositions] = useState<PerpSandwichPosition[]>([]);
  const [phoenixLoading, setPhoenixLoading] = useState(false);
  // Which account the Phoenix state above belongs to, once a read has settled.
  const [phoenixReadFor, setPhoenixReadFor] = useState<string | null>(null);
  // When the Phoenix + P&L reads last started.
  const lastRoundAtRef = useRef(0);
  // The account the Phoenix state belongs to, so a switch drops the old one's
  // perps before a capped settle could count them under the new wallet.
  const phoenixOwnerRef = useRef<string | null>(null);

  // Everything the headline is scoped to. Demo buys swaps the whole portfolio
  // for the paper account, so it is part of the identity, not just the wallet.
  const roundKey = walletAddress ? `${demoMode ? "demo" : "live"}:${walletAddress}` : null;

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
    if (!walletAddress || !roundKey) {
      setPhoenixAccount(null);
      setPerpSandwichPositions([]);
      setPhoenixLoading(false);
      setPhoenixReadFor(null);
      return;
    }
    if (phoenixOwnerRef.current !== roundKey) {
      phoenixOwnerRef.current = roundKey;
      setPhoenixAccount(null);
      setPerpSandwichPositions([]);
    }
    let current = true;
    lastRoundAtRef.current = Date.now();
    setPhoenixLoading(true);
    const settle = () => {
      if (!current) return;
      setPhoenixLoading(false);
      setPhoenixReadFor(roundKey);
    };
    const cap = setTimeout(settle, PHOENIX_SETTLE_CAP_MS);
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
        clearTimeout(cap);
        settle();
      });
    return () => {
      current = false;
      clearTimeout(cap);
    };
  }, [refreshKey, roundKey, walletAddress]);

  // Declared after the effects above on purpose: on mount they run first and
  // stamp `lastRoundAtRef`, so the mount focus does not start a second round.
  useFocusEffect(
    useCallback(() => {
      // Both store reads coalesce with any read already in flight and skip
      // themselves when the last one is fresh enough.
      void refreshWallet({ maxAgeMs: FOCUS_REFRESH_MAX_AGE_MS });
      void reloadCostBasis({ maxAgeMs: FOCUS_REFRESH_MAX_AGE_MS });
      if (Date.now() - lastRoundAtRef.current >= FOCUS_REFRESH_MAX_AGE_MS) {
        setRefreshKey((value) => value + 1);
      }
    }, [refreshWallet, reloadCostBasis]),
  );

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

  // The total is the sum of reads that land at different moments — cached rows,
  // partially priced rows, fully priced rows, then Phoenix — and the odometer
  // rolled at every one. The headline only takes a new figure when every read
  // of the round has settled, so a refresh moves it at most once.
  const settled =
    roundKey !== null &&
    walletStore.hasLoaded &&
    !walletStore.loading &&
    !phoenixLoading &&
    phoenixReadFor === roundKey;

  const [shown, setShown] = useState<{ key: string; value: number } | null>(null);

  // Cold start: the last settled total for this account, straight from disk,
  // so the hero opens on a number instead of a skeleton.
  useEffect(() => {
    if (!roundKey) return;
    let current = true;
    void readTotalCache(roundKey).then((cached) => {
      if (!current || cached === null) return;
      setShown((prev) => (prev?.key === roundKey ? prev : { key: roundKey, value: cached }));
    });
    return () => {
      current = false;
    };
  }, [roundKey]);

  useEffect(() => {
    if (!settled || !roundKey) return;
    setShown((prev) =>
      prev?.key === roundKey && prev.value === liveTotal ? prev : { key: roundKey, value: liveTotal },
    );
    writeTotalCache(roundKey, liveTotal);
  }, [liveTotal, roundKey, settled]);

  const visible = shown !== null && shown.key === roundKey ? shown : null;

  const displayedChangeUsd = pnlUsd ?? null;

  const refresh = useCallback(async () => {
    await Promise.allSettled([refreshWallet(), reloadCostBasis()]);
    setRefreshKey((value) => value + 1);
  }, [refreshWallet, reloadCostBasis]);

  return {
    walletAddress,
    ready: visible !== null,
    cashLoading: walletStore.loading || phoenixLoading,
    cashError: walletStore.error,
    displayedValue: visible?.value ?? 0,
    displayedChangeUsd,
    positive: (displayedChangeUsd ?? 0) >= 0,
    refresh,
  };
}
