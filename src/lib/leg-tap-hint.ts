import * as SecureStore from 'expo-secure-store';

const STORAGE_PREFIX = 'bread.leg_tap_hint.seen.v1.';

/**
 * Testing switch: `EXPO_PUBLIC_FORCE_LEG_TAP_HINT=1` shows the hint to everyone,
 * on every sandwich, and never records it as seen. Remove it from `.env` to go
 * back to new users only.
 */
const FORCED = process.env.EXPO_PUBLIC_FORCE_LEG_TAP_HINT === '1';

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

/** Show the "tap an asset" hint until this account opens an asset once. */
export async function shouldShowLegTapHint(userId: string | null): Promise<boolean> {
  if (FORCED) return true;
  if (!userId) return false;

  try {
    return (await SecureStore.getItemAsync(storageKey(userId))) !== '1';
  } catch {
    // A storage failure should not hide useful onboarding guidance.
    return true;
  }
}

export async function markLegTapHintSeen(userId: string | null): Promise<void> {
  if (FORCED || !userId) return;
  await SecureStore.setItemAsync(storageKey(userId), '1');
}
