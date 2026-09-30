import { BottomSheetBackdrop, BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet';
import { useEmbeddedSolanaWallet } from '@privy-io/expo';
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
import { TradeAmountPad } from '@/components/trade-amount-sheet';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useCash } from '@/hooks/use-cash';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { signAndSendBase64WithResult } from '@/lib/cash';
import { withAlpha } from '@/lib/color-utils';
import {
  buildPhoenixDeposit,
  buildPhoenixWithdraw,
  getPhoenixAccount,
  PhoenixApiError,
  registerPhoenixAccount,
  type PhoenixAccountResponse,
} from '@/lib/phoenix-api';
import { useThemeStore } from '@/lib/theme-store';
import { useToast } from '@/lib/toast-store';
import { SOLANA_USDC_MINT } from '@/lib/trading';
import { useWalletStore } from '@/lib/wallet-store';
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;

/** Phoenix's own minimum deposit, mirrored so the pad can refuse it locally. */
const MIN_MOVE_USD = 0.01;

export type PhoenixAccountSheetMode = 'deposit' | 'withdraw';

export type PhoenixAccountSheetRef = {
  /** Opens the sheet on a direction. Call straight from the tap gesture. */
  open: (mode?: PhoenixAccountSheetMode) => void;
  close: () => void;
};

export type PhoenixAccountSheetProps = {
  /**
   * Fired after any successful activation, deposit or withdrawal. A move carries
   * its direction and size so the caller can show the new balance at once; the
   * real re-read should wait {@link SETTLE_REFRESH_MS}, since an immediate one
   * can still return the pre-move figure and snap the card back.
   */
  onAccountChanged?: (move?: PhoenixCollateralMove) => void;
};

export type PhoenixCollateralMove = { mode: PhoenixAccountSheetMode; amountUsd: number };

/**
 * How long after a move lands before balances are re-read for real. The move is
 * acknowledged at "processed", and both the RPC balance read and Phoenix's
 * trader view trail that by a beat.
 */
export const SETTLE_REFRESH_MS = 2_500;

/**
 * The perps account's home: activate it, move cash in, move collateral out.
 *
 * Perps money is **not** spendable cash — it sits behind Phoenix's withdraw queue
 * and part of it is locked as margin against open positions, which is why it is
 * never folded into the cash balance. This sheet is where that pool is operated
 * on directly; everywhere else the number is read-only.
 *
 * Both directions run on the same keypad so "in" and "out" are visibly the same
 * gesture. The server is the authority on both caps — `buildPhoenixWithdraw`
 * clamps to Phoenix's own `effectiveCollateralForWithdrawals` and
 * `buildPhoenixDeposit` checks the wallet's USDC — the local caps here only keep
 * the confirm button honest.
 */
export const PhoenixAccountSheet = React.forwardRef<
  PhoenixAccountSheetRef,
  PhoenixAccountSheetProps
>(function PhoenixAccountSheet({ onAccountChanged }, ref) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const toast = useToast();
  const cash = useCash();
  const { optimisticAdjust } = useWalletStore();
  const solanaWallet = useEmbeddedSolanaWallet();
  const wallet = solanaWallet.wallets?.[0] ?? null;
  const { height } = useWindowDimensions();

  const sheetRef = useRef<BottomSheetModal>(null);
  const isOpenRef = useRef(false);

  const [mode, setMode] = useState<PhoenixAccountSheetMode>('deposit');
  const [account, setAccount] = useState<PhoenixAccountResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAccount(await getPhoenixAccount());
    } catch (cause) {
      // "No wallet yet" and "not signed in" are not failures — there is simply no
      // perps account. Anything else leaves the previous read in place rather
      // than replacing real figures with zeroes.
      const code = cause instanceof PhoenixApiError ? cause.code : null;
      if (code === 'no_wallet' || code === 'Unauthorized') setAccount(null);
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
      open(nextMode: PhoenixAccountSheetMode = 'deposit') {
        setMode(nextMode);
        setAmount('');
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
  const cross = account?.account.registered ? account.account.cross : null;
  const registered = Boolean(account?.account.registered);
  const withdrawable = Math.max(0, cross?.effectiveCollateralForWithdrawals ?? 0);
  const inMargin = Math.max(0, (cross?.effectiveCollateral ?? 0) - withdrawable);
  const spendableCash = cash.idleUsdc;
  const available = mode === 'withdraw' ? withdrawable : spendableCash;
  const typed = Number(amount);

  const tapDigit = useCallback((digit: string) => {
    setError(null);
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
      // Max leaves nothing behind: the server caps at the real balance anyway, and
      // a rounded-down "max" would strand cents on the account forever.
      const value =
        preset.toLowerCase() === 'max' ? available : (available * (percent ?? 0)) / 100;
      setAmount(value > 0 ? value.toFixed(2) : '');
    },
    [available],
  );

  const submitMove = useCallback(async () => {
    if (!wallet || submitting || !Number.isFinite(typed) || typed < MIN_MOVE_USD) return;
    setSubmitting(true);
    setError(null);
    const outbound = mode === 'withdraw';
    const toastId = toast.showToast(
      outbound ? 'Moving to cash…' : 'Moving to perps…',
      'processing',
      0,
    );
    try {
      const built = outbound
        ? await buildPhoenixWithdraw(amount)
        : await buildPhoenixDeposit(amount);
      // Acknowledged once the move is in a block ("processed"), like a buy; a
      // slow slot still falls back to the full confirmation window.
      await signAndSendBase64WithResult(wallet, built.transaction, {
        lastValidBlockHeight: built.lastValidBlockHeight,
        fastConfirm: true,
        requireConfirmed: true,
      });
      // The move is on chain, so show it now rather than after two more reads.
      // Cash is adjusted in the wallet store directly; the perps figure is the
      // caller's, so it gets the move and applies it the same way.
      const signedUsd = outbound ? built.amountUsd : -built.amountUsd;
      optimisticAdjust(SOLANA_USDC_MINT, signedUsd, signedUsd);
      onAccountChanged?.({ mode, amountUsd: built.amountUsd });
      // Then the real reads, once they can see it. `cash.refresh` goes straight to
      // the wallet store ungated — this is the one path that credits spendable
      // USDC directly, so a 15s-stale read would show the money as still gone.
      setTimeout(() => {
        void load();
        void cash.refresh(true);
      }, SETTLE_REFRESH_MS);
      toast.dismissToast(toastId);
      toast.showToast(
        `${formatUsd(built.amountUsd)} moved to ${outbound ? 'cash' : 'perps'}`,
        'success',
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
  }, [
    amount,
    cash,
    load,
    mode,
    onAccountChanged,
    optimisticAdjust,
    submitting,
    toast,
    typed,
    wallet,
  ]);

  const register = useCallback(async () => {
    if (registering) return;
    setRegistering(true);
    setError(null);
    const toastId = toast.showToast('Activating perps…', 'processing', 0);
    try {
      const result = await registerPhoenixAccount();
      let confirmed = false;
      // Phoenix broadcasts through its own onboarder, and its public trader view
      // can trail confirmation briefly. Poll rather than leaving a stale badge.
      for (let attempt = 0; attempt < 8; attempt += 1) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 750));
        try {
          const next = await getPhoenixAccount();
          setAccount(next);
          if (next.account.registered) {
            confirmed = true;
            break;
          }
        } catch {
          // A transient read must not turn a submitted activation into an error.
        }
      }
      onAccountChanged?.();
      toast.dismissToast(toastId);
      const done = confirmed || result.status === 'already_registered';
      toast.showToast(
        done ? 'Perps account activated' : 'Activation submitted — refresh in a moment',
        done ? 'success' : 'info',
      );
    } catch (cause) {
      const code = cause instanceof PhoenixApiError ? cause.code : null;
      const message =
        code === 'phoenix_registration_not_configured'
          ? 'Bread’s funded registration payer is not configured.'
          : code === 'phoenix_registration_invalid_response'
            ? 'Phoenix returned an unexpected registration transaction. Nothing was submitted.'
            : code === 'phoenix_registration_failed'
              ? 'Phoenix could not activate this account. Please try again.'
              : cause instanceof Error
                ? cause.message
                : 'Perps account activation failed.';
      setError(message);
      toast.dismissToast(toastId);
      toast.showToast(message, 'error');
    } finally {
      setRegistering(false);
    }
  }, [onAccountChanged, registering, toast]);

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
    !!wallet &&
    registered &&
    Number.isFinite(typed) &&
    typed >= MIN_MOVE_USD &&
    typed <= available + 1e-6;

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
        ) : !registered ? (
          <ActivateBody
            registering={registering}
            error={error}
            onActivate={() => void register()}
            onBack={() => sheetRef.current?.dismiss()}
          />
        ) : (
          <>
            <View style={styles.summary}>
              <Text style={styles.summaryLabel}>PERPS BALANCE</Text>
              <Text style={styles.summaryValue}>{formatUsd(cross?.portfolioValue ?? 0)}</Text>
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
                  setError(null);
                }}
              />
              <ModeTab
                label="Withdraw"
                active={outbound}
                onPress={() => {
                  setMode('withdraw');
                  setAmount('');
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
                noticeText={
                  outbound
                    ? 'Withdrawals clear through Phoenix’s queue — large amounts can settle a little later.'
                    : 'One wallet approval. Bread pays the Solana network fee.'
                }
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
  registering,
  error,
  onActivate,
  onBack,
}: {
  registering: boolean;
  error: string | null;
  onActivate: () => void;
  onBack: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  return (
    <View style={styles.activate}>
      <Text style={styles.activateTitle}>Activate perps</Text>
      <Text style={styles.activateBody}>
        Create your Phoenix trading account to trade with leverage and go short. Bread covers the
        Solana fee and account rent; no invite or referral code is required.
      </Text>
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

function formatUsd(value: number): string {
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
