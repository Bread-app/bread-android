import { Ionicons } from '@expo/vector-icons';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetBackgroundProps,
} from '@gorhom/bottom-sheet';
import { SheetModal } from '@/components/sheet-modal';

import { BlurBackdrop } from '@/components/blur-backdrop';
import { GlassSheetSurface } from '@/components/glass-sheet-surface';
import { ValueSkeletonLine } from '@/components/value-skeleton';
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Keyboard,
  LayoutAnimation,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { AssetLogo } from '@/components/asset-logo';
import { AnimatedAmountDigits } from '@/components/animated-amount-digits';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import Animated, {
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import {
  NUMERIC_KEYPAD_FONT_SIZE,
  NUMERIC_KEYPAD_GAP,
  NUMERIC_KEYPAD_HEIGHT,
  NUMERIC_KEYPAD_ROWS,
} from '@/lib/numeric-keypad-layout';
import { useThemeStore } from '@/lib/theme-store';
import { CtaButton } from '@/components/side-glass-button';
import { PressableScale } from '@/components/pressable-scale';
import { RotatingChevron } from '@/components/rotating-chevron';

const F = Fonts.rounded;

/**
 * Painted under the glass of any surface hosting the pad. Enough white to keep the
 * pad's dark text and the amount readable over whatever refracts through, little
 * enough that the material still reads as translucent. Exported because the pad is
 * also rendered as an in-sheet overlay (stock detail, prediction markets) whose
 * surface has to match this one.
 */
/** Scrim behind the pad, in the surface's own tone so it dims rather than fogs. */
export const TRADE_PAD_SCRIM = 'rgba(255, 255, 255, 0.28)';
export const TRADE_PAD_SCRIM_DARK = 'rgba(0, 0, 0, 0.36)';

type TradeSide = 'buy' | 'sell';

/**
 * Imperative handle for opening/closing the sheet. On the New Architecture,
 * `BottomSheetModal.present()` is only reliable when called synchronously from a
 * user gesture — driving it from an `isOpen` prop + effect silently drops the
 * present() sometimes, so the sheet never appears. Callers present from the tap
 * handler instead. See [[bottom-sheet-present-pattern]].
 */
export type TradeAmountSheetRef = {
  present: () => void;
  dismiss: () => void;
};

export type TradeDetailRow = {
  label: string;
  value: string;
  /**
   * `warn` marks a number the user should look at twice — a wide slippage band,
   * a heavy price impact. Purely presentational: nothing here gates the trade,
   * which is enforced server-side by the execution-price guard.
   */
  tone?: 'default' | 'warn';
};

/** Props for the trade dialpad UI itself — usable inside a modal OR as an in-sheet overlay. */
export type TradeAmountPadProps = {
  side?: TradeSide;
  symbol?: string;
  icon?: string | null;
  amountUnitSymbol?: string;
  amountUnitPosition?: 'prefix' | 'suffix';
  amountUnitLabel?: string;
  availableLabel?: string | null;
  /** Header subtitle under the symbol/title — e.g. "$15.1M MC". */
  subtitleLabel?: string | null;
  /** Header price (right side), pre-formatted — e.g. "$0.0152". */
  priceLabel?: string | null;
  /**
   * The header price hasn't arrived yet. Holds its slot with a skeleton, so a
   * pending quote never reads as an asset with no price.
   */
  priceLoading?: boolean;
  /** Header change (right side), pre-formatted — e.g. "0.12%". */
  changeLabel?: string | null;
  /** Whether the header change is positive (drives its color). */
  changePositive?: boolean;
  /** Secondary balance shown on the right of the footer — e.g. "$1.32". */
  cashLabel?: string | null;
  amount: string;
  message: string | null;
  /** Compact highlighted note rendered directly under the amount (e.g. the
   *  prediction-market $5 floor). Shown as a pill; kept separate from `message`
   *  (which stays near the confirm button for errors/status). */
  amountNote?: string | null;
  /** Render `amountNote` as bare red text (no pill, dot, border or fill) —
   *  for inline validation like a withdrawal minimum. */
  amountNotePlain?: boolean;
  /** Each typed digit springs into place and the rest glide aside, instead of
   *  the whole figure swapping at once. Enabled by default across amount sheets. */
  animateAmount?: boolean;
  submitting: boolean;
  canConfirm: boolean;
  onSubmit: () => void | Promise<void>;
  /**
   * Fired on touch-down of the confirm button, before `onSubmit`. Used to start
   * the speculative swap pre-build so the ~2s Jupiter build happens during the
   * press instead of after it. Must be cheap and side-effect free on the money
   * path — it only warms a cache.
   */
  onSubmitPressIn?: () => void;
  onTapDigit: (digit: string) => void;
  onTapPreset: (value: string) => void;
  confirmLabel?: string;
  submittingLabel?: string;
  title?: string;
  /** Overrides the buy/sell-derived accent (title + confirm button). */
  accentColor?: string;
  presets?: string[];
  /**
   * Informational banner above the presets — e.g. the live availability note
   * returned when Ondo's 24/5 secondary market is not quoting.
   */
  noticeText?: string | null;
  /**
   * Reduce the notice to a warning affordance until tapped. Useful for a trade
   * refusal: the disabled action and warning icon communicate the state without
   * replacing the whole keypad with error copy.
   */
  noticeCollapsible?: boolean;
  /** Short label beside the collapsed warning icon. */
  noticeLabel?: string;
  /** Optional action displayed inside the notice banner. */
  noticeActionLabel?: string | null;
  onNoticeAction?: () => void;
  /**
   * Live trade terms rendered directly under the amount — what the user
   * receives, at what price, and the floor the swap enforces. Kept a node
   * rather than a string because it carries its own loading state and
   * emphasis. See TradeQuotePreviewRow.
   */
  previewContent?: React.ReactNode;
  /** Keep room for changing quotes; disable when a pad never shows a quote. */
  reservePreviewSpace?: boolean;
  /**
   * Rows for the drop-up detail panel opened from the footer — slippage, the
   * on-chain floor, the effective price, whatever the venue actually said.
   *
   * These used to be printed inline under the amount, which forced every buy
   * sheet to choose between burying its headline figure and hiding its terms
   * entirely. Behind a toggle they can be complete without competing: the pad
   * stays a keypad, and the blotter is one tap away for anyone who wants it.
   *
   * Empty or absent hides the trigger, so a pad with nothing to disclose shows
   * no affordance rather than an empty panel.
   */
  detailRows?: TradeDetailRow[];
  /** Trigger label. Defaults to "Details". */
  detailLabel?: string;
  /** Thesis quote shown below the amount (e.g. the sandwich quote). */
  thesisText?: string | null;
  /** Custom thesis content node — rendered instead of thesisText when provided. */
  thesisContent?: React.ReactNode;
  /** When set, renders a back affordance in a header row (for in-sheet overlay use). */
  onBack?: () => void;
  /** Replaces the standard trade button with a deliberate slide-to-confirm control. */
  slideToConfirm?: boolean;
  /**
   * The confirm action is "Add cash" — it opens the deposit flow rather than
   * executing a trade. A sliding pad draws it as a plain tap button: the slide
   * is a commitment gesture for money leaving the wallet, and there is nothing
   * to commit to on the way to a deposit, so demanding the gesture there only
   * made topping up feel like a trade.
   */
  addCash?: boolean;
  /**
   * Overrides the verb derived from `side`. A perp is neither a buy nor a sell
   * — it opens a Long or a Short — and the slider states that verb, so the pad
   * has to be told it rather than inferring "Buy" from a spot-shaped side.
   */
  actionLabel?: string;
  /**
   * Whether the header/amount/thesis area can scroll. Defaults to true. Set to
   * false for tall sheets that should keep the amount + thesis fixed in place
   * (the flex layout already sizes them to fit), so the area doesn't drift or
   * bounce when tapped.
   */
  scrollEnabled?: boolean;
};

type TradeAmountSheetProps = Omit<TradeAmountPadProps, 'onBack'> & {
  onClose: () => void;
  animatedIndex?: SharedValue<number>;
  snapPoints?: string[];
  /**
   * Opaque surface instead of the glass one. For a pad presented over another
   * sheet (the podcast holding drawer), where the material would be refracting
   * a second sheet's content rather than the page and reads as smeared.
   */
  solid?: boolean;
};

const SLIDE_HEIGHT = 68;
const SLIDE_PADDING = 4;
const SLIDE_THUMB_SIZE = SLIDE_HEIGHT - SLIDE_PADDING * 2;
const SLIDE_THRESHOLD = 0.82;
const SLIDE_HAPTIC_STEPS = 10;
const SLIDE_SPRING = {
  damping: 22,
  stiffness: 280,
  mass: 0.75,
  reduceMotion: ReduceMotion.System,
} as const;

function fireSlideTick() {
  void Haptics.selectionAsync();
}

function fireSlideComplete() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

export function SlideToConfirm({
  actionLabel,
  amountLabel,
  actionColor,
  trackColor,
  trackBorderColor,
  canConfirm,
  submitting,
  submittingLabel,
  onSlideStart,
  onComplete,
}: {
  actionLabel: string;
  amountLabel: string;
  actionColor: string;
  trackColor: string;
  trackBorderColor: string;
  canConfirm: boolean;
  submitting: boolean;
  submittingLabel: string;
  onSlideStart?: () => void;
  onComplete: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const translateX = useSharedValue(0);
  const maxTranslateX = useSharedValue(0);
  const completed = useSharedValue(false);
  const lastHapticStep = useSharedValue(-1);

  React.useEffect(() => {
    if (submitting) return;
    completed.value = false;
    lastHapticStep.value = -1;
    translateX.value = withSpring(0, SLIDE_SPRING);
  }, [amountLabel, canConfirm, completed, lastHapticStep, submitting, translateX]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));
  const progressStyle = useAnimatedStyle(() => ({
    width: translateX.value + SLIDE_THUMB_SIZE,
  }));

  const pan = Gesture.Pan()
    .enabled(canConfirm && !submitting)
    .activeOffsetX([-4, 4])
    .failOffsetY([-12, 12])
    .onBegin(() => {
      if (onSlideStart) runOnJS(onSlideStart)();
    })
    .onStart(() => {
      lastHapticStep.value = 0;
      runOnJS(fireSlideTick)();
    })
    .onUpdate((event) => {
      if (completed.value) return;
      const nextTranslateX = Math.max(
        0,
        Math.min(event.translationX, maxTranslateX.value),
      );
      translateX.value = nextTranslateX;

      if (maxTranslateX.value > 0) {
        const progress = nextTranslateX / maxTranslateX.value;
        const hapticStep = Math.floor(progress * SLIDE_HAPTIC_STEPS);
        if (hapticStep !== lastHapticStep.value) {
          lastHapticStep.value = hapticStep;
          runOnJS(fireSlideTick)();
        }
      }
    })
    .onEnd(() => {
      if (completed.value) return;
      if (
        maxTranslateX.value > 0 &&
        translateX.value >= maxTranslateX.value * SLIDE_THRESHOLD
      ) {
        completed.value = true;
        translateX.value = withSpring(maxTranslateX.value, SLIDE_SPRING);
        runOnJS(fireSlideComplete)();
        runOnJS(onComplete)();
        return;
      }
      translateX.value = withSpring(0, SLIDE_SPRING);
    })
    .onFinalize(() => {
      if (!completed.value) {
        translateX.value = withSpring(0, SLIDE_SPRING);
      }
    });

  const accessibilityLabel = `${actionLabel} ${amountLabel}. Slide to confirm.`;

  return (
    <View style={styles.slideConfirmWrap}>
      <GestureDetector gesture={pan}>
        <View
          accessible
          focusable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint="Swipe the handle to the right to confirm the trade"
          accessibilityState={{ disabled: !canConfirm || submitting, busy: submitting }}
          accessibilityActions={[{ name: 'activate', label: `Confirm ${actionLabel.toLowerCase()}` }]}
          onAccessibilityAction={(event) => {
            if (
              event.nativeEvent.actionName === 'activate' &&
              canConfirm &&
              !submitting &&
              !completed.value
            ) {
              completed.value = true;
              translateX.value = withSpring(maxTranslateX.value, SLIDE_SPRING);
              onSlideStart?.();
              fireSlideComplete();
              onComplete();
            }
          }}
          onLayout={(event) => {
            maxTranslateX.value = Math.max(
              0,
              event.nativeEvent.layout.width - SLIDE_PADDING * 2 - SLIDE_THUMB_SIZE,
            );
          }}
          style={[
            styles.slideTrack,
            { backgroundColor: trackColor, borderColor: trackBorderColor },
            !canConfirm && !submitting && styles.confirmDisabled,
          ]}>
          <Animated.View
            pointerEvents="none"
            style={[styles.slideProgress, { backgroundColor: actionColor }, progressStyle]}
          />
          <View pointerEvents="none" style={styles.slideTrackLabelWrap}>
            {submitting ? <ActivityIndicator color="#ffffff" size="small" /> : null}
            <Text style={styles.slideTrackLabel}>
              {(submitting ? submittingLabel : actionLabel).toUpperCase()}
            </Text>
          </View>
          <Animated.View
            style={[styles.slideThumb, { backgroundColor: actionColor }, thumbStyle]}>
            <Ionicons name="chevron-forward" size={24} color="#ffffff" />
          </Animated.View>
        </View>
      </GestureDetector>
    </View>
  );
}

/**
 * The trade dialpad UI (amount, presets, keypad, confirm).
 * Rendered either inside a BottomSheetModal (`TradeAmountSheet`) or as a plain
 * in-sheet overlay (e.g. inside the stock-detail sheet, where stacking a second
 * modal is unreliable on the New Architecture). See [[bottom-sheet-present-pattern]].
 */

export function TradeAmountPad({
  side = 'buy',
  symbol,
  icon,
  amountUnitSymbol,
  amountUnitPosition = 'prefix',
  amountUnitLabel,
  availableLabel,
  subtitleLabel,
  priceLabel,
  priceLoading = false,
  changeLabel,
  changePositive,
  cashLabel,
  amount,
  message,
  amountNote,
  amountNotePlain = false,
  animateAmount = true,
  submitting,
  canConfirm,
  onSubmit,
  onSubmitPressIn,
  onTapDigit,
  onTapPreset,
  confirmLabel,
  submittingLabel,
  title,
  accentColor,
  presets = ['10', '25', '50', '100'],
  noticeText,
  noticeCollapsible = false,
  noticeLabel = 'Trade warning',
  noticeActionLabel,
  onNoticeAction,
  previewContent,
  reservePreviewSpace = true,
  thesisText,
  thesisContent,
  detailRows,
  detailLabel = 'Details',
  onBack,
  scrollEnabled = true,
  slideToConfirm = false,
  addCash = false,
  actionLabel: actionLabelOverride,
}: TradeAmountPadProps) {
  const { colors, scheme } = useThemeStore();
  const styles = useThemedStyles(makeStyles);
  // The notice tints, matched to what makeStyles paints the banner text in.
  const noticeAmber = scheme === 'dark' ? '#fbbf24' : '#b45309';
  const noticeBlue = scheme === 'dark' ? '#7dd3fc' : '#0369a1';
  const unitSymbol = amountUnitSymbol ?? '$';
  const unitLabel = amountUnitLabel ?? (unitSymbol === '$' ? 'dollars' : unitSymbol);
  const actionColor = accentColor ?? (side === 'buy' ? colors.actionBuy : colors.actionSell);
  const actionLabel = actionLabelOverride ?? (side === 'buy' ? 'Buy' : 'Sell');
  const sheetTitle = title ?? `${actionLabel}${symbol ? ` ${symbol}` : ''}`;
  const enteredAmount = amount || '0';
  const actionAmountLabel = amountUnitPosition === 'prefix'
    ? `${unitSymbol}${enteredAmount}`
    : `${enteredAmount} ${unitSymbol}`;
  // A pad that slides keeps sliding: "Minimum $5" relabels the same track
  // rather than swapping it for a tap button, so the control the thumb is
  // resting on never changes shape as the amount crosses a limit. "Add cash"
  // is the one exception — see the `addCash` prop.
  const shouldSlideToConfirm = slideToConfirm && !addCash;
  // The tap button that stands in for the track keeps its footprint, so the
  // keypad above does not shift when the amount crosses the balance.
  const slideStandInStyle = slideToConfirm && addCash ? styles.slideStandIn : null;
  const slideActionLabel = confirmLabel ?? actionLabel;

  // Strip the leading "Cash balance: " / "Stock balance: " prefix so the footer
  // shows just the value (e.g. "$10.42" or "5 TSLA") next to the "available" tag.
  const availableValue = availableLabel ? availableLabel.replace(/^[^:]*:\s*/, '').trim() : null;

  // Collapsed by default every time the pad mounts: the panel is a lookup, not
  // a setting, and a sheet that reopens already-expanded pushes the keypad down
  // for someone who never asked to see terms.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const hasDetails = (detailRows?.length ?? 0) > 0;
  // Fixed native-sheet pads need a regular View: UIKit can reposition a
  // nested ScrollView independently of the sheet's horizontal padding.
  const AmountContainer = scrollEnabled ? ScrollView : View;
  // A pad whose rows vanish mid-interaction (amount cleared, quote dropped)
  // must not keep an empty panel open.
  useEffect(() => {
    if (!hasDetails) setDetailsOpen(false);
  }, [hasDetails]);
  useEffect(() => {
    // A new amount can produce a different refusal. Collapse the old copy so a
    // warning from the previous quote never appears to describe the new order.
    setNoticeOpen(false);
  }, [noticeText]);

  return (
    <View style={styles.body}>
      <AmountContainer
        style={[styles.scrollArea, !scrollEnabled && styles.scrollContent]}
        {...(scrollEnabled ? {
          contentContainerStyle: styles.scrollContent,
          showsVerticalScrollIndicator: false,
        } : {})}>
        {/* Header row — icon + name + subtitle on the left, price + change right. */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            {onBack ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={onBack}
                hitSlop={12}
                style={({ pressed }) => [styles.padBack, pressed && styles.padBackPressed]}>
                <Ionicons name="chevron-down" size={22} color={colors.text} />
              </Pressable>
            ) : null}
            {icon ? (
              <AssetLogo
                uri={icon}
                size={40}
                borderRadius={20}
                backgroundColor={colors.surfaceAlt}
                // No letter avatar here by design — the pad already shows the
                // ticker beside this slot, so an unresolvable logo renders as
                // nothing rather than a redundant initial.
                fallback={null}
              />
            ) : null}
            <View style={styles.headerTitleCol}>
              {symbol || sheetTitle ? (
                <Text style={styles.headerTitle} numberOfLines={1}>
                  {symbol || sheetTitle}
                </Text>
              ) : null}
              {subtitleLabel ? (
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  {subtitleLabel}
                </Text>
              ) : null}
            </View>
          </View>

          {priceLabel || priceLoading || changeLabel ? (
            <View style={styles.headerRight}>
              {priceLoading ? (
                <ValueSkeletonLine
                  lineHeight={25}
                  width={92}
                  color={colors.surfaceSelected}
                  accessibilityLabel="Loading price"
                />
              ) : priceLabel ? (
                <Text style={styles.headerPrice} numberOfLines={1}>
                  {priceLabel}
                </Text>
              ) : null}
              {changeLabel ? (
                <Text
                  style={[
                    styles.headerChange,
                    changeLabel.includes('%') && styles.headerPercentageChange,
                    { color: changePositive ? colors.chartPositive : colors.chartNegative },
                  ]}
                  numberOfLines={1}>
                  {changeLabel}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* Amount centered in the upper flex slot, thesis pinned to its bottom so
            it sits flush above the dialpad without a giant empty gap. */}
        <View style={styles.amountWrap}>
          <View style={styles.amountCenter}>
            {/* Nothing entered yet — blank, "0", "0." — fades the whole figure,
                unit included: a solid "$0" reads as a real amount of nothing. */}
            <View style={[styles.amountDisplay, !(Number(amount) > 0) && styles.amountDisplayEmpty]}>
              {amountUnitPosition === 'prefix' ? (
                <Text style={styles.amountCurrency}>{unitSymbol}</Text>
              ) : null}
              {animateAmount ? (
                <AnimatedAmountDigits value={amount || '0'} style={styles.amountValue} />
              ) : (
                <Text style={styles.amountValue} numberOfLines={1} adjustsFontSizeToFit>
                  {amount || '0'}
                </Text>
              )}
              {amountUnitPosition === 'suffix' ? (
                <Text style={styles.amountCurrency}>{unitSymbol}</Text>
              ) : null}
            </View>
            {amountNotePlain ? (
              // Always mounted at a fixed height so the amount above never
              // shifts when the message comes and goes.
              <Text style={[styles.amountNotePlainText, { color: colors.negative }]} numberOfLines={1}>
                {amountNote ?? ''}
              </Text>
            ) : amountNote ? (
              <View style={styles.amountNotePill}>
                <View style={styles.amountNoteDot} />
                <Text style={styles.amountNoteText} numberOfLines={2}>
                  {amountNote}
                </Text>
              </View>
            ) : null}
            {/* Fixed-height slot: the quote comes and goes (empty amount,
                in-flight, refused) and the block above is vertically centred,
                so without a reserved row every change re-centred it and the
                amount hopped up and down under the user's thumb. */}
            {reservePreviewSpace || previewContent ? (
              <View style={styles.previewSlot}>{previewContent}</View>
            ) : null}
          </View>

          {thesisContent ? (
            thesisContent
          ) : thesisText ? (
            <Text numberOfLines={2} style={styles.thesisQuote}>
              &quot;{thesisText}&quot;
            </Text>
          ) : null}
        </View>
      </AmountContainer>

      <View style={styles.bottomSection}>
        {noticeText ? (
          <View style={[styles.noticeBanner, noticeCollapsible && styles.noticeBannerWarning]}>
            {noticeCollapsible ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: noticeOpen }}
                accessibilityLabel={noticeOpen ? 'Hide trade warning' : 'Show trade warning'}
                onPress={() => setNoticeOpen((open) => !open)}
                style={({ pressed }) => [
                  styles.noticeSummary,
                  pressed && styles.noticeActionPressed,
                ]}>
                <Ionicons name="warning-outline" size={18} color={noticeAmber} />
                <Text style={styles.noticeSummaryText}>{noticeLabel}</Text>
                <RotatingChevron up={noticeOpen} size={14} color={noticeAmber} />
              </Pressable>
            ) : null}
            {!noticeCollapsible || noticeOpen ? (
              <View style={[styles.noticeBody, !noticeCollapsible && styles.noticeBodyInline]}>
                <Text style={[styles.noticeText, noticeCollapsible && styles.noticeTextWarning]}>
                  {noticeText}
                </Text>
                {noticeActionLabel && onNoticeAction ? (
                  <PressableScale
                    accessibilityRole="link"
                    accessibilityLabel={noticeActionLabel}
                    accessibilityHint="Opens in your browser"
                    onPress={onNoticeAction}
                    style={styles.noticeAction}>
                    <Text style={styles.noticeActionText}>{noticeActionLabel}</Text>
                    <Ionicons name="open-outline" size={13} color={noticeBlue} />
                  </PressableScale>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
        {presets.length > 0 ? (
        <View style={styles.presetRow}>
          {presets.map((preset) => {
            const normalizedPreset = preset.trim();
            const isPercent = normalizedPreset.endsWith('%');
            const isMax = normalizedPreset.toLowerCase() === 'max';
            const presetLabel = isPercent || isMax
              ? normalizedPreset
              : unitSymbol === '$'
                ? `$${normalizedPreset}`
                : `${normalizedPreset} ${unitSymbol}`;
            const presetA11y = isPercent || isMax
              ? `Set amount to ${normalizedPreset}`
              : `Set amount to ${normalizedPreset} ${unitLabel}`;

            return (
              <Pressable
                key={preset}
                accessibilityRole="button"
                accessibilityLabel={presetA11y}
                disabled={submitting}
                onPress={() => onTapPreset(preset)}
                style={[styles.presetPill, amount === preset && styles.presetPillActive]}>
                <Text style={[styles.presetText, amount === preset && styles.presetTextActive]}>
                  {presetLabel}
                </Text>
              </Pressable>
            );
          })}
        </View>
        ) : null}

        <View style={styles.dialpadWrap}>
          <View style={styles.dialpad}>
            {NUMERIC_KEYPAD_ROWS.map((row) => (
              <View key={row.join('-')} style={styles.dialRow}>
                {row.map((digit) => (
                  <Pressable
                    key={digit}
                    accessibilityRole="button"
                    accessibilityLabel={digit === 'del' ? 'Delete digit' : `Enter ${digit}`}
                    disabled={submitting}
                    style={({ pressed }) => [
                      styles.dialKey,
                      pressed && { backgroundColor: `${actionColor}1A` },
                    ]}
                    onPress={() => onTapDigit(digit)}>
                    {digit === 'del' ? (
                      <Ionicons name="backspace-outline" size={28} color={colors.text} />
                    ) : digit === '.' ? (
                      <View style={styles.dotIndicator} />
                    ) : (
                      <Text style={styles.dialKeyText}>{digit}</Text>
                    )}
                  </Pressable>
                ))}
              </View>
            ))}
          </View>

          {/*
            Drop-up detail panel. Absolutely positioned so it OVERLAYS the
            bottom of the keypad instead of taking layout space: opening it must
            not move the confirm button under a finger already reaching for it,
            and must not shove the amount/keypad upward either.
          */}
          {hasDetails && detailsOpen ? (
            <View style={styles.detailPanel}>
              {detailRows!.map((row, index) => (
                // Indexed: two legs of one basket can carry the same symbol,
                // and the label alone would collide.
                <View key={`${row.label}:${index}`} style={styles.detailRow}>
                  <Text style={styles.detailRowLabel}>{row.label}</Text>
                  <Text
                    style={[styles.detailRowValue, row.tone === 'warn' && styles.detailRowValueWarn]}
                    numberOfLines={1}>
                    {row.value}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {/* Balance footer — available (left), cash + the details toggle (right). */}
        {availableValue || cashLabel || hasDetails ? (
          <View style={styles.balanceRow}>
            {availableValue ? (
              <View style={styles.balanceItem}>
                <Text style={styles.balanceText}>{availableValue} available</Text>
                <Ionicons name="add-circle-outline" size={16} color={colors.textTertiary} />
              </View>
            ) : (
              <View />
            )}
            <View style={styles.balanceRight}>
              {cashLabel ? (
                <View style={styles.balanceItem}>
                  <Text style={styles.balanceText}>{cashLabel} cash</Text>
                  <Ionicons name="chevron-down" size={14} color={colors.textTertiary} />
                </View>
              ) : null}
              {hasDetails ? (
                <PressableScale
                  accessibilityRole="button"
                  accessibilityState={{ expanded: detailsOpen }}
                  accessibilityLabel={detailsOpen ? `Hide ${detailLabel.toLowerCase()}` : `Show ${detailLabel.toLowerCase()}`}
                  hitSlop={10}
                  onPress={() => {
                    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                    setDetailsOpen((open) => !open);
                  }}
                  style={styles.detailTrigger}>
                  <Text style={styles.detailTriggerText}>{detailLabel}</Text>
                  <RotatingChevron up={!detailsOpen} size={13} color={colors.textTertiary} />
                </PressableScale>
              ) : null}
            </View>
          </View>
        ) : null}

        {message ? <Text style={styles.message}>{message}</Text> : null}

        {shouldSlideToConfirm ? (
          <SlideToConfirm
            actionLabel={slideActionLabel}
            amountLabel={actionAmountLabel}
            actionColor={actionColor}
            // The unslid track is the action color itself, dialed down — the
            // fill that follows the thumb reads as the same color coming up to
            // full strength rather than a different surface being painted over.
            trackColor={`${actionColor}33`}
            trackBorderColor={`${actionColor}59`}
            canConfirm={canConfirm}
            submitting={submitting}
            submittingLabel={submittingLabel ?? `${actionLabel}ing...`}
            onSlideStart={onSubmitPressIn}
            onComplete={() => {
              Keyboard.dismiss();
              void onSubmit();
            }}
          />
        ) : (
          // The app's shared CTA pill (same family as the Sandwich BUY). As a
          // stand-in for the slide track it keeps the track's footprint, so the
          // keypad above does not shift when the amount crosses the balance.
          <View style={slideStandInStyle ?? styles.confirmWrap}>
            <CtaButton
              label={confirmLabel ?? `Confirm ${actionLabel}`}
              accessibilityLabel={confirmLabel ?? `Confirm ${actionLabel.toLowerCase()}`}
              color={actionColor}
              onPressIn={() => {
                if (canConfirm) onSubmitPressIn?.();
              }}
              onPress={() => {
                Keyboard.dismiss();
                void onSubmit();
              }}
              disabled={!canConfirm && !submitting}
              loading={submitting}
              loadingLabel={submittingLabel ?? `${actionLabel}ing...`}
            />
          </View>
        )}
      </View>
    </View>
  );
}

export const TradeAmountSheet = forwardRef<TradeAmountSheetRef, TradeAmountSheetProps>(function TradeAmountSheet({
  side = 'buy',
  symbol,
  icon,
  amountUnitSymbol,
  amountUnitLabel,
  availableLabel,
  amount,
  animateAmount,
  message,
  submitting,
  canConfirm,
  onClose,
  onSubmit,
  onTapDigit,
  onTapPreset,
  animatedIndex,
  confirmLabel,
  submittingLabel,
  title,
  slideToConfirm,
  addCash,
  actionLabel,
  snapPoints: snapPointsProp,
  solid = false,
  presets = ['10', '25', '50', '100'],
  noticeText,
  noticeCollapsible,
  noticeLabel,
  noticeActionLabel,
  onNoticeAction,
  previewContent,
  thesisText,
}: TradeAmountSheetProps, ref: React.ForwardedRef<TradeAmountSheetRef>) {
  const { height: windowHeight } = useWindowDimensions();
  const styles = useThemedStyles(makeStyles);
  const { scheme, colors } = useThemeStore();
  const sheetRef = useRef<BottomSheetModal>(null);
  // 90% of the screen: the pad and the perp ticket are the same object to a
  // user, so they open to the same height.
  const snapPoints = useMemo(() => snapPointsProp ?? ['90%'], [snapPointsProp]);
  const sheetHeight = useMemo(() => {
    const firstSnap = snapPoints[0];
    if (typeof firstSnap === 'number') return firstSnap;
    if (typeof firstSnap === 'string' && firstSnap.endsWith('%')) {
      const percent = Number(firstSnap.slice(0, -1));
      if (Number.isFinite(percent) && percent > 0) {
        return windowHeight * (percent / 100);
      }
    }
    return windowHeight * 0.9;
  }, [snapPoints, windowHeight]);

  // Present/dismiss imperatively from the caller's tap gesture. present() opens to
  // the first snap point directly — no effect, no snapToIndex retry hack needed.
  useImperativeHandle(
    ref,
    () => ({
      present: () => sheetRef.current?.present(),
      dismiss: () => sheetRef.current?.dismiss(),
    }),
    [],
  );

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) =>
      solid ? (
        <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.45} />
      ) : (
        // The backdrop steps back for the glass surface: the default blur plus a
        // 40%-black dim leaves the material nothing to refract, so the pad reads as
        // a flat grey slab instead of glass.
        <BlurBackdrop {...props} intensity={6} dimColor={scheme === 'dark' ? 'rgba(0, 0, 0, 0.4)' : 'rgba(15, 23, 42, 0.16)'} />
      ),
    [scheme, solid],
  );

  const renderBackground = useCallback(
    (props: BottomSheetBackgroundProps) => (
      <Animated.View {...props}>
        {solid ? (
          <View style={[StyleSheet.absoluteFill, styles.solidSurface, { backgroundColor: colors.surface }]} />
        ) : (
          <GlassSheetSurface
            topRadius={22}
            // Follows the theme now that the pad's palette is on tokens.
            forceScheme={scheme === 'dark' ? 'dark' : 'light'}
            scrimColor={scheme === 'dark' ? TRADE_PAD_SCRIM_DARK : TRADE_PAD_SCRIM}
          />
        )}
      </Animated.View>
    ),
    [colors.surface, scheme, solid],
  );

  return (
    <SheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      // `switch` (gorhom's default) minimizes the parent sheet then mounts this one,
      // and restores the parent on dismiss. The old `push` kept BOTH modals mounted
      // and visible at once, which fails to render the second on the New Architecture
      // (gorhom v5 + reanimated v4) — so the Buy/Sell sheet never appeared when opened
      // from inside the stock-detail / sandwich detail sheet. See [[bottom-sheet-present-pattern]].
      stackBehavior="switch"
      enablePanDownToClose
      animatedIndex={animatedIndex}
      backdropComponent={renderBackdrop}
      backgroundComponent={renderBackground}
      handleComponent={null}
      backgroundStyle={styles.sheetBg}
      style={styles.sheetSurface}
      onDismiss={onClose}>
      <BottomSheetView style={[styles.sheetContent, { height: sheetHeight }]}>
        <View style={styles.handleSpacer} />
        <TradeAmountPad
          side={side}
          symbol={symbol}
          icon={icon}
          amountUnitSymbol={amountUnitSymbol}
          amountUnitLabel={amountUnitLabel}
          availableLabel={availableLabel}
          amount={amount}
          animateAmount={animateAmount}
          message={message}
          submitting={submitting}
          canConfirm={canConfirm}
          onSubmit={onSubmit}
          onTapDigit={onTapDigit}
          onTapPreset={onTapPreset}
          confirmLabel={confirmLabel}
          submittingLabel={submittingLabel}
          title={title}
          slideToConfirm={slideToConfirm}
          addCash={addCash}
          actionLabel={actionLabel}
          presets={presets}
          noticeText={noticeText}
          noticeCollapsible={noticeCollapsible}
          noticeLabel={noticeLabel}
          noticeActionLabel={noticeActionLabel}
          onNoticeAction={onNoticeAction}
          previewContent={previewContent}
          thesisText={thesisText}
        />
      </BottomSheetView>
    </SheetModal>
  );
});

/**
 * Themed. The pad opens over every surface in the app, and a light palette
 * baked into a static sheet was the most-used screen that ignored dark mode.
 * Notice tints (amber / blue / violet) keep their hue and step lighter in
 * dark so text on a translucent tint stays readable against near-black.
 */
const makeStyles = (c: ThemeColors) => {
  const isDark = c.background !== '#ffffff';
  const amber = isDark ? '#fbbf24' : '#b45309';
  const amberDeep = isDark ? '#fcd34d' : '#92400e';
  const blue = isDark ? '#7dd3fc' : '#0369a1';
  const violet = isDark ? '#c4b5fd' : '#6d28d9';
  return StyleSheet.create({
  sheetSurface: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: 'hidden',
  },
  // The fill now comes from <GlassSheetSurface>; this only holds the shape and
  // clips the native material to the sheet's top corners.
  sheetBg: {
    backgroundColor: 'transparent',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: 'hidden',
  },
  solidSurface: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  sheetContent: {
    paddingHorizontal: 16,
    paddingBottom: 28,
  },
  body: {
    flex: 1,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingTop: 4,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.surfaceAlt,
  },
  headerTitleCol: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    color: c.text,
    fontSize: 20,
    fontWeight: '900',
    fontFamily: F,
  },
  headerSubtitle: {
    color: c.textTertiary,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: F,
    marginTop: -1,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  headerPrice: {
    color: c.text,
    fontSize: 20,
    fontWeight: '900',
    fontFamily: F,
    letterSpacing: -0.6,
  },
  headerChange: {
    fontSize: 14,
    fontWeight: '800',
    fontFamily: F,
    marginTop: -1,
  },
  headerPercentageChange: {
    fontFamily: Fonts.displayMedium,
  },
  amountWrap: {
    flexGrow: 1,
    alignItems: 'center',
    gap: 6,
  },
  amountCenter: {
    flex: 1,
    alignSelf: 'stretch',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Tall enough for TradeQuotePreviewRow (4pt top padding + one 14pt line
  // + the spinner beside it), always occupied whether or not it has content.
  previewSlot: {
    height: 30,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  // The keypad has fixed shared geometry, so any spare height belongs to the
  // amount/content area instead of being inserted between number rows.
  bottomSection: {
    flexGrow: 0,
    flexShrink: 1,
    justifyContent: 'flex-end',
  },
  // The grab pill is gone app-wide; this keeps the space it used to occupy so
  // the header doesn't jump up against the sheet edge.
  handleSpacer: {
    height: 26,
  },
  // The placeholder "0" holds layout so the keypad never jumps. Kept as a ghost
  // rather than hidden outright: at zero opacity the top of the pad reads as
  // broken empty space, with nothing marking where the amount lands.
  amountDisplayEmpty: {
    opacity: 0.14,
  },
  amountDisplay: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    marginTop: 6,
    gap: 0,
  },
  amountCurrency: {
    color: c.text,
    fontSize: 48,
    fontWeight: '900',
    fontFamily: F,
  },
  amountValue: {
    color: c.text,
    fontSize: 52,
    fontWeight: '900',
    fontFamily: F,
    letterSpacing: -2,
  },
  amountNotePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'center',
    maxWidth: '86%',
    marginTop: 16,
    paddingLeft: 11,
    paddingRight: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(124, 58, 237, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.22)',
  },
  amountNotePlainText: {
    alignSelf: 'center',
    maxWidth: '86%',
    marginTop: 12,
    height: 18,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    fontFamily: F,
    textAlign: 'center',
  },
  amountNoteDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: '#7c3aed',
  },
  amountNoteText: {
    flexShrink: 1,
    color: violet,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: '800',
    fontFamily: F,
    letterSpacing: 0.1,
  },
  noticeBanner: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 10,
  },
  noticeBannerWarning: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 6,
    backgroundColor: 'rgba(245, 158, 11, 0.13)',
  },
  noticeSummary: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  noticeSummaryText: {
    flex: 1,
    color: amber,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '900',
    fontFamily: F,
  },
  noticeBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  noticeBodyInline: {
    flex: 1,
  },
  noticeText: {
    flex: 1,
    color: blue,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    fontFamily: F,
    textAlign: 'left',
  },
  noticeTextWarning: {
    color: amberDeep,
  },
  noticeAction: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  noticeActionPressed: {
    opacity: 0.6,
  },
  noticeActionText: {
    color: blue,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '900',
    fontFamily: F,
    textDecorationLine: 'underline',
  },
  thesisQuote: {
    color: c.text,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '800',
    fontFamily: F,
    textAlign: 'left',
    alignSelf: 'stretch',
    marginTop: 6,
  },
  presetRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
    alignSelf: 'stretch',
  },
  presetPill: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: c.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetPillActive: {
    backgroundColor: c.text,
  },
  presetText: {
    color: c.textSecondary,
    fontSize: 14,
    fontWeight: '800',
    fontFamily: F,
  },
  presetTextActive: {
    color: c.background,
  },
  dialpad: {
    flex: 1,
    marginTop: 8,
    gap: NUMERIC_KEYPAD_GAP,
  },
  dialRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  dialKey: {
    flex: 1,
    alignSelf: 'stretch',
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  dialKeyText: {
    color: c.text,
    fontSize: NUMERIC_KEYPAD_FONT_SIZE,
    fontWeight: '700',
    fontFamily: F,
    letterSpacing: -0.5,
  },
  dotIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: c.text,
  },
  // Left-aligned, directly above the confirm button: the same corner the
  // balance sits in, so the footer reads as one strip of secondary facts.
  detailTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  detailTriggerText: {
    color: c.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: F,
  },
  // Eight points above the shared grid separates it from presets/risk copy;
  // the rows themselves never stretch with the modal's remaining height.
  dialpadWrap: {
    position: 'relative',
    flexGrow: 0,
    flexShrink: 0,
    height: NUMERIC_KEYPAD_HEIGHT + 8,
  },
  // Overlays the bottom of the keypad rather than taking layout space, so
  // opening it neither moves the confirm button under a finger already reaching
  // for it nor shoves the amount upward. The style has to carry the positioning
  // for that to be true — in flow it simply stacked below the keys.
  detailPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: c.surface,
    gap: 2,
    shadowColor: c.shadow,
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -6 },
    elevation: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 3,
  },
  detailRowLabel: {
    color: c.textSecondary,
    fontSize: 12.5,
    fontWeight: '600',
    fontFamily: F,
  },
  detailRowValue: {
    color: c.text,
    fontSize: 12.5,
    fontWeight: '800',
    fontFamily: F,
    flexShrink: 1,
  },
  detailRowValueWarn: {
    color: amber,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 2,
  },
  balanceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  balanceRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  balanceText: {
    color: c.textSecondary,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: F,
  },
  message: {
    marginBottom: 8,
    color: c.text,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
    textAlign: 'center',
    fontFamily: F,
  },
  confirmDisabled: {
    opacity: 0.4,
  },
  slideConfirmWrap: {
    marginTop: 10,
    width: '100%',
  },
  // Matches the slide track's box exactly so swapping one for the other is
  // a relabel, not a reflow.
  slideStandIn: {
    marginTop: 10,
    minHeight: SLIDE_HEIGHT,
    justifyContent: 'center',
  },
  confirmWrap: {
    marginTop: 12,
  },
  slideTrack: {
    height: SLIDE_HEIGHT,
    borderRadius: 18,
    borderWidth: 1,
    padding: SLIDE_PADDING,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  slideProgress: {
    position: 'absolute',
    left: SLIDE_PADDING,
    top: SLIDE_PADDING,
    bottom: SLIDE_PADDING,
    borderRadius: 14,
  },
  slideTrackLabelWrap: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: SLIDE_THUMB_SIZE + 8,
  },
  slideTrackLabel: {
    color: '#ffffff',
    fontSize: 26,
    fontFamily: Fonts.displayOne,
    letterSpacing: 0.6,
  },
  slideThumb: {
    width: SLIDE_THUMB_SIZE,
    height: SLIDE_THUMB_SIZE,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 4,
    elevation: 3,
  },
  padBack: {
    padding: 8,
    borderRadius: 999,
  },
  padBackPressed: {
    backgroundColor: c.surfaceAlt,
  },
});
};
