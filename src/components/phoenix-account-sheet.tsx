import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import React from 'react';

import {
  PerpsAccountSheet,
  SETTLE_REFRESH_MS,
  type PerpsAccountAdapter,
  type PerpsAccountSheetMode,
  type PerpsAccountSheetProps,
  type PerpsAccountSheetRef,
  type PerpsCollateralMove,
} from '@/components/perps-account-sheet';
import { signAndSendBase64WithResult } from '@/lib/cash';
import {
  buildPhoenixDeposit,
  buildPhoenixWithdraw,
  getPhoenixAccount,
  PhoenixApiError,
  registerPhoenixAccount,
} from '@/lib/phoenix-api';

/** Phoenix's own minimum deposit, mirrored so the pad can refuse it locally. */
const MIN_MOVE_USD = 0.01;

export { SETTLE_REFRESH_MS };
export type PhoenixAccountSheetMode = PerpsAccountSheetMode;
export type PhoenixAccountSheetRef = PerpsAccountSheetRef;
export type PhoenixAccountSheetProps = PerpsAccountSheetProps;
export type PhoenixCollateralMove = PerpsCollateralMove;

/**
 * The Phoenix perps account: activate it (Bread's payer registers the trader),
 * move cash in, move collateral out — each a single Solana transaction Bread
 * sponsors.
 *
 * The server is the authority on both caps — Max withdraws Phoenix's live free
 * collateral, typed withdrawals are checked against it, and deposits are
 * checked against the wallet's USDC.
 */
export const PhoenixAccountSheet = React.forwardRef<
  PhoenixAccountSheetRef,
  PhoenixAccountSheetProps
>(function PhoenixAccountSheet(props, ref) {
  const solanaWallet = useEmbeddedSolanaWallet();
  const wallet = solanaWallet.wallets?.[0] ?? null;

  const adapter: PerpsAccountAdapter = {
    ready: !!wallet,
    supportsWithdrawAll: true,
    async load() {
      try {
        const response = await getPhoenixAccount();
        const cross = response.account.registered ? response.account.cross : null;
        const withdrawable = Math.max(0, cross?.effectiveCollateralForWithdrawals ?? 0);
        return {
          active: response.account.registered,
          balanceUsd: cross?.portfolioValue ?? 0,
          withdrawableUsd: withdrawable,
          inMarginUsd: Math.max(0, (cross?.effectiveCollateral ?? 0) - withdrawable),
          minDepositUsd: MIN_MOVE_USD,
          minWithdrawUsd: MIN_MOVE_USD,
        };
      } catch (cause) {
        // "No wallet yet" and "not signed in" are not failures — there is simply
        // no perps account. Anything else keeps the previous read.
        const code = cause instanceof PhoenixApiError ? cause.code : null;
        if (code === 'no_wallet' || code === 'Unauthorized') return null;
        throw cause;
      }
    },
    async move(mode, amount, options) {
      if (!wallet) throw new Error('Your wallet is still loading.');
      const outbound = mode === 'withdraw';
      const built = outbound ? await buildPhoenixWithdraw(amount, options) : await buildPhoenixDeposit(amount);
      // Acknowledged once the move is in a block ("processed"), like a buy; a
      // slow slot still falls back to the full confirmation window.
      await signAndSendBase64WithResult(wallet, built.transaction, {
        lastValidBlockHeight: built.lastValidBlockHeight,
        fastConfirm: true,
        requireConfirmed: true,
      });
      const signedUsd = outbound ? built.amountUsd : -built.amountUsd;
      return { amountUsd: built.amountUsd, cashDeltaUsd: signedUsd, perpsDeltaUsd: -signedUsd };
    },
    async activate() {
      try {
        const result = await registerPhoenixAccount();
        // Phoenix broadcasts through its own onboarder, and its public trader view
        // can trail confirmation briefly. Poll rather than leaving a stale badge.
        for (let attempt = 0; attempt < 8; attempt += 1) {
          if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 750));
          try {
            const next = await getPhoenixAccount();
            if (next.account.registered) return { confirmed: true };
          } catch {
            // A transient read must not turn a submitted activation into an error.
          }
        }
        return { confirmed: result.status === 'already_registered' };
      } catch (cause) {
        const code = cause instanceof PhoenixApiError ? cause.code : null;
        throw new Error(
          code === 'phoenix_registration_not_configured'
            ? 'Bread’s funded registration payer is not configured.'
            : code === 'phoenix_registration_invalid_response'
              ? 'Phoenix returned an unexpected registration transaction. Nothing was submitted.'
              : code === 'phoenix_registration_failed'
                ? 'Phoenix could not activate this account. Please try again.'
                : cause instanceof Error
                  ? cause.message
                  : 'Perps account activation failed.',
        );
      }
    },
    activateCopy: {
      title: 'Activate perps',
      body: 'Create your Phoenix trading account to trade with leverage and go short. Bread covers the Solana fee and account rent; no invite or referral code is required.',
    },
    notice: (mode) =>
      mode === 'withdraw'
        ? 'Withdrawals clear through Phoenix’s queue — large amounts can settle a little later.'
        : 'One wallet approval. Bread pays the Solana network fee.',
  };

  return <PerpsAccountSheet ref={ref} adapter={adapter} {...props} />;
});
