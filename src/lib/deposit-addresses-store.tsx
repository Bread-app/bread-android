import { useEmbeddedEthereumWallet, useEmbeddedSolanaWallet } from '@privy-io/expo';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { createRelayDepositAddress, type RelayDepositAddressResponse } from '@/lib/api';
import {
  loadCachedDepositAddresses,
  saveCachedDepositAddresses,
} from '@/lib/deposit-address-cache';
import { RELAY_SOURCE_CHAINS } from '@/lib/relay';
import { toSmallestUnits } from '@/lib/trading';

/**
 * App-level cache of reusable Relay deposit addresses (Base / Ethereum / Monad /
 * BNB) so the cross-chain "Add cash" QR shows INSTANTLY.
 *
 * Lifecycle:
 *   1. The backend mints one open deposit address per (wallet, chain) ONCE and
 *      persists it forever (DB).
 *   2. On device, we persist them in SecureStore and hydrate this in-memory
 *      store at app launch (as soon as the Solana wallet is known) — so the
 *      address is available before the user even opens the deposit sheet.
 *   3. `warm()` refreshes/mints any missing addresses in the background and
 *      re-persists. It's safe to call repeatedly (guarded + deduped).
 *
 * Because this lives above the screens, the addresses survive sheet open/close
 * and screen navigation for the whole session — no re-fetch per mount.
 */

// Open deposit addresses are amount-flexible; this seed only satisfies the quote
// that mints the address. The user can send any amount later.
const QUOTE_SEED_USDC = '100';

export type DepositAddressesValue = {
  /** chainId → cached deposit address (empty until hydrated/warmed). */
  addresses: Record<number, RelayDepositAddressResponse>;
  /** Instant lookup for a chain; null if not cached yet. */
  getAddress: (chainId: number) => RelayDepositAddressResponse | null;
  /**
   * Ensure addresses for all chains are minted + cached. Provisions the embedded
   * EVM refund wallet if needed. Fire-and-forget friendly.
   */
  warm: () => Promise<void>;
  /** True once we've hydrated from the on-device cache (instant path ready). */
  hydrated: boolean;
};

const DepositAddressesContext = createContext<DepositAddressesValue | null>(null);

export function DepositAddressesProvider({ children }: { children: React.ReactNode }) {
  const solanaWallet = useEmbeddedSolanaWallet();
  const ethWallet = useEmbeddedEthereumWallet();

  const recipient = solanaWallet.wallets?.[0]?.address ?? null;
  const refundTo = ethWallet.wallets?.[0]?.address ?? null;

  const [addresses, setAddresses] = useState<Record<number, RelayDepositAddressResponse>>({});
  const [hydrated, setHydrated] = useState(false);
  // Latest map kept in a ref so warm() reads/writes without stale closures.
  const mapRef = useRef<Map<number, RelayDepositAddressResponse>>(new Map());
  const warmingRef = useRef(false);
  // Keep a live ref to the eth wallet so warm() can provision without re-binding.
  const ethWalletRef = useRef(ethWallet);
  ethWalletRef.current = ethWallet;

  const commit = useCallback(() => {
    setAddresses(Object.fromEntries(mapRef.current.entries()));
  }, []);

  // (1) Hydrate from the on-device cache the moment the wallet is known.
  useEffect(() => {
    if (!recipient) {
      mapRef.current = new Map();
      setAddresses({});
      setHydrated(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const cached = await loadCachedDepositAddresses(recipient);
      if (cancelled) return;
      // Don't clobber anything warm() already minted while we were loading.
      for (const [chainId, value] of cached.entries()) {
        if (!mapRef.current.has(chainId)) mapRef.current.set(chainId, value);
      }
      commit();
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [recipient, commit]);

  /** Wait briefly for Privy to surface the embedded EVM wallet (refund) address. */
  const ensureRefundAddress = useCallback(async (): Promise<string | null> => {
    const current = ethWalletRef.current.wallets?.[0]?.address;
    if (current) return current;
    await ethWalletRef.current.create().catch(() => {});
    for (let i = 0; i < 20; i += 1) {
      const addr = ethWalletRef.current.wallets?.[0]?.address;
      if (addr) return addr;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return ethWalletRef.current.wallets?.[0]?.address ?? null;
  }, []);

  const warm = useCallback(async () => {
    if (!recipient || warmingRef.current) return;
    warmingRef.current = true;
    try {
      const refund = await ensureRefundAddress();
      if (!refund) return;
      let changed = false;
      await Promise.all(
        RELAY_SOURCE_CHAINS.map(async (c) => {
          const smallest = toSmallestUnits(QUOTE_SEED_USDC, c.usdcDecimals);
          if (!smallest) return;
          const result = await createRelayDepositAddress({
            recipient,
            refundTo: refund,
            originChainId: c.id,
            originCurrency: c.usdcAddress,
            amount: smallest,
          }).catch(() => null);
          if (result) {
            const prev = mapRef.current.get(c.id);
            mapRef.current.set(c.id, result);
            // Only flag a re-render/persist when the address actually changed,
            // so steady-state warms (cache hits) don't churn state in a loop.
            if (!prev || prev.depositAddress !== result.depositAddress) changed = true;
          }
        }),
      );
      if (changed) {
        commit();
        void saveCachedDepositAddresses(recipient, mapRef.current);
      }
    } finally {
      warmingRef.current = false;
    }
  }, [recipient, ensureRefundAddress, commit]);

  // (2) Auto-warm in the background once both wallets exist. This refreshes
  // silently whenever the embedded EVM wallet is already provisioned; the
  // backend cache makes it a no-op (cache hit) after the first ever mint.
  useEffect(() => {
    if (!recipient || !refundTo) return;
    void warm();
  }, [recipient, refundTo, warm]);

  const getAddress = useCallback(
    (chainId: number) => mapRef.current.get(chainId) ?? null,
    [],
  );

  const value = useMemo<DepositAddressesValue>(
    () => ({ addresses, getAddress, warm, hydrated }),
    [addresses, getAddress, warm, hydrated],
  );

  return (
    <DepositAddressesContext.Provider value={value}>{children}</DepositAddressesContext.Provider>
  );
}

/** Null outside the provider — for hosts that may be portalled above it. */
export function useOptionalDepositAddresses(): DepositAddressesValue | null {
  return useContext(DepositAddressesContext);
}

export function useDepositAddresses(): DepositAddressesValue {
  const ctx = useContext(DepositAddressesContext);
  if (!ctx) {
    throw new Error('useDepositAddresses must be used within a DepositAddressesProvider');
  }
  return ctx;
}
