import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useEmbeddedSolanaWallet } from "@privy-io/expo";
import * as SecureStore from "expo-secure-store";

import { getWalletDeposits, type WalletDepositRecord } from "@/lib/api";
import { useToast } from "@/lib/toast-store";
import { fromSmallestUnits, SOLANA_USDC_MINT } from "@/lib/trading";

// How often to poll the deposit feed while the app is foregrounded. Deposits are
// recorded by Privy's `wallet.funds_deposited` webhook, so this just surfaces
// them with a toast — a slow cadence is plenty and keeps the network quiet.
const POLL_INTERVAL_MS = 20_000;

// Per-wallet high-water mark (the newest deposit `createdAt` we've already
// toasted). Stored so a relaunch doesn't re-announce historical deposits.
const seenKey = (wallet: string) => `deposit_seen_at_${wallet}`;

function describeDeposit(d: WalletDepositRecord): string {
  if (d.asset === SOLANA_USDC_MINT) {
    const usd = fromSmallestUnits(d.amount, 6);
    if (usd && usd > 0) return `Received $${usd.toFixed(2)} — adding to your cash`;
  }
  return "Deposit received — adding to your cash";
}

/**
 * Surfaces a toast whenever new funds land in the user's Solana wallet, on any
 * screen and from any path (QR / same-chain send *or* a cross-chain bridge) —
 * the deposit bottom sheet's own poller only runs while that sheet is open.
 *
 * It polls the backend deposit feed (fed by Privy's `wallet.funds_deposited`
 * webhook) while the app is foregrounded, deduping against a per-wallet
 * high-water mark persisted in SecureStore so historical deposits aren't
 * re-announced on relaunch.
 *
 * Foreground-only: when the app is backgrounded a push notification is the right
 * channel (not wired here). Deposits land as liquid, spendable cash.
 *
 * Mount once, high in the tree, inside the toast provider. Renders nothing.
 */
export function useDepositToasts(): void {
  const solanaWallet = useEmbeddedSolanaWallet();
  const walletAddress = solanaWallet.wallets?.[0]?.address ?? null;

  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // Guards against overlapping polls (interval tick + foreground event).
  const pollingRef = useRef(false);

  const poll = useCallback(async (wallet: string) => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      const storedSince = await SecureStore.getItemAsync(seenKey(wallet)).catch(() => null);

      // First run for this wallet: establish the high-water mark from the
      // current newest deposit *without* toasting, so we never blast a wall of
      // old deposits the first time the watcher mounts.
      if (!storedSince) {
        const existing = await getWalletDeposits(wallet).catch(() => []);
        const newest = existing[0]?.createdAt ?? new Date().toISOString();
        await SecureStore.setItemAsync(seenKey(wallet), newest).catch(() => {});
        return;
      }

      const fresh = await getWalletDeposits(wallet, undefined).catch(() => []);
      // `getWalletDeposits` returns newest-first; keep only those after the mark.
      const sinceMs = new Date(storedSince).getTime();
      const newDeposits = fresh.filter((d) => {
        const t = new Date(d.createdAt).getTime();
        return Number.isFinite(t) && t > sinceMs;
      });
      if (newDeposits.length === 0) return;

      // Advance the mark to the newest before toasting, so a mid-flight crash
      // can't replay the same deposits.
      await SecureStore.setItemAsync(seenKey(wallet), newDeposits[0].createdAt).catch(() => {});

      // One toast even if several landed at once.
      if (newDeposits.length === 1) {
        toastRef.current.showToast(describeDeposit(newDeposits[0]), "success");
      } else {
        toastRef.current.showToast(`${newDeposits.length} deposits received — adding to your cash`, "success");
      }
    } finally {
      pollingRef.current = false;
    }
  }, []);

  // Poll on an interval while foregrounded, plus immediately when the wallet
  // becomes available and whenever the app returns to the foreground.
  useEffect(() => {
    if (!walletAddress) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      void poll(walletAddress);
      timer = setInterval(() => void poll(walletAddress), POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    if (AppState.currentState === "active") start();
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") start();
      else stop();
    });

    return () => {
      stop();
      sub.remove();
    };
  }, [walletAddress, poll]);
}
