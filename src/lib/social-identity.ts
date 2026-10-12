import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const SOCIAL_ID_KEY = 'bread_social_anonymous_id_v2';

function randomHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function createAnonymousId() {
  return `anon_${randomHex(Crypto.getRandomBytes(24))}`;
}

/**
 * Returns this installation's fallback social ID.
 *
 * This used to be one value per device. That let a newly signed-in account
 * inherit the previous account's likes, so its first tap could accidentally
 * *unlike* a sandwich instead of liking it. Scope the persisted ID to the
 * authenticated Privy user while retaining a device-only fallback for the
 * short unauthenticated bootstrap period. Authenticated likes are now owned by
 * the verified backend account; this value is also sent so older device likes
 * can be claimed without adding a second count.
 */
const resolved = new Map<string, Promise<string>>();

export function getAnonymousSocialId(privyUserId?: string | null): Promise<string> {
  const normalizedUserId = privyUserId?.trim();
  // SecureStore keys allow only [A-Za-z0-9._-]. Privy ids are `did:privy:…`,
  // and the old `encodeURIComponent` form (`did%3Aprivy%3A…`) was rejected, so
  // every call for a signed-in user fell into the catch and minted a NEW id —
  // nothing keyed on this value (feed caches, legacy-like claims) ever matched.
  const key = normalizedUserId
    ? `${SOCIAL_ID_KEY}_${normalizedUserId.replace(/[^A-Za-z0-9._-]/g, '_')}`
    : SOCIAL_ID_KEY;
  // One read per key per process: concurrent first calls would otherwise each
  // see no saved value and mint different ids.
  let pending = resolved.get(key);
  if (!pending) {
    pending = readOrCreate(key);
    resolved.set(key, pending);
  }
  return pending;
}

async function readOrCreate(key: string): Promise<string> {
  try {
    const saved = await SecureStore.getItemAsync(key);
    if (saved && saved.trim().length >= 8) return saved;

    const next = createAnonymousId();
    await SecureStore.setItemAsync(key, next);
    return next;
  } catch {
    return createAnonymousId();
  }
}
