import * as SecureStore from 'expo-secure-store';

import type { RelayDepositAddressResponse } from '@/lib/api';

/**
 * Persistent client-side cache for reusable Relay deposit addresses, so the
 * cross-chain Add Cash QR shows instantly across app launches — no network
 * round-trip on repeat visits.
 *
 * The backend already persists one open deposit address per (wallet, chain) and
 * returns it instantly, but caching on-device too means the QR renders the very
 * first frame the user taps a chain, even before the backend responds (or while
 * offline). Entries are keyed per recipient wallet and refreshed in the
 * background each session.
 */
const STORAGE_PREFIX = 'bread_relay_deposit_addr_v1_';

function sanitizeKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function storageKey(recipient: string): string {
  return `${STORAGE_PREFIX}${sanitizeKey(recipient)}`;
}

/** chainId → cached deposit address response. */
type CacheShape = Record<string, RelayDepositAddressResponse>;

function isCachedEntry(value: unknown): value is RelayDepositAddressResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RelayDepositAddressResponse).depositAddress === 'string'
  );
}

/** Load all cached deposit addresses for a recipient, keyed by chain id. */
export async function loadCachedDepositAddresses(
  recipient: string,
): Promise<Map<number, RelayDepositAddressResponse>> {
  const map = new Map<number, RelayDepositAddressResponse>();
  try {
    const raw = await SecureStore.getItemAsync(storageKey(recipient));
    if (!raw) return map;
    const parsed = JSON.parse(raw) as CacheShape;
    for (const [key, value] of Object.entries(parsed)) {
      const chainId = Number(key);
      if (Number.isFinite(chainId) && isCachedEntry(value)) {
        map.set(chainId, value);
      }
    }
  } catch {
    // Corrupt / unreadable cache is non-fatal — we just refetch.
  }
  return map;
}

/** Persist the full chain→address map for a recipient. Best-effort. */
export async function saveCachedDepositAddresses(
  recipient: string,
  addresses: Map<number, RelayDepositAddressResponse>,
): Promise<void> {
  try {
    const obj: CacheShape = {};
    for (const [chainId, value] of addresses.entries()) {
      obj[String(chainId)] = value;
    }
    await SecureStore.setItemAsync(storageKey(recipient), JSON.stringify(obj));
  } catch {
    // Persisting is an optimization; never let it break the deposit flow.
  }
}
