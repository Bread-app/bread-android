import { BottomSheetBackdrop, BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet';
import { useEmbeddedEthereumWallet } from '@privy-io/expo';
import React, { useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { BlurBackdrop } from '@/components/blur-backdrop';
import { PhoenixClosePad } from '@/components/phoenix-close-pad';
import { SlideToConfirm } from '@/components/trade-amount-sheet';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { withAlpha } from '@/lib/color-utils';
import type { EvmSigningWallet } from '@/lib/evm-sign';
import {
  closeHyperliquidPosition,
  getHyperliquidAccount,
  type HyperliquidPosition,
} from '@/lib/hyperliquid-api';
import { withdrawFromHyperliquid } from '@/lib/hyperliquid-trade';
import { useThemeStore } from '@/lib/theme-store';
import { useToast } from '@/lib/toast-store';
import { useTradeFx } from '@/lib/trade-fx';

const F = Fonts.rounded;
/** Relay's floor; a smaller freed amount stays in perps rather than failing the close. */
const MIN_RETURN_USD = 1;

export type HyperliquidPositionSheetRef = {
  /** Present from the tap gesture — see [[bottom-sheet-present-pattern]]. */
  open: (position: HyperliquidPosition) => void;
  close: () => void;
};

/** "xyz:NVDA" → "NVDA". */
export function hyperliquidDisplaySymbol(coin: string): string {
  return coin.includes(':') ? coin.split(':')[1] : coin;
}

/**
 * A Hyperliquid position's exit: how much to close, what it realizes, and
 * whether the freed money goes back to cash. The close itself is a reduce-only
 * market order the server signs with the user's trading key; returning to cash
 * is the same two-signature move as the perps account sheet's "Move to cash".
 */
export const HyperliquidPositionSheet = React.forwardRef<
  HyperliquidPositionSheetRef,
  { onChanged?: () => void }
>(function HyperliquidPositionSheet({ onChanged }, ref) {
  const styles = useThemedStyles(makeStyles);
  const { colors, scheme } = useThemeStore();
  const isDark = scheme === 'dark';
  const toast = useToast();
  const tradeFx = useTradeFx();
  const { height } = useWindowDimensions();
  // Read in the body: gorhom portals the content above the providers.
  const evmWallet = (useEmbeddedEthereumWallet().wallets?.[0] ?? null) as EvmSigningWallet | null;

  const sheetRef = useRef<BottomSheetModal>(null);
  const [position, setPosition] = useState<HyperliquidPosition | null>(null);
  const [percent, setPercent] = useState(100);
  const [returnToCash, setReturnToCash] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useImperativeHandle(
    ref,
    () => ({
      open(next) {
        setPosition(next);
        setPercent(100);
        setReturnToCash(true);
        setSubmitting(false);
        sheetRef.current?.present();
      },
      close() {
        sheetRef.current?.dismiss();
      },
    }),
    [],
  );

  const markPrice = position && position.size > 0 ? position.positionValueUsd / position.size : null;
  const symbol = position ? hyperliquidDisplaySymbol(position.coin) : '';

  const submit = useCallback(async () => {
    if (!position || submitting) return;
    setSubmitting(true);
    const fraction = percent / 100;
    const receiptBase = {
      action: 'close' as const,
      side: position.side,
      symbol,
      leverage: position.leverage,
      entryPrice: position.entryPx,
      marginUsd: position.marginUsedUsd * fraction,
    };
    const receiptId = tradeFx.playPerp({ ...receiptBase, loading: true });
    try {
      const result = await closeHyperliquidPosition({ market: position.coin, fraction });
      tradeFx.updatePerp(receiptId, {
        ...receiptBase,
        exitPrice: result.avgPx,
        pnlUsd: result.pnlUsd,
        loading: false,
      });
      sheetRef.current?.dismiss();
      onChanged?.();

      if (returnToCash && evmWallet) {
        // Whatever is free once the close settles, capped at what this close freed
        // — other positions' margin and untouched balance stay in perps.
        const freed = position.marginUsedUsd * fraction + result.pnlUsd;
        const { account } = await getHyperliquidAccount();
        const amount = Math.floor(Math.min(account.withdrawable, freed) * 100) / 100;
        if (amount >= MIN_RETURN_USD) {
          const toastId = toast.showToast('Moving to cash…', 'processing', 0);
          try {
            const { prepared, delivered } = await withdrawFromHyperliquid(evmWallet, amount.toFixed(2));
            toast.dismissToast(toastId);
            toast.showToast(
              delivered === 'timeout'
                ? `$${prepared.amountOutUsd.toFixed(2)} is on its way to cash`
                : `$${prepared.amountOutUsd.toFixed(2)} moved to cash`,
              delivered === 'timeout' ? 'info' : 'success',
            );
            onChanged?.();
          } catch (cause) {
            toast.dismissToast(toastId);
            // The close stands; only the transfer back failed, and the money is
            // still in perps where the account sheet can move it.
            toast.showToast(
              `Closed, but moving to cash failed: ${cause instanceof Error ? cause.message : 'try again from Perps'}`,
              'error',
            );
          }
        }
      }
    } catch (cause) {
      tradeFx.dismissPerp(receiptId);
      toast.showToast(cause instanceof Error ? cause.message : 'Could not close the position.', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [evmWallet, onChanged, percent, position, returnToCash, submitting, symbol, toast, tradeFx]);

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => <BlurBackdrop {...props} />,
    [],
  );
  const snapPoints = useMemo(() => ['88%'], []);
  const pnlColor = (position?.unrealizedPnlUsd ?? 0) >= 0 ? colors.positive : colors.negative;

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={styles.hiddenHandle}
      backgroundStyle={styles.sheetBg}
    >
      <BottomSheetView style={[styles.content, { height: height * 0.88 }]}>
        {position ? (
          <>
            <View style={styles.header}>
              <View>
                <Text style={styles.symbol}>{symbol}</Text>
                <Text style={[styles.side, { color: position.side === 'long' ? colors.positive : colors.negative }]}>
                  {position.side.toUpperCase()} {position.leverage}x · {position.marginType}
                </Text>
              </View>
              <View style={styles.headerRight}>
                <Text style={styles.value}>{usd(position.marginUsedUsd + position.unrealizedPnlUsd)}</Text>
                <Text style={[styles.pnl, { color: pnlColor }]}>
                  {position.unrealizedPnlUsd >= 0 ? '+' : '−'}
                  {usd(Math.abs(position.unrealizedPnlUsd))}
                </Text>
              </View>
            </View>

            <View style={styles.stats}>
              <Stat label="Entry" value={usd(position.entryPx)} />
              <Stat label="Mark" value={markPrice === null ? '—' : usd(markPrice)} />
              <Stat label="Liq." value={position.liquidationPx === null ? '—' : usd(position.liquidationPx)} />
            </View>

            <View style={styles.pad}>
              <PhoenixClosePad
                unrealizedPnl={position.unrealizedPnlUsd}
                percent={percent}
                onPercentChange={setPercent}
                returnToCash={returnToCash}
                onReturnToCashChange={setReturnToCash}
              />
            </View>

            <SlideToConfirm
              actionLabel={percent >= 100 ? 'Close' : `Close ${Math.round(percent)}%`}
              amountLabel={`${usd(position.positionValueUsd * (percent / 100))} out`}
              actionColor={colors.actionSell}
              trackColor={withAlpha(colors.actionSell, isDark ? 0.2 : 0.24)}
              trackBorderColor={withAlpha(colors.actionSell, isDark ? 0.48 : 0.42)}
              canConfirm={!submitting}
              submitting={submitting}
              submittingLabel="Closing…"
              onComplete={() => void submit()}
            />
          </>
        ) : null}
      </BottomSheetView>
    </BottomSheetModal>
  );
});

function Stat({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function usd(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    hiddenHandle: { backgroundColor: 'transparent' },
    sheetBg: { backgroundColor: c.background, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
    content: { paddingHorizontal: 16, paddingBottom: 28, paddingTop: 8, gap: 14 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    headerRight: { alignItems: 'flex-end' },
    symbol: { fontFamily: F, color: c.text, fontSize: 24, fontWeight: '900' },
    side: { fontFamily: F, fontSize: 13, fontWeight: '800', marginTop: 2 },
    value: { fontFamily: F, color: c.text, fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] },
    pnl: { fontFamily: F, fontSize: 13, fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] },
    stats: { flexDirection: 'row', gap: 8 },
    stat: { flex: 1, backgroundColor: c.surfaceAlt, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12 },
    statLabel: { fontFamily: F, color: c.textTertiary, fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
    statValue: { fontFamily: F, color: c.text, fontSize: 14, fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] },
    pad: { flex: 1 },
  });
