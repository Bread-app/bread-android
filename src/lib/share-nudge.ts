import * as SecureStore from 'expo-secure-store';

const STORAGE_PREFIX = 'bread.share_nudge.dismissed.v1.';

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

/** Show the sharing coachmark until this account dismisses or acts on it. */
export async function shouldShowShareNudge(userId: string | null): Promise<boolean> {
  if (!userId) return false;

  try {
    return (await SecureStore.getItemAsync(storageKey(userId))) !== '1';
  } catch {
    // A storage failure should not hide useful onboarding guidance.
    return true;
  }
}

export async function markShareNudgeDismissed(userId: string | null): Promise<void> {
  if (!userId) return;
  await SecureStore.setItemAsync(storageKey(userId), '1');
}
