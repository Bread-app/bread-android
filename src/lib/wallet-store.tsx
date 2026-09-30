import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import * as SecureStore from 'expo-secure-store';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { getWalletBalances, getWalletCostBasis, humanizeErrorMessage, type WalletBalanceToken } from '@/lib/api';
import { loadCostBasisLedger, type CostBasisEntry, type CostBasisLedger } from '@/lib/cost-basis';
import { mergeCostBasisLedgers } from '@/lib/onchain-cost-basis';

type WalletStoreValue = {
  walletAddress: string | null;
  tokens: WalletBalanceToken[];
  loading: boolean;
  /** True once a balance read (fresh or cached) has succeeded for the current
   * wallet. Consumers should not render a $0 cash figure until this is true —
   * before it, an empty `tokens` means "not loaded yet", not "no money". */
  hasLoaded: boolean;
  error: string | null;
  costBasis: CostBasisLedger;
  /**
   * True once `costBasis` has been read for the current wallet (successfully or
   * not). Before that an absent entry means "not loaded", not "never bought" —
   * the asset page must not treat a Sandwich leg as a direct holding meanwhile.
   */
  costBasisLoaded: boolean;
  /**
   * True when the user actually bought SOL. Server-authoritative: a wallet
   * accrues ~0.002 SOL of routing rent per swap (the integrator payer funds a
   * temporary wSOL account that closes back to the user), so a SOL *balance*
   * proves nothing and the on-chain ledger reports the routing hop as a
   * receive. Only the app's own trade records separate the two.
   */
  solTraded: boolean;
  /**
   * Re-read balances from the chain.
   *
   * Concurrent calls share one network read — several screens (and `useCash`,
   * which is a projection of this store) ask for a refresh on the same focus
   * event, and firing three identical RPC fan-outs only made the first paint
   * slower. Pass `maxAgeMs` to skip the read entirely when the last successful
   * one is younger than that; omit it (the default) after a trade or deposit,
   * where a fresh read is the whole point.
   */
  refresh: (options?: { maxAgeMs?: number }) => Promise<void>;
  /**
   * Optimistically tweak a token row pre-confirmation. The next refresh() will
   * reconcile against on-chain truth.
   */
  optimisticAdjust: (mint: string, deltaQty: number, deltaUsd: number) => void;
  reloadCostBasis: (options?: { maxAgeMs?: number }) => Promise<void>;
};

const WalletStoreContext = createContext<WalletStoreValue | null>(null);

// ── Last-good balance cache ──────────────────────────────────────────────────
// Persist the most recent successful balance read per wallet so a cold start
// (or a transient upstream failure) shows the real figure immediately instead
// of flashing "Loading…" or, worse, $0.00. SecureStore is the storage already
// used app-wide; writes are capped + best-effort so they can never throw.
const CACHE_PREFIX = 'wallet_balances_v1_';
const MAX_CACHED_TOKENS = 40;

function cacheKey(address: string): string {
  return `${CACHE_PREFIX}${address}`;
}

async function readBalanceCache(address: string): Promise<WalletBalanceToken[] | null> {
  try {
    const raw = await SecureStore.getItemAsync(cacheKey(address));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WalletBalanceToken[]) : null;
  } catch {
    return null;
  }
}

async function writeBalanceCache(address: string, tokens: WalletBalanceToken[]): Promise<void> {
  try {
    const compact = [...tokens]
      .sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0))
      .slice(0, MAX_CACHED_TOKENS);
    await SecureStore.setItemAsync(cacheKey(address), JSON.stringify(compact));
  } catch {
    // Non-fatal: caching is an optimization, never a correctness requirement.
  }
}

/** One retry on transient failure — balance reads fan out to several upstreams
 * (Helius + Jupiter) and an occasional hiccup shouldn't surface as an error. */
async function fetchBalancesWithRetry(
  address: string,
  onPartial: (tokens: WalletBalanceToken[]) => void,
) {
  try {
    return await getWalletBalances(address, { onPartial });
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return await getWalletBalances(address, { onPartial });
  }
}

export function WalletStoreProvider({ children }: { children: React.ReactNode }) {
  const solanaWallet = useEmbeddedSolanaWallet();
  const wallet = solanaWallet.wallets?.[0] ?? null;
  const walletAddress = wallet?.address ?? null;

  const [tokens, setTokens] = useState<WalletBalanceToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [costBasis, setCostBasis] = useState<CostBasisLedger>({});
  const [costBasisFor, setCostBasisFor] = useState<string | null>(null);
  const [solTraded, setSolTraded] = useState(false);
  const requestIdRef = useRef(0);
  const prevAddrRef = useRef<string | null>(null);
  // One in-flight balance read at a time, plus when the last one succeeded, so
  // simultaneous callers share a read and a just-refreshed screen can opt out of
  // repeating it (see `refresh`'s `maxAgeMs`).
  const inflightRef = useRef<{ id: number; address: string; promise: Promise<void> } | null>(null);
  const lastFetchedRef = useRef<{ address: string; at: number } | null>(null);
  const costBasisIdRef = useRef(0);
  const costBasisInflightRef = useRef<{
    id: number;
    address: string;
    promise: Promise<void>;
  } | null>(null);
  const costBasisFetchedRef = useRef<{ address: string; at: number } | null>(null);
  // Address whose *fresh* balances are on screen. The cache seed below must
  // never apply once this matches: a wallet that has just been emptied reads
  // back as an empty token list, and re-seeding the cache over it would
  // resurrect holdings (and a cash figure) the user no longer has.
  const freshAddrRef = useRef<string | null>(null);

  const refresh = useCallback<WalletStoreValue['refresh']>(
    async (options) => {
      if (!walletAddress) {
        // No wallet yet, or a transient null from Privy re-initializing. Do NOT
        // wipe the last-good balances — that's what made cash flash $0.00.
        setLoading(false);
        return;
      }

      const maxAgeMs = options?.maxAgeMs;
      const last = lastFetchedRef.current;
      if (
        maxAgeMs !== undefined &&
        last &&
        last.address === walletAddress &&
        Date.now() - last.at < maxAgeMs
      ) {
        return;
      }

      const inflight = inflightRef.current;
      if (inflight && inflight.address === walletAddress) return inflight.promise;

      const id = ++requestIdRef.current;
      setLoading(true);
      setError(null);

      const promise = (async () => {
        try {
          // The full read layers metadata + prices on top of the chain read; the
          // partial callback paints the priced rows as soon as they exist rather
          // than waiting on the per-token metadata backfill behind them.
          const balances = await fetchBalancesWithRetry(walletAddress, (partial) => {
            if (id !== requestIdRef.current) return;
            freshAddrRef.current = walletAddress;
            setTokens(partial);
            setHasLoaded(true);
          });
          if (id !== requestIdRef.current) return;
          freshAddrRef.current = walletAddress;
          lastFetchedRef.current = { address: walletAddress, at: Date.now() };
          setTokens(balances.tokens);
          setHasLoaded(true);
          void writeBalanceCache(walletAddress, balances.tokens);
        } catch (e) {
          if (id !== requestIdRef.current) return;
          // Keep whatever we last had on screen; just record the error.
          setError(humanizeErrorMessage(e, 'Unable to load wallet balance.'));
        } finally {
          if (id === requestIdRef.current) setLoading(false);
          if (inflightRef.current?.id === id) inflightRef.current = null;
        }
      })();

      inflightRef.current = { id, address: walletAddress, promise };
      return promise;
    },
    [walletAddress],
  );

  const loadCostBasis = useCallback(async () => {
    if (!walletAddress) {
      setCostBasis({});
      setSolTraded(false);
      return;
    }
    // The server derives the authoritative cost basis (app buy/sell USD joined
    // to on-chain swap quantities); the local SecureStore ledger fills the gap
    // for just-made trades the chain hasn't indexed yet.
    const [localLedger, server] = await Promise.all([
      loadCostBasisLedger(walletAddress),
      getWalletCostBasis(walletAddress).catch(() => null),
    ]);
    // `solTraded` decides whether the wallet's SOL is a real position or swap
    // rent (see lib/holdings.ts). A failed lookup is not evidence of "never
    // traded" — flipping it false there would hide a SOL position the user
    // genuinely owns, so keep the last known answer on failure.
    if (server) setSolTraded(server.solTraded);
    const nowIso = new Date().toISOString();
    const onchainLedger: CostBasisLedger = {};
    for (const [mint, entry] of Object.entries(server?.ledger ?? {})) {
      onchainLedger[mint] = {
        mint,
        qty: entry.qty,
        avgPriceUsd: entry.avgPriceUsd,
        realizedPnlUsd: 0,
        updatedAt: nowIso,
        ...(entry.standaloneQty !== undefined
          ? {
              standaloneQty: entry.standaloneQty,
              standaloneAvgPriceUsd: entry.standaloneAvgPriceUsd ?? 0,
            }
          : {}),
      } satisfies CostBasisEntry;
    }
    // Server is authoritative; local fills gaps for trades not yet indexed.
    setCostBasis(mergeCostBasisLedgers(onchainLedger, localLedger));
    setCostBasisFor(walletAddress);
  }, [walletAddress]);

  /** Same coalescing/freshness contract as `refresh` — the cost-basis lookup is
   *  the slowest call on the profile screen (it walks on-chain history), so a
   *  focus event must not queue a second one behind the first. */
  const reloadCostBasis = useCallback<WalletStoreValue['reloadCostBasis']>(
    async (options) => {
      if (!walletAddress) {
        await loadCostBasis();
        return;
      }

      const maxAgeMs = options?.maxAgeMs;
      const last = costBasisFetchedRef.current;
      if (
        maxAgeMs !== undefined &&
        last &&
        last.address === walletAddress &&
        Date.now() - last.at < maxAgeMs
      ) {
        return;
      }

      const inflight = costBasisInflightRef.current;
      if (inflight && inflight.address === walletAddress) return inflight.promise;

      const id = ++costBasisIdRef.current;
      const promise = (async () => {
        try {
          await loadCostBasis();
          costBasisFetchedRef.current = { address: walletAddress, at: Date.now() };
        } finally {
          if (costBasisInflightRef.current?.id === id) {
            costBasisInflightRef.current = null;
          }
        }
      })();

      costBasisInflightRef.current = { id, address: walletAddress, promise };
      return promise;
    },
    [walletAddress, loadCostBasis],
  );

  useEffect(() => {
    const addr = walletAddress;

    if (addr && addr !== prevAddrRef.current) {
      const switchingAccounts = prevAddrRef.current !== null;
      prevAddrRef.current = addr;

      if (switchingAccounts) {
        // A genuinely different account — drop the previous account's data so
        // its balances can never bleed into the new one.
        setTokens([]);
        setHasLoaded(false);
        setError(null);
        freshAddrRef.current = null;
      }

      // Seed from the last-good cache for an instant figure, then fetch fresh.
      // The seed is a bridge for the pre-fetch gap only: if the network read
      // won the race it is already authoritative (including when it truthfully
      // returned nothing), so the cache must not be applied over it.
      let cancelled = false;
      void readBalanceCache(addr).then((cached) => {
        if (cancelled || !cached || cached.length === 0) return;
        if (freshAddrRef.current === addr) return;
        setTokens((prev) => (prev.length === 0 ? cached : prev));
        setHasLoaded(true);
      });

      void refresh();
      void reloadCostBasis();
      return () => {
        cancelled = true;
      };
    }

    if (!addr) {
      // Transient/no wallet: retain last-good tokens, just stop the spinner.
      setLoading(false);
    }
    return undefined;
  }, [walletAddress, refresh, reloadCostBasis]);

  const optimisticAdjust = useCallback<WalletStoreValue['optimisticAdjust']>(
    (mint, deltaQty, deltaUsd) => {
      if (!mint) return;
      setTokens((prev) => {
        const idx = prev.findIndex((t) => t.mint === mint);
        if (idx === -1) {
          if (deltaQty <= 0) return prev;
          return [
            ...prev,
            {
              mint,
              symbol: null,
              name: null,
              icon: null,
              balance: deltaQty,
              decimals: null,
              usdValue: deltaUsd,
              priceChange24h: null,
            },
          ];
        }
        const next = prev.slice();
        const current = next[idx];
        next[idx] = {
          ...current,
          balance: Math.max(0, (current.balance ?? 0) + deltaQty),
          usdValue:
            current.usdValue === null
              ? deltaUsd
              : Math.max(0, current.usdValue + deltaUsd),
        };
        return next;
      });
    },
    [],
  );

  const value = useMemo<WalletStoreValue>(
    () => ({
      walletAddress,
      tokens,
      loading,
      hasLoaded,
      error,
      costBasis,
      costBasisLoaded: walletAddress !== null && costBasisFor === walletAddress,
      solTraded,
      refresh,
      optimisticAdjust,
      reloadCostBasis,
    }),
    [walletAddress, tokens, loading, hasLoaded, error, costBasis, costBasisFor, solTraded, refresh, optimisticAdjust, reloadCostBasis],
  );

  return <WalletStoreContext.Provider value={value}>{children}</WalletStoreContext.Provider>;
}

export function useWalletStore(): WalletStoreValue {
  const ctx = useContext(WalletStoreContext);
  if (!ctx) {
    return {
      walletAddress: null,
      tokens: [],
      loading: false,
      hasLoaded: false,
      error: null,
      costBasis: {},
      costBasisLoaded: false,
      solTraded: false,
      refresh: async () => {},
      optimisticAdjust: () => {},
      reloadCostBasis: async () => {},
    };
  }
  return ctx;
}
