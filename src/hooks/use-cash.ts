import { useCallback, useMemo } from "react";

import { SOLANA_USDC_MINT } from "@/lib/trading";
import { useWalletStore } from "@/lib/wallet-store";

export type UseCashValue = {
  /** Liquid, spendable USDC sitting in the wallet. */
  idleUsdc: number;
  /** What the user thinks of as "cash" — the wallet's liquid USDC. */
  totalCash: number;
  loading: boolean;
  /** True once the wallet balances have resolved at least once. */
  hasLoaded: boolean;
  error: string | null;
  /** Re-read balances. `force` is accepted for call-site compatibility. */
  refresh: (force?: boolean) => Promise<void>;
};

/**
 * The app's single source of truth for spendable cash: the wallet's liquid
 * USDC. A thin projection over the wallet store — there is no separate vault or
 * yield product anymore, so `totalCash === idleUsdc`.
 *
 * Kept as a hook (rather than inlining the USDC lookup at every call site) so
 * the "what counts as cash" rule lives in one place. The `autoRefresh` option
 * is a no-op retained for call-site compatibility: the wallet store is already
 * the shared, always-mounted source, so no independent fetch is needed here.
 */
export function useCash(_options?: { autoRefresh?: boolean }): UseCashValue {
  const walletStore = useWalletStore();

  const idleUsdc = useMemo(() => {
    // Match the canonical mint first: a bridged/look-alike token can also call
    // itself "USDC", and picking whichever row happens to come first would put
    // an unspendable balance behind the buy button.
    const usdc =
      walletStore.tokens.find((token) => token.mint === SOLANA_USDC_MINT) ??
      walletStore.tokens.find(
        (token) => !token.mint && (token.symbol ?? "").toUpperCase() === "USDC",
      );
    return usdc?.balance ?? 0;
  }, [walletStore.tokens]);

  const refresh = useCallback(
    async (_force?: boolean) => {
      await walletStore.refresh();
    },
    [walletStore],
  );

  return {
    idleUsdc,
    totalCash: idleUsdc,
    loading: walletStore.loading,
    hasLoaded: walletStore.hasLoaded,
    error: walletStore.error,
    refresh,
  };
}
