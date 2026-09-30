import * as SecureStore from 'expo-secure-store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { markShareNudgeDismissed, shouldShowShareNudge } from './share-nudge';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));

const getItemAsync = vi.mocked(SecureStore.getItemAsync);
const setItemAsync = vi.mocked(SecureStore.setItemAsync);

describe('share nudge persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows for an account that has not seen the prompt', async () => {
    getItemAsync.mockResolvedValue(null);

    await expect(shouldShowShareNudge('did:privy:new-user')).resolves.toBe(true);
  });

  it('stays hidden after dismissal', async () => {
    getItemAsync.mockResolvedValue('1');

    await expect(shouldShowShareNudge('did:privy:returning-user')).resolves.toBe(false);
  });

  it('persists dismissal with a SecureStore-safe per-user key', async () => {
    setItemAsync.mockResolvedValue();

    await markShareNudgeDismissed('did:privy:user/123');

    expect(setItemAsync).toHaveBeenCalledWith(
      'bread.share_nudge.dismissed.v1.did_privy_user_123',
      '1',
    );
  });
});
