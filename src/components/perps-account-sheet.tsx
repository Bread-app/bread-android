import { BottomSheetBackdrop, BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet';
import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { BlurBackdrop } from '@/components/blur-backdrop';
import { PressableScale } from '@/components/pressable-scale';
import { TradeAmountPad } from '@/components/trade-amount-sheet';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useCash } from '@/hooks/use-cash';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { withAlpha } from '@/lib/color-utils';
import { useThemeStore } from '@/lib/theme-store';
import { useToast } from '@/lib/toast-store';
import { SOLANA_USDC_MINT } from '@/lib/trading';
import { useWalletStore } from '@/lib/wallet-store';

const F = Fonts.rounded;

export type PerpsAccountSheetMode = 'deposit' | 'withdraw';

export type PerpsAccountSheetRef = {
  /** Opens the sheet on a direction. Call straight from the tap gesture. */
  open: (mode?: PerpsAccountSheetMode) => void;
  close: () => void;
};

export type PerpsCollateralMove = { mode: PerpsAccountSheetMode; amountUsd: number };

export type PerpsAccountSheetProps = {
  /**
   * Fired after any successful activation, deposit or withdrawal. A move carries
   * its direction and how much the perps balance changed, so the caller can show
   * the new balance at once; the real re-read should wait {@link SETTLE_REFRESH_MS},
   * since an immediate one can still return the pre-move figure and snap the card back.
   */
  onAccountChanged?: (move?: PerpsCollateralMove) => void;
};

/**
 * How long after a move lands before balances are re-read for real. The move is
 * acknowledged at "processed", and both the RPC balance read and the venue's
 * account view trail that by a beat.
 */
export const SETTLE_REFRESH_MS = 2_500;

/** The perps account as the sheet shows it. All figures are USD. */
export type PerpsAccountSnapshot = {
  /** False shows the activation screen in place of the keypad. */
  active: boolean;
  balanceUsd: number;
  withdrawableUsd: number;
  inMarginUsd: number;
  minDepositUsd: number;
  minWithdrawUsd: number;
};

export type PerpsMoveOutcome = {
  /** The amount the toast names. */
  amountUsd: number;
  /** Applied to spendable cash at once: negative on the way in, positive on the way out. */
  cashDeltaUsd: number;
  /** Applied to the perps card at once, with the same sign convention reversed. */
  perpsDeltaUsd: number;
  /** Overrides the default "$X moved to …" success toast. */
  toast?: { message: string; kind: 'success' | 'info' };
};

/**
 * Everything venue-specific about the perps account. The sheet owns the keypad,
 * the toasts and the optimistic updates; an adapter owns how money actually moves.
 */
export type PerpsAccountAdapter = {
  /** False until the wallet(s) this venue signs with are available. */
  ready: boolean;
  /**
   * The current account. `null` means there is no account to show (no wallet,
   * not signed in); throwing keeps the previous read rather than zeroing it.
   */
  load: () => Promise<PerpsAccountSnapshot | null>;
  /** Max withdrawal is sized from the server's live free collateral. */
  supportsWithdrawAll?: boolean;
  move: (mode: PerpsAccountSheetMode, amount: string, options?: { all?: boolean }) => Promise<PerpsMoveOutcome>;
  /** Venues that need an explicit account-creation step before the first move. */
  activate?: () => Promise<{ confirmed: boolean }>;
  activateCopy: { title: string; body: string };
  /** Small print under the keypad. */
  notice: (mode: PerpsAccountSheetMode, account: PerpsAccountSnapshot) => string;
};

/**
 * The perps account's home: activate it, move cash in, move collateral out.
 *
 * Perps money is **not** spendable cash — part of it is locked as margin against
 * open positions, which is why it is never folded into the cash balance. This
 * sheet is where that pool is operated on directly; everywhere else the number
 * is read-only.
 *
 * Both directions run on the same keypad so "in" and "out" are visibly the same
 * gesture. The server is the authority on both caps — the local caps here only
 * keep the confirm button honest.
 */
export const PerpsAccountSheet = React.forwardRef<
  PerpsAccountSheetRef,
  PerpsAccountSheetProps & { adapter: PerpsAccountAdapter }
>(function PerpsAccountSheet({ adapter, onAccountChanged }, ref) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const toast = useToast();
  const cash = useCash();
  const { optimisticAdjust } = useWalletStore();
  const { height } = useWindowDimensions();

  const sheetRef = useRef<BottomSheetModal>(null);
  const isOpenRef = useRef(false);
  // The adapter is rebuilt every render; reads go through a ref so `load` stays
  // stable and the open effect doesn't re-fire on each render.
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;

  const [mode, setMode] = useState<PerpsAccountSheetMode>('deposit');
  const [account, setAccount] = useState<PerpsAccountSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [maxSelected, setMaxSelected] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAccount(await adapterRef.current.load());
    } catch {
      // A transient failure leaves the previous read in place rather than
      // replacing real figures with zeroes.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useImperativeHandle(
    ref,
    () => ({
      open(nextMode: PerpsAccountSheetMode = 'deposit') {
        setMode(nextMode);
        setAmount('');
        setMaxSelected(false);
        setError(null);
        isOpenRef.current = true;
        // Presented straight from the tap gesture — see
        // [[bottom-sheet-present-pattern]]; an isOpen effect drops the first open.
        sheetRef.current?.present();
        void load();
      },
      close() {
        if (!isOpenRef.current) return;
        sheetRef.current?.dismiss();
      },
    }),
    [load],
  );

  // Everything the portalled sheet content needs is computed here, in the
  // component body: gorhom renders those children above our providers, so a
  // store read inside them comes back empty — see [[bottom-sheet-context-loss]].
  const active = Boolean(account?.active);
  const withdrawable = Math.max(0, account?.withdrawableUsd ?? 0);
  const inMargin = Math.max(0, account?.inMarginUsd ?? 0);
  const spendableCash = cash.idleUsdc;
  const available = mode === 'withdraw' ? withdrawable : spendableCash;
  const minimum = mode === 'withdraw' ? (account?.minWithdrawUsd ?? 0.01) : (account?.minDepositUsd ?? 0.01);
  const typed = Number(amount);
  const withdrawAll = mode === 'withdraw' && maxSelected && Boolean(adapter.supportsWithdrawAll);
  const moveAmount = withdrawAll ? available : typed;

  const tapDigit = useCallback((digit: string) => {
    setError(null);
    setMaxSelected(false);
    setAmount((current) => {
      if (digit === 'del') return current.slice(0, -1);
      if (digit === '.') {
        if (current.includes('.')) return current;
        return current === '' ? '0.' : `${current}.`;
      }
      if (current === '0') return digit;
      const next = `${current}${digit}`;
      const [, decimals] = next.split('.');
      // USDC settles at six decimals, but two is all this control needs.
      if (decimals && decimals.length > 2) return current;
      return next;
    });
  }, []);

  const tapPreset = useCallback(
    (preset: string) => {
      setError(null);
      const percent = preset.endsWith('%') ? Number(preset.slice(0, -1)) : null;
      const isMax = preset.toLowerCase() === 'max';
      setMaxSelected(isMax);
      // Phoenix Max uses the server's withdraw-all path. Other presets round
      // down to cents so the displayed amount never exceeds the real balance.
      const value =
        isMax ? available : (available * (percent ?? 0)) / 100;
      const useWithdrawAll = mode === 'withdraw' && isMax && adapter.supportsWithdrawAll;
      const displayValue = useWithdrawAll ? value : Math.floor(value * 100) / 100;
      setAmount(displayValue > 0 ? displayValue.toFixed(2) : '');
    },
    [available, mode, adapter.supportsWithdrawAll],
  );

  const submitMove = useCallback(async () => {
    if (!adapter.ready || submitting || !Number.isFinite(moveAmount) || moveAmount < minimum || moveAmount > available + 1e-6) return;
    setSubmitting(true);
    setError(null);
    const outbound = mode === 'withdraw';
    const toastId = toast.showToast(
      outbound ? 'Moving to cash…' : 'Moving to perps…',
      'processing',
      0,
    );
    try {
      const outcome = await adapter.move(mode, amount, { all: withdrawAll });
      // The move has landed, so show it now rather than after two more reads.
      // Cash is adjusted in the wallet store directly; the perps figure is the
      // caller's, so it gets the move and applies it the same way.
      optimisticAdjust(SOLANA_USDC_MINT, outcome.cashDeltaUsd, outcome.cashDeltaUsd);
      onAccountChanged?.({ mode, amountUsd: Math.abs(outcome.perpsDeltaUsd) });
      // Then the real reads, once they can see it. `cash.refresh` goes straight to
      // the wallet store ungated — this is the one path that credits spendable
      // USDC directly, so a 15s-stale read would show the money as still gone.
      setTimeout(() => {
        void load();
        void cash.refresh(true);
      }, SETTLE_REFRESH_MS);
      toast.dismissToast(toastId);
      toast.showToast(
        outcome.toast?.message ??
          `${formatUsd(outcome.amountUsd)} moved to ${outbound ? 'cash' : 'perps'}`,
        outcome.toast?.kind ?? 'success',
      );
      sheetRef.current?.dismiss();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not move funds.';
      setError(message);
      toast.dismissToast(toastId);
      toast.showToast(message, 'error');
    } finally {
      setSubmitting(false);
    }
  }, [adapter, amount, available, cash, load, minimum, mode, moveAmount, onAccountChanged, optimisticAdjust, submitting, toast, withdrawAll]);

  const activate = adapter.activate;
  const register = useCallback(async () => {
    if (registering || !activate) return;
    setRegistering(true);
    setError(null);
    const toastId = toast.showToast('Activating perps…', 'processing', 0);
    try {
      const result = await activate();
      await load();
      onAccountChanged?.();
      toast.dismissToast(toastId);
      toast.showToast(
        result.confirmed ? 'Perps account activated' : 'Activation submitted — refresh in a moment',
        result.confirmed ? 'success' : 'info',
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Perps account activation failed.';
      setError(message);
      toast.dismissToast(toastId);
      toast.showToast(message, 'error');
    } finally {
      setRegistering(false);
    }
  }, [activate, load, onAccountChanged, registering, toast]);

  const handleDismiss = useCallback(() => {
    isOpenRef.current = false;
  }, []);

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => <BlurBackdrop {...props} />,
    [],
  );
  const snapPoints = useMemo(() => ['92%'], []);

  const outbound = mode === 'withdraw';
  const canConfirm =
    !submitting &&
    adapter.ready &&
    active &&
    Number.isFinite(moveAmount) &&
    moveAmount >= minimum &&
    moveAmount <= available + 1e-6;

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      onDismiss={handleDismiss}
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={styles.hiddenHandleIndicator}
      backgroundStyle={styles.sheetBg}
    >
      <BottomSheetView style={[styles.sheetContent, { height: height * 0.92 }]}>
        {loading && !account ? (
          <View style={styles.centered}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
          </View>
        ) : !active ? (
          <ActivateBody
            title={adapter.activateCopy.title}
            body={adapter.activateCopy.body}
            registering={registering}
            error={error}
            onActivate={() => void register()}
            onBack={() => sheetRef.current?.dismiss()}
          />
        ) : (
          <>
            <View style={styles.summary}>
              <Text style={styles.summaryLabel}>PERPS BALANCE</Text>
              <Text style={styles.summaryValue}>{formatUsd(account?.balanceUsd ?? 0)}</Text>
              <Text style={styles.summaryDetail}>
                {formatUsd(withdrawable)} available
                {inMargin > 0 ? ` · ${formatUsd(inMargin)} in margin` : ''}
              </Text>
            </View>

            {/* Direction is a control, not a separate screen: the same balances
                stay on screen so the user can see both sides of the move. */}
            <View style={styles.modeRow}>
              <ModeTab
                label="Add cash"
                active={!outbound}
                onPress={() => {
                  setMode('deposit');
                  setAmount('');
                  setMaxSelected(false);
                  setError(null);
                }}
              />
              <ModeTab
                label="Withdraw"
                active={outbound}
                onPress={() => {
                  setMode('withdraw');
                  setAmount('');
                  setMaxSelected(false);
                  setError(null);
                }}
              />
            </View>

            <View style={styles.padWrap}>
              <TradeAmountPad
                title={outbound ? 'Move to cash' : 'Move to perps'}
                symbol={outbound ? 'Perps → Cash' : 'Cash → Perps'}
                subtitleLabel={`${formatUsd(available)} free to move`}
                amount={amount}
                message={error}
                availableLabel={
                  outbound ? `Perps: ${formatUsd(withdrawable)}` : `Cash: ${formatUsd(spendableCash)}`
                }
                cashLabel={formatUsd(outbound ? spendableCash : withdrawable)}
                presets={['25%', '50%', 'Max']}
                confirmLabel={outbound ? 'Move to cash' : 'Move to perps'}
                submittingLabel="Moving..."
                submitting={submitting}
                canConfirm={canConfirm}
                onSubmit={submitMove}
                onTapDigit={tapDigit}
                onTapPreset={tapPreset}
                onBack={() => sheetRef.current?.dismiss()}
                noticeText={account ? adapter.notice(mode, account) : undefined}
                scrollEnabled={false}
              />
            </View>
          </>
        )}
      </BottomSheetView>
    </BottomSheetModal>
  );
});

function ModeTab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.modeTab, active && styles.modeTabActive]}
    >
      <Text style={[styles.modeTabText, active && styles.modeTabTextActive]}>{label}</Text>
    </PressableScale>
  );
}

function ActivateBody({
  title,
  body,
  registering,
  error,
  onActivate,
  onBack,
}: {
  title: string;
  body: string;
  registering: boolean;
  error: string | null;
  onActivate: () => void;
  onBack: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  return (
    <View style={styles.activate}>
      <Text style={styles.activateTitle}>{title}</Text>
      <Text style={styles.activateBody}>{body}</Text>
      {error ? <Text style={styles.activateError}>{error}</Text> : null}
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Activate perps account"
        disabled={registering}
        onPress={onActivate}
        style={[styles.activateButton, registering && styles.activateButtonDisabled]}
      >
        {registering ? <ActivityIndicator size="small" color={colors.actionPrimaryText} /> : null}
        <Text style={styles.activateButtonText}>
          {registering ? 'Activating…' : 'Activate perps'}
        </Text>
      </PressableScale>
      <Pressable accessibilityRole="button" onPress={onBack} hitSlop={10}>
        <Text style={styles.activateDismiss}>Not now</Text>
      </Pressable>
    </View>
  );
}

export function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    hiddenHandleIndicator: { backgroundColor: 'transparent' },
    sheetBg: {
      backgroundColor: c.background,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
    },
    sheetContent: { paddingHorizontal: 16, paddingBottom: 28, paddingTop: 8 },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

    summary: { paddingHorizontal: 4, paddingTop: 4 },
    summaryLabel: {
      fontFamily: F,
      color: c.textTertiary,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.6,
    },
    summaryValue: {
      fontFamily: F,
      color: c.text,
      fontSize: 26,
      fontWeight: '900',
      marginTop: 2,
      fontVariant: ['tabular-nums'],
    },
    summaryDetail: {
      fontFamily: F,
      color: c.textSecondary,
      fontSize: 12,
      fontWeight: '600',
      marginTop: 2,
      fontVariant: ['tabular-nums'],
    },

    modeRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 12,
      marginBottom: 4,
      paddingHorizontal: 4,
    },
    modeTab: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 9,
      borderRadius: 999,
      backgroundColor: c.surfaceAlt,
    },
    modeTabActive: { backgroundColor: withAlpha(c.actionPrimary, 0.16) },
    modeTabText: { fontFamily: F, fontSize: 13, fontWeight: '800', color: c.textSecondary },
    modeTabTextActive: { color: c.actionPrimary },

    // The pad sizes itself to the space left under the summary and tabs; without
    // flex:1 its keypad overflows the fixed-height sheet.
    padWrap: { flex: 1 },

    activate: { flex: 1, justifyContent: 'center', gap: 12, paddingHorizontal: 8 },
    activateTitle: { fontFamily: F, color: c.text, fontSize: 22, fontWeight: '900' },
    activateBody: {
      fontFamily: F,
      color: c.textSecondary,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '600',
    },
    activateError: { fontFamily: F, color: c.negative, fontSize: 13, fontWeight: '700' },
    activateButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: 4,
      paddingVertical: 15,
      borderRadius: 999,
      backgroundColor: c.actionPrimary,
    },
    activateButtonDisabled: { opacity: 0.6 },
    activateButtonText: {
      fontFamily: F,
      color: c.actionPrimaryText,
      fontSize: 16,
      fontWeight: '800',
    },
    activateDismiss: {
      fontFamily: F,
      color: c.textTertiary,
      fontSize: 13,
      fontWeight: '700',
      textAlign: 'center',
      marginTop: 4,
    },
  });
