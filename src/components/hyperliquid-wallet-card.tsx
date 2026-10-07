import React, { useEffect, useRef, useState } from 'react';

import { HyperliquidAccountSheet } from '@/components/hyperliquid-account-sheet';
import { PerpCard, type PerpCardSummary } from '@/components/perp-card';
import type { PerpsAccountSheetRef } from '@/components/perps-account-sheet';
import { getHyperliquidAccount, HyperliquidApiError } from '@/lib/hyperliquid-api';

/** Keeps Hyperliquid cash visible even when this build trades on Phoenix. */
export function HyperliquidWalletCard({
  walletAddress,
  refreshKey = 0,
}: {
  walletAddress: string | null;
  refreshKey?: number;
}) {
  const [summary, setSummary] = useState<PerpCardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [selfRefresh, setSelfRefresh] = useState(0);
  const accountSheetRef = useRef<PerpsAccountSheetRef>(null);
  const previousWallet = useRef(walletAddress);

  useEffect(() => {
    let cancelled = false;
    if (previousWallet.current !== walletAddress) {
      setSummary(null);
      previousWallet.current = walletAddress;
    }
    setLoading(true);

    async function load() {
      try {
        if (!walletAddress) {
          if (!cancelled) setSummary(null);
          return;
        }
        const { account } = await getHyperliquidAccount();
        if (!cancelled) {
          setSummary({
            registered: account.exists,
            portfolioValue: account.accountValue,
            collateral: account.accountValue - account.unrealizedPnl,
            withdrawable: account.withdrawable,
            unrealizedPnl: account.unrealizedPnl,
            positionCount: account.positionCount,
            openOrderCount: 0,
          });
        }
      } catch (error) {
        if (cancelled) return;
        const code = error instanceof HyperliquidApiError ? error.code : null;
        setSummary(code === 'no_evm_wallet' || code === 'no_wallet' ? {
          registered: false,
          portfolioValue: 0,
          collateral: 0,
          withdrawable: 0,
          unrealizedPnl: 0,
          positionCount: 0,
          openOrderCount: 0,
        } : null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [walletAddress, refreshKey, selfRefresh]);

  return (
    <>
      <PerpCard
        venue="hyperliquid"
        summary={summary}
        loading={loading}
        onAddCash={() => accountSheetRef.current?.open('deposit')}
        onWithdraw={() => accountSheetRef.current?.open('withdraw')}
        onActivate={() => accountSheetRef.current?.open('deposit')}
      />
      <HyperliquidAccountSheet
        ref={accountSheetRef}
        onAccountChanged={() => setSelfRefresh((value) => value + 1)}
      />
    </>
  );
}
