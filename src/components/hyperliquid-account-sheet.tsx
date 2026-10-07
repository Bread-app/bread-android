import { useEmbeddedEthereumWallet, useEmbeddedSolanaWallet } from '@privy-io/expo';
import React, { useRef } from 'react';

import {
  PerpsAccountSheet,
  formatUsd,
  type PerpsAccountAdapter,
  type PerpsAccountSheetProps,
  type PerpsAccountSheetRef,
  type PerpsMoveOutcome,
} from '@/components/perps-account-sheet';
import type { EvmSigningWallet } from '@/lib/evm-sign';
import {
  HyperliquidApiError,
  getHyperliquidAccount,
} from '@/lib/hyperliquid-api';
import { depositToHyperliquid, withdrawFromHyperliquid } from '@/lib/hyperliquid-trade';
import { ensureHyperliquidTradingSetup } from '@/lib/hyperliquid-trading-setup';

/**
 * The Hyperliquid perps account.
 *
 * - **Cash → Perps** is one Solana transaction (Bread pays the fee) that hands
 *   USDC to Relay, which credits the user's Hyperliquid perps balance in about a
 *   second. The first move also creates the Hyperliquid account, which costs
 *   about $1.20 once — disclosed under the keypad before the user confirms.
 * - **Perps → Cash** is two gasless EIP-712 signatures from the embedded EVM
 *   wallet (Relay's nonce mapping, then the HyperCore transfer to Relay). The
 *   backend checks both recover to the user's own wallet before using them.
 *
 * There is no separate activation step once the EVM wallet exists: the first
 * deposit is the activation.
 */
export const HyperliquidAccountSheet = React.forwardRef<PerpsAccountSheetRef, PerpsAccountSheetProps>(
  function HyperliquidAccountSheet(props, ref) {
    const solanaWallet = useEmbeddedSolanaWallet().wallets?.[0] ?? null;
    const ethereum = useEmbeddedEthereumWallet();
    const evmWallet = (ethereum.wallets?.[0] ?? null) as EvmSigningWallet | null;
    // Whether Hyperliquid has seen this address yet — only the notice reads it.
    const existsRef = useRef(true);

    const adapter: PerpsAccountAdapter = {
      ready: !!solanaWallet && !!evmWallet,
      async load() {
        try {
          const { account, limits } = await getHyperliquidAccount();
          existsRef.current = account.exists;
          return {
            active: true,
            balanceUsd: account.accountValue,
            withdrawableUsd: account.withdrawable,
            inMarginUsd: Math.max(0, account.marginUsed),
            minDepositUsd: limits.minDepositUsd,
            minWithdrawUsd: limits.minWithdrawUsd,
          };
        } catch (cause) {
          const code = cause instanceof HyperliquidApiError ? cause.code : null;
          if (code === 'no_wallet' || code === 'Unauthorized') return null;
          // The embedded EVM wallet hasn't been provisioned yet: offer setup.
          if (code === 'no_evm_wallet') {
            return {
              active: false,
              balanceUsd: 0,
              withdrawableUsd: 0,
              inMarginUsd: 0,
              minDepositUsd: 0,
              minWithdrawUsd: 0,
            };
          }
          throw cause;
        }
      },
      async move(mode, amount): Promise<PerpsMoveOutcome> {
        if (!solanaWallet || !evmWallet) throw new Error('Your wallet is still loading.');

        if (mode === 'deposit') {
          // Cash has left on-chain once this returns; Relay's fill is what puts it
          // in perps. A slow fill is in flight, not lost.
          const { build: built, delivered } = await depositToHyperliquid(solanaWallet, amount);
          if (delivered === 'success') {
            // The account now exists, so the one-time trading approvals can land.
            // Silent signatures; a failure here never undoes the deposit — the
            // order flow runs the same check before the first trade.
            await ensureHyperliquidTradingSetup(evmWallet).catch((error) => {
              console.warn('[hyperliquid] trading setup deferred', error);
            });
          }
          return {
            amountUsd: built.amountUsd,
            cashDeltaUsd: -built.amountUsd,
            perpsDeltaUsd: built.amountOutUsd,
            toast:
              delivered === 'timeout'
                ? { message: `${formatUsd(built.amountOutUsd)} is on its way to perps`, kind: 'info' }
                : { message: `${formatUsd(built.amountOutUsd)} moved to perps`, kind: 'success' },
          };
        }

        const { prepared, delivered } = await withdrawFromHyperliquid(evmWallet, amount);
        return {
          amountUsd: prepared.amountUsd,
          cashDeltaUsd: prepared.amountOutUsd,
          perpsDeltaUsd: -prepared.amountUsd,
          toast:
            delivered === 'timeout'
              ? { message: `${formatUsd(prepared.amountOutUsd)} is on its way to cash`, kind: 'info' }
              : { message: `${formatUsd(prepared.amountOutUsd)} moved to cash`, kind: 'success' },
        };
      },
      async activate() {
        // Activation here is only provisioning the embedded EVM wallet; the
        // Hyperliquid account itself is created by the first deposit.
        if (!ethereum.wallets?.[0]) await ethereum.create();
        for (let attempt = 0; attempt < 10; attempt += 1) {
          if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 600));
          try {
            await getHyperliquidAccount();
            return { confirmed: true };
          } catch (cause) {
            const code = cause instanceof HyperliquidApiError ? cause.code : null;
            if (code !== 'no_evm_wallet') throw cause;
          }
        }
        return { confirmed: false };
      },
      activateCopy: {
        title: 'Set up perps',
        body: 'Trade with leverage and go short on Hyperliquid. Bread sets up your perps wallet now; your first move from cash opens the Hyperliquid account, which costs about $1.20 once.',
      },
      notice: (mode, account) =>
        mode === 'withdraw'
          ? 'Two wallet approvals, no network fee. Arrives in cash in about a second.'
          : existsRef.current
            ? 'One wallet approval. Bread pays the Solana fee; Relay charges a few cents.'
            : `Your first move opens your Hyperliquid account — about $1.20 once, $${account.minDepositUsd} minimum.`,
    };

    return <PerpsAccountSheet ref={ref} adapter={adapter} {...props} />;
  },
);
