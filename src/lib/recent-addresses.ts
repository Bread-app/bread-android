import * as SecureStore from 'expo-secure-store';

/**
 * Locally-persisted list of recent withdrawal destinations, keyed per wallet.
 *
 * There's no server record of where a user has sent funds, so the Withdraw
 * sheet's "Recent" list is reconstructed from this on-device log: every
 * successful withdrawal upserts its destination here, newest-first, capped to
 * keep the store small. SecureStore is the same storage the wallet cache and
 * cost-basis ledger already use.
 */

const STORAGE_PREFIX = 'recent_withdraw_addresses_v1';
const SECURE_STORE_KEY_RE = /[^A-Za-z0-9._-]/g;
const MAX_ENTRIES = 25;

export type RecentAddress = {
  address: string;
  /** ISO timestamp of the most recent send to this address. */
  lastUsedAt: string;
};

function storageKey(walletAddress: string) {
  const walletKey = walletAddress.trim().replace(SECURE_STORE_KEY_RE, '_');
  return `${STORAGE_PREFIX}.${walletKey || 'unknown'}`;
}

/** Returns recent destinations newest-first. Never throws. */
export async function loadRecentAddresses(walletAddress: string): Promise<RecentAddress[]> {
  if (!walletAddress) return [];
  try {
    const raw = await SecureStore.getItemAsync(storageKey(walletAddress));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is RecentAddress =>
          !!e &&
          typeof e === 'object' &&
          typeof (e as RecentAddress).address === 'string' &&
          typeof (e as RecentAddress).lastUsedAt === 'string',
      )
      .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  } catch {
    return [];
  }
}

/**
 * Upserts `address` as the most-recently-used destination and returns the
 * updated newest-first list. Best-effort: a write failure just returns the
 * prior list.
 */
export async function recordRecentAddress(
  walletAddress: string,
  address: string,
): Promise<RecentAddress[]> {
  const dest = address.trim();
  if (!walletAddress || !dest) return loadRecentAddresses(walletAddress);
  const existing = await loadRecentAddresses(walletAddress);
  const next: RecentAddress[] = [
    { address: dest, lastUsedAt: new Date().toISOString() },
    ...existing.filter((e) => e.address !== dest),
  ].slice(0, MAX_ENTRIES);
  try {
    await SecureStore.setItemAsync(storageKey(walletAddress), JSON.stringify(next));
  } catch {
    // best-effort
  }
  return next;
}

/** "Used today" / "Used 14 days ago" — humanises a last-used ISO timestamp. */
export function formatLastUsed(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'Recently used';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'Used today';
  if (days === 1) return 'Used yesterday';
  return `Used ${days} days ago`;
}
