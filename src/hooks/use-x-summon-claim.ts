import { usePrivy } from '@privy-io/expo';
import { useEffect, useRef } from 'react';

import { claimXSummonedSandwiches, getXIdentityFromLinkedAccounts } from '@/lib/api';
import { useToast } from '@/lib/toast-store';

/**
 * One-shot post-sign-in hook: if the Privy user has a linked X account, call
 * /api/x/claim and surface a toast when the backend transferred any unclaimed
 * X-summoned sandwiches over. Lives inside <ToastProvider> via a small
 * `<XSummonClaim />` wrapper so the toast handle is in scope.
 *
 * The backend is idempotent — calling it again returns claimedCount=0 — so
 * the per-session guard is just a small optimization, not a correctness gate.
 * If the request fails the guard is released so the next session retries.
 */
export function useXSummonClaim(): void {
  const { user } = usePrivy();
  const { showToast } = useToast();
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (!user || attemptedRef.current) return;
    const xIdentity = getXIdentityFromLinkedAccounts(user.linked_accounts);
    if (!xIdentity) return;

    attemptedRef.current = true;
    void claimXSummonedSandwiches({
      privyUserId: user.id,
      xUserId: xIdentity.xUserId,
      xHandle: xIdentity.xHandle,
    })
      .then((result) => {
        if (result.claimedCount > 0) {
          const noun = result.claimedCount === 1 ? 'sandwich' : 'sandwiches';
          showToast(
            `Claimed ${result.claimedCount} ${noun} from your X posts`,
            'success',
            4500,
          );
        }
      })
      .catch(() => {
        attemptedRef.current = false;
      });
  }, [user, showToast]);
}
