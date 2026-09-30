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
export async function getAnonymousSocialId(privyUserId?: string | null): Promise<string> {
  const normalizedUserId = privyUserId?.trim();
  const key = normalizedUserId
    ? `${SOCIAL_ID_KEY}_${encodeURIComponent(normalizedUserId)}`
    : SOCIAL_ID_KEY;
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
