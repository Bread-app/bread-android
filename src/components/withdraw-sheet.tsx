import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useNavigation } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import Animated, {
  FadeIn,
  FadeOut,
  ZoomIn,
} from 'react-native-reanimated';

import { CtaButton } from '@/components/side-glass-button';
import { TradeAmountPad } from '@/components/trade-amount-sheet';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { useThemeStore } from '@/lib/theme-store';
import { humanizeErrorMessage, recordWalletTransaction } from '@/lib/api';
import { withdrawUsdcToAddress, type CashStep } from '@/lib/cash';
import { useCash } from '@/hooks/use-cash';
import {
  formatLastUsed,
  loadRecentAddresses,
  recordRecentAddress,
  type RecentAddress,
} from '@/lib/recent-addresses';
import { isValidSolanaAddress } from '@/lib/solana-tx';
import { useToast } from '@/lib/toast-store';
import {
  isPositiveSmallestUnitAmount,
  toSmallestUnits,
} from '@/lib/trading';
import { useWalletStore } from '@/lib/wallet-store';
import { PressableScale } from '@/components/pressable-scale';

/** Mirrors the backend: a flat fee comes out of every withdrawal, $5 minimum. */
const WITHDRAWAL_FEE_USD = 0.5;
const MIN_WITHDRAWAL_USD = 5;

const F = Fonts.rounded;

type Step = 'amount' | 'address' | 'confirm' | 'success';

// Withdraw's crimson is reserved for the money-moving CTA (Send). The
// navigation CTAs (Continue, Done) use the app's primary blue.
const WITHDRAW_RED = '#FF1F4B';

const USDC_DECIMALS = 6;
const BRAND_GREEN = '#35F046';

function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function chopAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// ── Checkmark SVG (animated) ─────────────────────────────────────────────────
function AnimatedCheckmark({ color }: { color: string }) {
  return (
    <Animated.View entering={ZoomIn.springify().damping(14).stiffness(180)}>
      <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: BRAND_GREEN, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="checkmark" size={44} color="#000000" />
      </View>
    </Animated.View>
  );
}

/**
 * The withdraw flow (amount → address → review → sent). Hosted by the
 * `/withdraw` route as a native iOS form sheet (`presentation: 'formSheet'` in
 * `(app)/_layout.tsx`): UIKit owns dimming, drag-to-dismiss and the
 * parent-stacking effect; this only renders the content. Open it with
 * `router.navigate('/withdraw')` (navigate, so a double tap can't stack two
 * sheets). Each presentation mounts fresh, so state starts clean.
 */
export function WithdrawFlow({ dismiss }: { dismiss: () => void }) {
  const navigation = useNavigation();
  const { colors } = useThemeStore();
  const styles = useThemedStyles(makeStyles);

  const solanaWallet = useEmbeddedSolanaWallet();
  const wallet = solanaWallet.wallets?.[0] ?? null;
  const cash = useCash();
  const walletStore = useWalletStore();
  const toast = useToast();

  const [step, setStep] = useState<Step>('amount');

  // Only the address step has a real text input. On every other step (notably
  // the amount step, whose Continue button is pinned to the very bottom) make
  // sure no keyboard is up: a keyboard left open from the address input keeps
  // `keyboardBehavior="interactive"` squeezing this fixed-height sheet, which
  // clips the bottom-pinned button off-screen — the intermittent "Continue
  // disappeared" bug.
  useEffect(() => {
    if (step !== 'address') Keyboard.dismiss();
  }, [step]);

  const [amount, setAmount] = useState('');
  // True while "Max" is selected: the input shows the balance rounded to 2dp,
  // but the FULL precision balance is what actually gets withdrawn. Any manual
  // edit clears it.
  const [maxSelected, setMaxSelected] = useState(false);
  const [address, setAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  // Recent withdrawal destinations, from on-device history. See [[recent-addresses]].
  const [recentAddresses, setRecentAddresses] = useState<RecentAddress[]>([]);

  // Load this wallet's recent destinations whenever the wallet changes.
  useEffect(() => {
    let cancelled = false;
    if (!wallet?.address) {
      setRecentAddresses([]);
      return;
    }
    void loadRecentAddresses(wallet.address).then((list) => {
      if (!cancelled) setRecentAddresses(list);
    });
    return () => {
      cancelled = true;
    };
  }, [wallet?.address]);

  // Spendable cash from the wallet assets (liquid USDC + any balance still in
  // the retired earn vault). Gate the displayed figure on both reads so it
  // never flashes $0.00 before load.
  const availableCash = cash.totalCash;
  const cashHasLoaded = walletStore.hasLoaded && cash.hasLoaded;
  const numericAmount = Number(amount);
  const amountValid =
    Number.isFinite(numericAmount) &&
    numericAmount >= MIN_WITHDRAWAL_USD &&
    numericAmount <= availableCash + 1e-9;
  const amountExceeds = Number.isFinite(numericAmount) && numericAmount > availableCash + 1e-9;

  const trimmedAddress = address.trim();
  const addressValid = isValidSolanaAddress(trimmedAddress);
  const isSelfSend = !!wallet?.address && trimmedAddress === wallet.address;
  const addressReady = addressValid && !isSelfSend;

  // Fresh balance every time the sheet opens.
  useEffect(() => {
    void cash.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // No swipe-to-dismiss while a withdrawal is in flight.
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !submitting });
  }, [navigation, submitting]);

  // Keypad input — drive the amount string from the custom dialpad (same UX as
  // the Buy sheet). Caps the fraction at 2dp (cents) and clears any active Max
  // selection on manual edit.
  function tapDigit(digit: string) {
    setError(null);
    setMaxSelected(false);
    void Haptics.selectionAsync();
    if (digit === 'del') {
      setAmount((prev) => (prev.length <= 1 ? '' : prev.slice(0, -1)));
      return;
    }
    if (digit === '.') {
      setAmount((prev) => (prev.includes('.') ? prev : prev === '' ? '0.' : prev + '.'));
      return;
    }
    setAmount((prev) => {
      // Reject digits past 2 decimal places.
      const dot = prev.indexOf('.');
      if (dot !== -1 && prev.length - dot > 2) return prev;
      return prev === '0' || prev === '' ? digit : prev + digit;
    });
  }

  function onTapPreset(preset: string) {
    const p = preset.toLowerCase();
    const fraction = p === 'max' ? 1 : p === '50%' ? 0.5 : p === '25%' ? 0.25 : 0;
    if (fraction > 0) applyPreset(fraction);
  }

  function applyPreset(fraction: number) {
    void Haptics.selectionAsync();
    setError(null);
    // Display is always 2dp. For Max we flag `maxSelected` so send() uses the
    // full-precision balance even though the field reads e.g. "13.25".
    const isMax = fraction >= 1;
    const value = Math.floor(availableCash * fraction * 100) / 100;
    setMaxSelected(isMax);
    setAmount(value > 0 ? value.toFixed(2) : '');
  }

  async function handlePaste() {
    const text = (await Clipboard.getStringAsync()).trim();
    if (text) {
      void Haptics.selectionAsync();
      setError(null);
      setAddress(text);
    }
  }

  // Tap a saved/recent destination → fill it in and jump straight to review
  // (recent addresses are already valid).
  function selectRecent(addr: string) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setError(null);
    setAddress(addr);
    if (!!wallet?.address && addr === wallet.address) return;
    setStep('confirm');
  }

  async function handleSend() {
    if (!wallet?.address) {
      setError('Wallet is not available.');
      return;
    }
    // When Max is selected, withdraw the FULL precision balance (the field only
    // shows it rounded to 2dp). Otherwise use exactly what was entered.
    const amountSmallest = maxSelected
      ? toSmallestUnits(String(availableCash), USDC_DECIMALS)
      : toSmallestUnits(amount, USDC_DECIMALS);
    if (!amountSmallest || !isPositiveSmallestUnitAmount(amountSmallest)) {
      setError('Enter a valid amount.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setProgressLabel('Preparing…');
    try {
      const { signature: sig } = await withdrawUsdcToAddress({
        wallet,
        destination: trimmedAddress,
        amountSmallest: BigInt(amountSmallest),
        onStep: (s: CashStep) =>
          setProgressLabel(s === 'sending' ? 'Sending…' : 'Checking balance…'),
      });
      setSignature(sig);
      setStep('success');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast.showToast(`${formatUsd(numericAmount)} sent`, 'success');
      void recordWalletTransaction({
        direction: 'withdrawal',
        amount: amountSmallest,
        txHash: sig,
      }).catch(() => {});
      // Remember this destination so it shows up under "Recent" next time.
      if (wallet.address) {
        void recordRecentAddress(wallet.address, trimmedAddress).then(setRecentAddresses);
      }
      void Promise.all([walletStore.refresh(), cash.refresh()]);
    } catch (e) {
      setError(humanizeErrorMessage(e, 'Withdrawal failed. Please try again.'));
      toast.showToast('Withdrawal failed.', 'error');
    } finally {
      setSubmitting(false);
      setProgressLabel(null);
    }
  }

  function renderHeader(title: string, onBack: (() => void) | null) {
    return (
      <View style={styles.header}>
        {onBack ? (
          <PressableScale
            onPress={onBack}
            hitSlop={10}
            style={styles.iconBtn}
          >
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </PressableScale>
        ) : (
          <View style={styles.iconSpacer} />
        )}
        <Text style={styles.headerTitle}>{title}</Text>
        {/* Invisible spacer that keeps the title centred — no fill. */}
        <View style={styles.iconSpacer} />
      </View>
    );
  }

  return (
    // The keyboard only appears on the address step; padding keeps its
    // bottom-pinned Continue above it. KeyboardAvoidingView owns its own
    // paddingBottom (resets it to 0 with no keyboard), so the sheet's insets
    // live on the inner View.
    <KeyboardAvoidingView
      style={styles.keyboardAvoider}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.sheet}>

          {/* ── Step 1: Amount ── */}
          {step === 'amount' && (
            <Animated.View
              key="step-amount"
              entering={FadeIn.duration(180)}
              exiting={FadeOut.duration(120)}
              style={styles.stepContainer}
            >
              {/* Reuse the Buy sheet's amount pad so the custom keypad + layout
                  match exactly. Available balance lives in the top-right corner
                  (the pad's price slot), not a center chip. The pad's body is
                  flex:1 and fills the fixed-height sheet. */}
              <TradeAmountPad
                onBack={() => dismiss()}
                title="Withdraw"
                subtitleLabel="USDC · Solana"
                priceLabel={cashHasLoaded ? formatUsd(availableCash) : null}
                priceLoading={!cashHasLoaded}
                changeLabel="available"
                changePositive
                // App primary blue, like every other Continue in the app.
                accentColor={colors.actionPrimary}
                amount={amount}
                amountUnitSymbol="$"
                amountUnitLabel="dollars"
                // Keep the amount/header area fixed so the center doesn't drift or
                // bounce when tapped (the flex layout already sizes it to fit).
                scrollEnabled={false}
                presets={['25%', '50%', 'Max']}
                // Validation sits centred under the amount, only when it applies.
                amountNote={
                  amountExceeds
                    ? 'Amount exceeds your balance'
                    : numericAmount > 0 && numericAmount < MIN_WITHDRAWAL_USD
                      ? `Minimum withdrawal ${formatUsd(MIN_WITHDRAWAL_USD)}`
                      : null
                }
                amountNotePlain
                message={null}
                submitting={false}
                canConfirm={amountValid}
                confirmLabel="Continue"
                onTapDigit={tapDigit}
                onTapPreset={onTapPreset}
                onSubmit={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setStep('address');
                }}
              />
            </Animated.View>
          )}

          {/* ── Step 2: Address ── */}
          {step === 'address' && (
            <Animated.View
              key="step-address"
              entering={FadeIn.duration(180)}
              exiting={FadeOut.duration(120)}
              style={styles.stepContainer}
            >
              {renderHeader('To Address', () => setStep('amount'))}

              {/* Address input pill + scan affordance (matches the reference). */}
              <View style={styles.addrInputRow}>
                <View style={styles.toPill}>
                  <Text style={styles.toLabel}>To:</Text>
                  <TextInput
                    value={address}
                    onChangeText={(t) => {
                      setError(null);
                      setAddress(t);
                    }}
                    placeholder="Enter address…"
                    placeholderTextColor={colors.textTertiary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    style={styles.toInput}
                  />
                  {trimmedAddress.length > 0 ? (
                    <Pressable
                      onPress={() => {
                        setError(null);
                        setAddress('');
                      }}
                      hitSlop={8}
                      style={styles.clearBtn}
                    >
                      <Ionicons name="close-circle" size={20} color={colors.textTertiary} />
                    </Pressable>
                  ) : (
                    <PressableScale
                      onPress={() => void handlePaste()}
                      hitSlop={8}
                      style={styles.pastePill}
                    >
                      <Text style={styles.pastePillText}>Paste</Text>
                    </PressableScale>
                  )}
                </View>
              </View>

              <Text style={styles.listHeading}>Recent</Text>

              {/* Recent destinations (on-device history). */}
              <ScrollView
                style={styles.addrList}
                contentContainerStyle={styles.addrListContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {recentAddresses.length > 0 ? (
                  recentAddresses.map((r) => (
                    <PressableScale
                      key={r.address}
                      onPress={() => selectRecent(r.address)}
                      style={styles.recentRow}
                    >
                      <View style={styles.recentAvatar}>
                        <Ionicons name="wallet-outline" size={20} color={colors.textSecondary} />
                      </View>
                      <View style={styles.recentInfo}>
                        <Text style={styles.recentAddr}>{chopAddress(r.address)}</Text>
                        <Text style={styles.recentSub}>{formatLastUsed(r.lastUsedAt)}</Text>
                      </View>
                      <Ionicons name="add" size={24} color={colors.textTertiary} />
                    </PressableScale>
                  ))
                ) : (
                  <View style={styles.emptyState}>
                    <Ionicons name="time-outline" size={30} color={colors.textTertiary} />
                    <Text style={styles.emptyText}>No recent addresses yet</Text>
                    <Text style={styles.emptySub}>Addresses you withdraw to will show up here.</Text>
                  </View>
                )}
              </ScrollView>

              {trimmedAddress.length > 0 && !addressValid ? (
                <Animated.Text entering={FadeIn} style={styles.error}>
                  Not a valid Solana address.
                </Animated.Text>
              ) : isSelfSend ? (
                <Animated.Text entering={FadeIn} style={styles.error}>
                  Can&apos;t send to your own wallet.
                </Animated.Text>
              ) : null}

              <CtaButton
                label={addressReady ? 'Continue' : 'Enter address'}
                color={colors.actionPrimary}
                onPress={() => {
                  setStep('confirm');
                }}
                disabled={!addressReady}
              />
            </Animated.View>
          )}

          {/* ── Step 3: Confirm ── */}
          {step === 'confirm' && (
            <Animated.View
              key="step-confirm"
              entering={FadeIn.duration(180)}
              exiting={FadeOut.duration(120)}
              style={styles.stepContainer}
            >
              {renderHeader('Review', submitting ? null : () => setStep('address'))}

              {/* Send icon */}
              <View style={styles.confirmIconWrap}>
                <Ionicons name="arrow-up" size={30} color={colors.text} />
              </View>
              <Text style={styles.confirmAmount}>{formatUsd(numericAmount)}</Text>
              <Text style={styles.confirmAmountSub}>USDC · Solana</Text>

              {/* Summary card */}
              <View style={styles.summaryCard}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>To</Text>
                  <Text style={styles.summaryValue}>{chopAddress(trimmedAddress)}</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Network</Text>
                  <Text style={styles.summaryValue}>Solana</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Fee</Text>
                  <Text style={styles.summaryValue}>{formatUsd(WITHDRAWAL_FEE_USD)}</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>They receive</Text>
                  <Text style={styles.summaryValue}>
                    {formatUsd(Math.max(0, numericAmount - WITHDRAWAL_FEE_USD))}
                  </Text>
                </View>
              </View>

              {/* Push the action to the bottom of the fixed-height sheet. */}
              <View style={styles.flexSpacer} />

              {error ? (
                <Animated.Text entering={FadeIn} style={styles.error}>
                  {error}
                </Animated.Text>
              ) : null}

              <CtaButton
                label="Send"
                color={WITHDRAW_RED}
                onPress={() => void handleSend()}
                loading={submitting}
                loadingLabel={progressLabel ?? 'Sending…'}
              />
            </Animated.View>
          )}

          {/* ── Step 4: Success ── */}
          {step === 'success' && (
            <Animated.View
              key="step-success"
              entering={FadeIn.duration(250)}
              style={styles.stepContainer}
            >
              <View style={styles.successBody}>
                <AnimatedCheckmark color={BRAND_GREEN} />

                <Animated.Text
                  entering={FadeIn.delay(120).duration(200)}
                  style={styles.successTitle}
                >
                  {formatUsd(numericAmount)} sent
                </Animated.Text>

                <Animated.View
                  entering={FadeIn.delay(180).duration(200)}
                  style={styles.successDetails}
                >
                  <View style={styles.successDetailRow}>
                    <Text style={styles.successDetailLabel}>To</Text>
                    <Text style={styles.successDetailValue}>{chopAddress(trimmedAddress)}</Text>
                  </View>
                  {signature ? (
                    <>
                      <View style={styles.successDetailDivider} />
                      <View style={styles.successDetailRow}>
                        <Text style={styles.successDetailLabel}>Tx</Text>
                        <Text style={styles.successDetailValue}>{chopAddress(signature)}</Text>
                      </View>
                    </>
                  ) : null}
                </Animated.View>
              </View>

              {/* Pinned to the bottom like Send, so Done lands where the thumb
                  already is. */}
              <Animated.View entering={FadeIn.delay(260).duration(200)}>
                <CtaButton
                  label="Done"
                  color={colors.actionPrimary}
                  onPress={() => dismiss()}
                />
              </Animated.View>
            </Animated.View>
          )}
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    keyboardAvoider: {
      flex: 1,
    },
    sheet: {
      flex: 1,
      paddingHorizontal: 20,
      paddingBottom: 40,
    },
    stepContainer: {
      flex: 1,
    },

    // ── Header ──────────────────────────────────────────────────────────────
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
      paddingTop: 4,
    },
    iconBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surfaceAlt,
    },
    iconSpacer: {
      width: 36,
      height: 36,
    },
    headerTitle: {
      fontFamily: F,
      color: c.text,
      fontSize: 17,
      fontWeight: '800',
    },

    // ── Address step ─────────────────────────────────────────────────────────
    addrInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginTop: 12,
      marginBottom: 4,
    },
    toPill: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surfaceAlt,
      borderRadius: 16,
      paddingLeft: 16,
      paddingRight: 8,
      minHeight: 56,
    },
    toLabel: {
      fontFamily: F,
      color: c.textTertiary,
      fontSize: 15,
      fontWeight: '700',
      marginRight: 8,
    },
    toInput: {
      flex: 1,
      fontFamily: F,
      color: c.text,
      fontSize: 15,
      fontWeight: '600',
      paddingVertical: 16,
    },
    clearBtn: {
      paddingHorizontal: 6,
      paddingVertical: 6,
    },
    pastePill: {
      backgroundColor: c.surface,
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 9,
      borderWidth: 1,
      borderColor: c.border,
    },
    pastePillText: {
      fontFamily: F,
      color: c.text,
      fontSize: 13,
      fontWeight: '700',
    },
    listHeading: {
      fontFamily: F,
      color: c.text,
      fontSize: 17,
      fontWeight: '800',
      marginTop: 18,
      marginBottom: 2,
    },

    // Address list
    addrList: {
      flex: 1,
      marginTop: 8,
    },
    addrListContent: {
      paddingBottom: 8,
      gap: 10,
      flexGrow: 1,
    },
    recentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      backgroundColor: c.surfaceAlt,
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 14,
    },
    recentAvatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    recentInfo: {
      flex: 1,
      minWidth: 0,
    },
    recentAddr: {
      fontFamily: F,
      color: c.text,
      fontSize: 17,
      fontWeight: '800',
    },
    recentSub: {
      fontFamily: F,
      color: c.textTertiary,
      fontSize: 13,
      fontWeight: '600',
      marginTop: 2,
    },
    emptyState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 48,
      gap: 8,
    },
    emptyText: {
      fontFamily: F,
      color: c.textSecondary,
      fontSize: 15,
      fontWeight: '700',
    },
    emptySub: {
      fontFamily: F,
      color: c.textTertiary,
      fontSize: 13,
      fontWeight: '600',
      textAlign: 'center',
      paddingHorizontal: 24,
    },

    // Bottom CTA
    addrCta: {
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 18,
      marginTop: 10,
    },
    addrCtaActive: { backgroundColor: c.text },
    addrCtaDisabled: { backgroundColor: c.surfaceAlt },
    addrCtaText: {
      fontFamily: F,
      fontSize: 16,
      fontWeight: '900',
    },
    addrCtaTextActive: { color: c.textInverse },
    addrCtaTextDisabled: { color: c.positive },
    flexSpacer: { flex: 1 },

    // ── Confirm step ─────────────────────────────────────────────────────────
    confirmIconWrap: {
      alignSelf: 'center',
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: c.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 18,
    },
    confirmAmount: {
      fontFamily: F,
      color: c.text,
      fontSize: 38,
      fontWeight: '900',
      textAlign: 'center',
      marginTop: 16,
      letterSpacing: -1,
    },
    confirmAmountSub: {
      fontFamily: F,
      color: c.textTertiary,
      fontSize: 13,
      fontWeight: '600',
      textAlign: 'center',
      marginTop: 4,
    },
    summaryCard: {
      backgroundColor: c.surfaceAlt,
      borderRadius: 18,
      paddingHorizontal: 18,
      paddingVertical: 4,
      marginTop: 24,
    },
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 15,
    },
    summaryLabel: {
      fontFamily: F,
      color: c.textSecondary,
      fontSize: 14,
      fontWeight: '600',
    },
    summaryValue: {
      fontFamily: F,
      color: c.text,
      fontSize: 14,
      fontWeight: '700',
    },
    summaryDivider: {
      height: 1,
      backgroundColor: c.border,
    },

    // ── Success step ─────────────────────────────────────────────────────────
    // Fills the space above Done and centres the check, title and receipt.
    successBody: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    successTitle: {
      fontFamily: F,
      color: c.text,
      fontSize: 28,
      fontWeight: '900',
      marginTop: 24,
      letterSpacing: -0.5,
      textAlign: 'center',
    },
    successDetails: {
      width: '100%',
      backgroundColor: c.surfaceAlt,
      borderRadius: 18,
      paddingHorizontal: 18,
      paddingVertical: 4,
      marginTop: 28,
    },
    successDetailRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 15,
    },
    successDetailLabel: {
      fontFamily: F,
      color: c.textSecondary,
      fontSize: 14,
      fontWeight: '600',
    },
    successDetailValue: {
      fontFamily: F,
      color: c.text,
      fontSize: 14,
      fontWeight: '700',
    },
    successDetailDivider: {
      height: 1,
      backgroundColor: c.border,
    },
    successBtn: {
      borderRadius: 18,
      backgroundColor: BRAND_GREEN,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 18,
    },
    successBtnText: {
      fontFamily: F,
      color: '#000000',
      fontSize: 16,
      fontWeight: '900',
    },

    // ── Shared ───────────────────────────────────────────────────────────────
    primaryBtn: {
      marginTop: 18,
      borderRadius: 18,
      backgroundColor: c.text,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 18,
    },
    primaryBtnText: {
      fontFamily: F,
      color: c.textInverse,
      fontSize: 16,
      fontWeight: '900',
    },
    error: {
      fontFamily: F,
      marginTop: 12,
      color: c.negative,
      fontSize: 13,
      fontWeight: '600',
      textAlign: 'center',
    },
  });
