import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { AssetLogo } from '@/components/asset-logo';
import { AnimatedAmountDigits } from '@/components/animated-amount-digits';
import { SlideToConfirm } from '@/components/trade-amount-sheet';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { getSheetColors } from '@/lib/sheet-colors';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { withAlpha } from '@/lib/color-utils';
import { CTA, ctaBottomInset } from '@/lib/screen-corners';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeStore } from '@/lib/theme-store';
import {
  NUMERIC_KEYPAD_FONT_SIZE,
  NUMERIC_KEYPAD_GAP,
  NUMERIC_KEYPAD_HEIGHT,
  NUMERIC_KEYPAD_ROWS,
} from '@/lib/numeric-keypad-layout';
import { LeverageRuler } from '@/components/leverage-ruler';
import { ValueSkeleton, ValueSkeletonLine } from '@/components/value-skeleton';
import type { PhoenixTradeSide } from '@/lib/phoenix-api';
import { PressableScale } from '@/components/pressable-scale';
import { RotatingChevron } from '@/components/rotating-chevron';

const F = Fonts.rounded;

/**
 * The order breakdown's drop-up. A spring in, an eased timing out — the panel
 * is small and near the thumb, so it moves faster than the ticket itself.
 */
const DETAILS_ENTRY = { damping: 26, stiffness: 260, mass: 1 } as const;
const DETAILS_EXIT = { duration: 170, easing: Easing.in(Easing.quad) } as const;

export type PhoenixOrderPadProps = {
  /**
   * The host cannot paint native Liquid Glass — measured on iOS 26, a
   * `GlassView` inside the Sandwich leg's morph card lays down no fill, so
   * every CTA here would be a white label on a near-white capsule.
   */
  disableGlass?: boolean;
  symbol: string;
  logoUri?: string | null;
  logoFallbackUris?: readonly (string | null)[];
  openInterestUsd?: number | null;
  side: PhoenixTradeSide;
  /** Margin, as typed on the keypad (raw string so "10." stays editable). */
  amount: string;
  leverage: number;
  /** Top of the ruler — the market's own max leverage (e.g. 20x on AAPL). */
  maxLeverage: number;
  /** Live mark, used for the entry row. */
  markPrice: number | null;
  /** 24h change on the mark, shown under the price. Replaces the old "Market"
   *  label: the order type is fixed and never told anyone anything. */
  change24hPercent?: number | null;
  /**
   * Projected liquidation for this entry, computed by the owner.
   *
   * Not derived here: the Auto Close card stacked on top of this one clamps its
   * stop to the same wall, and two cards estimating it separately is how they
   * came to quote $155 and $170 for one 2x AAPL entry. Null while the mark or
   * the market is still loading — rendered as "—", never guessed.
   */
  liquidationPrice: number | null;
  estimatedFeeUsd: number;
  feeRatePercent?: number | null;
  availableMarginUsd: number;
  cashUsd: number;
  /** Error / status line shown above the action row. */
  message?: string | null;
  /** Auto-close levels already chosen for this entry, in price terms. */
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
  submitting: boolean;
  canConfirm: boolean;
  /**
   * Shortfall between the perps account's free collateral and this order's
   * margin, when wallet cash can cover it. Above zero, the pad offers to move
   * it across; zero hides the control entirely.
   */
  moveCashUsd?: number;
  movingCash?: boolean;
  onMoveCash?: () => void;
  /**
   * The wallet itself cannot cover this margin. The slider would only ever
   * sit disabled, so the CTA slot offers the deposit flow instead; the "+"
   * beside the available balance opens the same thing at any time.
   */
  needsCash?: boolean;
  onAddCash?: () => void;
  /**
   * The margin string after a keypad tap. Delivered inside a transition: the
   * pad echoes the digit itself first, so the sheet's (much larger) re-render
   * never sits between the tap and the number appearing.
   */
  onChangeAmount: (next: string) => void;
  onChangeLeverage: (next: number) => void;
  onSubmit: () => void | Promise<void>;
  onAutoClose?: () => void;
};



/**
 * Full-height order pad for a Phoenix perp — the screen behind the LONG / SHORT
 * buttons on the perp detail sheet.
 *
 * The typed number is **margin** (collateral at risk); the notional the market
 * order actually sends is `margin × leverage`, shown above the amount as
 * "Leveraged size". Leverage moves in 0.1x steps, matching the backend and the
 * fine tick ruler shown in the ticket.
 *
 * Every button here is a Liquid Glass button on iOS 26 with a solid tinted
 * fallback everywhere else. The keypad keys are deliberately *not* glass —
 * twelve stacked native glass views blur into an unreadable mush and cost a
 * real amount of frame time.
 */
export function PhoenixOrderPad({
  symbol,
  logoUri = null,
  logoFallbackUris = [],
  openInterestUsd = null,
  side,
  amount,
  leverage,
  maxLeverage,
  markPrice,
  change24hPercent = null,
  liquidationPrice,
  estimatedFeeUsd,
  feeRatePercent = null,
  availableMarginUsd,
  cashUsd,
  message,
  takeProfitPrice = null,
  stopLossPrice = null,
  submitting,
  canConfirm,
  moveCashUsd = 0,
  movingCash = false,
  onMoveCash,
  needsCash = false,
  onAddCash,
  onChangeAmount,
  onChangeLeverage,
  onSubmit,
  onAutoClose,
}: PhoenixOrderPadProps) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { colors, scheme } = useThemeStore();
  const isDark = scheme === 'dark';

  // What the keypad shows, owned here so a tap paints on the next frame.
  // `amount` (the owner's copy) catches up in a transition; values we sent
  // ourselves are recognised on the way back so a slow commit can't rewind
  // the display, while an owner-side reset (a new market, a fill) still lands.
  const [typed, setTyped] = useState(amount);
  const typedRef = useRef(amount);
  const sentRef = useRef<string[]>([]);
  useEffect(() => {
    const sent = sentRef.current;
    const echo = sent.indexOf(amount);
    if (echo !== -1) {
      sentRef.current = sent.slice(echo + 1);
      return;
    }
    sentRef.current = [];
    typedRef.current = amount;
    setTyped(amount);
  }, [amount]);
  const tapDigit = useCallback(
    (key: string) => {
      const next = applyPhoenixKeypad(typedRef.current, key);
      if (next === typedRef.current) return;
      typedRef.current = next;
      sentRef.current.push(next);
      setTyped(next);
      startTransition(() => onChangeAmount(next));
    },
    [onChangeAmount],
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  /**
   * Kept mounted across the close so the panel can animate out, and so the
   * entry starts only once it exists — see {@link toggleDetails}.
   */
  const [detailsMounted, setDetailsMounted] = useState(false);
  const detailsProgress = useSharedValue(0);

  const toggleDetails = useCallback(() => {
    void Haptics.selectionAsync();
    const next = !detailsOpen;
    setDetailsOpen(next);
    if (next) {
      // Mount now, animate in the effect below. Starting the spring here ran it
      // on the UI thread while JS was still rendering the rows, so the panel
      // arrived already half-open.
      setDetailsMounted(true);
      return;
    }
    detailsProgress.value = withTiming(0, DETAILS_EXIT, (finished) => {
      'worklet';
      if (finished) runOnJS(setDetailsMounted)(false);
    });
  }, [detailsOpen, detailsProgress]);

  useEffect(() => {
    if (!detailsMounted || !detailsOpen) return;
    // Also the path back when a re-tap catches the panel mid-close.
    detailsProgress.value = withSpring(1, DETAILS_ENTRY);
  }, [detailsMounted, detailsOpen, detailsProgress]);

  const detailsStyle = useAnimatedStyle(() => ({
    opacity: detailsProgress.value,
    transform: [
      { translateY: interpolate(detailsProgress.value, [0, 1], [14, 0], Extrapolation.CLAMP) },
    ],
  }));

  const accent = side === 'long' ? colors.actionBuy : colors.actionSell;
  const margin = Number(typed);
  const validMargin = Number.isFinite(margin) && margin > 0;
  const notionalUsd = validMargin ? margin * leverage : 0;
  // Shrinks with length the way adjustsFontSizeToFit did for the single Text.
  const amountFont = Math.max(28, Math.min(48, (48 * 7) / Math.max(7, (typed || '0').length)));
  const hasAutoClose = takeProfitPrice !== null || stopLossPrice !== null;
  const quantity = markPrice && markPrice > 0 ? notionalUsd / markPrice : null;
  const marginUsed = validMargin ? margin + estimatedFeeUsd : null;
  const feeLabel = feeRatePercent === null ? '—' : `${feeRatePercent.toFixed(2)}%`;

  const balanceRow = (
    <View style={styles.balanceRow}>
      <View style={styles.availableWrap}>
        <Text style={styles.availableText}>{formatUsd(availableMarginUsd + cashUsd, 0)} available</Text>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Add cash"
          disabled={!onAddCash}
          hitSlop={10}
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onAddCash?.();
          }}
        >
          <Ionicons name="add-circle-outline" size={22} color={colors.textSecondary} />
        </PressableScale>
      </View>
      <PressableScale
        accessibilityRole="button"
        accessibilityState={{ expanded: detailsOpen }}
        accessibilityLabel={detailsOpen ? 'Hide order details' : 'Show order details'}
        onPress={toggleDetails}
        hitSlop={10}
        style={styles.quantityButton}
      >
        <Text style={styles.quantityText}>
          {quantity === null ? '—' : quantity.toLocaleString('en-US', { maximumFractionDigits: 6 })} {symbol}
        </Text>
        <RotatingChevron up={detailsOpen} size={15} color={colors.textSecondary} />
      </PressableScale>
    </View>
  );

  return (
    // The card runs to the screen's bottom edge: on Android that is under the
    // navigation bar, so the slide-to-trade CTA has to clear it.
    <View style={[styles.root, { paddingBottom: ctaBottomInset(insets.bottom) }]}>
      <View style={styles.marketHeader}>
        <View style={styles.assetIdentity}>
          <AssetLogo
            uri={logoUri}
            fallbackUris={logoFallbackUris}
            size={36}
            backgroundColor={withAlpha(accent, 0.16)}
            fallback={
              <Text style={[styles.logoFallback, { color: accent }]}>
                {symbol.slice(0, 1)}
              </Text>
            }
          />
          <View>
            <Text style={styles.marketSymbol}>{symbol}</Text>
            <Text style={styles.openInterest}>
              {openInterestUsd === null ? 'Open interest —' : `${formatCompactUsd(openInterestUsd)} OI`}
            </Text>
          </View>
        </View>
        <View style={styles.marketQuote}>
          <Text style={styles.markPrice}>
            {markPrice === null ? '—' : formatUsd(markPrice)}
          </Text>
          <Text
            style={[
              styles.marketChange,
              {
                color:
                  change24hPercent === null || change24hPercent === 0
                    ? colors.textSecondary
                    : change24hPercent > 0
                      ? colors.positive
                      : colors.negative,
              },
            ]}
          >
            {change24hPercent === null
              ? '—'
              : `${change24hPercent > 0 ? '+' : ''}${change24hPercent.toFixed(2)}%`}
          </Text>
        </View>
      </View>

      <View style={styles.amountBlock}>
        <View style={[styles.amountRow, !(margin > 0) && styles.amountPlaceholder]}>
          <Text style={[styles.amountCurrency, { fontSize: amountFont * 0.8 }]}>
            $
          </Text>
          <AnimatedAmountDigits
            value={typed || '0'}
            style={[styles.amountValue, { fontSize: amountFont }]}
            shrinkToFit={false}
          />
        </View>
        {/* Reads as a consequence of the amount above it. Sitting on top, it
            was the first figure on the ticket and the one being typed was the
            second. */}
        <Text style={styles.leveragedSize}>
          Leveraged size <Text style={styles.leveragedSizeValue}>{validMargin ? formatUsd(notionalUsd, 0) : '$0'}</Text>
        </Text>
      </View>

      {/* A fixed centre bracket reads the leverage while the user scrubs the
          scale beneath it. Each whole-x sits in its own cell between two hash
          marks, keeping the moving ruler legible without becoming a chart. */}
      <View style={styles.leverageRow}>
        <LeverageRuler
          value={leverage}
          max={maxLeverage}
          accent={accent}
          onChange={onChangeLeverage}
          height={56}
          slot={44}
          hideCaption
        />
      </View>

      {/* Liq., the SL/TP link, its summary and the keypad move as one block,
          anchored to the bottom of the ticket. The auto margin used to sit on
          the keypad alone, which left the risk row stranded under the ruler
          with the ticket's whole leftover height opening up beneath it. */}
      <View style={styles.bottomStack}>
      {/* One line, both figures inline. The old two-column block was 43pt of
          labels for two numbers. */}
      <View style={styles.riskRow}>
        <View style={styles.riskInline}>
          <Text style={styles.riskLabel}>Liq.</Text>
          {markPrice === null ? (
            <ValueSkeleton width={58} height={14} accessibilityLabel="Loading liquidation price" />
          ) : (
            <Text style={styles.riskValue}>
              {liquidationPrice === null ? '—' : formatUsd(liquidationPrice)}
            </Text>
          )}
        </View>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={
            hasAutoClose
              ? 'Edit stop loss and take profit'
              : 'Add stop loss and take profit'
          }
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onAutoClose?.();
          }}
          hitSlop={8}
          style={styles.riskInline}
        >
          <Text style={[styles.autoCloseLink, { color: accent }]}>
            {hasAutoClose ? 'Edit SL/TP' : 'Add SL/TP'}
          </Text>
        </PressableScale>
      </View>

      {hasAutoClose ? (
        <View style={styles.autoCloseSummary}>
          {stopLossPrice !== null ? (
            <Text style={[styles.autoCloseText, { color: colors.negative }]}>SL {formatUsd(stopLossPrice)}</Text>
          ) : null}
          {takeProfitPrice !== null ? (
            <Text style={[styles.autoCloseText, { color: colors.positive }]}>TP {formatUsd(takeProfitPrice)}</Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.keypad}>
        {NUMERIC_KEYPAD_ROWS.map((row) => (
          <View key={row.join('')} style={styles.keyRow}>
            {row.map((key) => (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={key === 'del' ? 'Delete digit' : `Enter ${key}`}
                disabled={submitting}
                // Fires on touch-down, like the system keyboard. On release,
                // any tap that drifted 10pt downward was claimed by the
                // ticket's swipe-to-dismiss pan and silently dropped.
                onPressIn={() => {
                  void Haptics.selectionAsync();
                  tapDigit(key);
                }}
                style={({ pressed }) => [
                  styles.key,
                  pressed && { backgroundColor: withAlpha(accent, 0.14) },
                ]}
              >
                {key === 'del' ? (
                  <Ionicons name="backspace-outline" size={26} color={colors.text} />
                ) : (
                  <Text style={styles.keyText}>{key}</Text>
                )}
              </Pressable>
            ))}
          </View>
        ))}
      </View>
      </View>

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <View style={styles.footer}>
        {/* The balance row stays put whether the breakdown is open or not. It
            used to move INTO the panel on open, which teleported it half a row
            up the moment the animation started. */}
        {detailsMounted ? (
          <Animated.View
            style={[styles.detailsPanel, detailsStyle]}
            pointerEvents={detailsOpen ? 'auto' : 'none'}
          >
            <DetailRow
              label="Est. fill price"
              value={markPrice === null ? null : formatPrice(markPrice)}
            />
            <DetailRow label="Est. slippage" value="0.00%" />
            <DetailRow label="Fee" value={feeLabel} />
            <DetailRow label="Margin used" value={marginUsed === null ? '—' : formatUsd(marginUsed)} />
          </Animated.View>
        ) : null}
        {balanceRow}

        {needsCash && onAddCash ? (
          /* The wallet can't cover it either: a disabled slider says nothing
             the user can act on, so the slot becomes the way to get cash. */
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Add cash"
            scaleTo={0.98}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onAddCash();
            }}
            style={[styles.moveCashCta, { backgroundColor: colors.actionPrimary }]}
          >
            <Text style={styles.moveCashCtaText}>ADD CASH</Text>
          </PressableScale>
        ) : moveCashUsd > 0 && onMoveCash ? (
          /* Top-up takes the CTA's slot: until the collateral is in the perps
             account there is nothing to slide, so the one button on screen is
             the move. The slider returns once the shortfall is covered. */
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`Move ${formatUsd(moveCashUsd)} from cash to perps`}
            accessibilityState={{ busy: movingCash, disabled: movingCash }}
            disabled={movingCash}
            scaleTo={0.98}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onMoveCash();
            }}
            // Solid app blue, not a tint of the side's colour: moving cash
            // is account plumbing, not a long or a short, and the tinted track
            // read as a disabled slider.
            style={[styles.moveCashCta, { backgroundColor: colors.actionPrimary }]}
          >
            {movingCash ? (
              <ActivityIndicator size="small" color={colors.actionPrimaryText} />
            ) : (
              <Text style={styles.moveCashCtaText}>
                {`MOVE ${formatUsd(moveCashUsd)}`}
              </Text>
            )}
          </PressableScale>
        ) : (
          <SlideToConfirm
            actionLabel={side === 'long' ? 'Long' : 'Short'}
            amountLabel={validMargin ? `${formatUsd(margin)} margin` : 'No margin entered'}
            actionColor={accent}
            trackColor={withAlpha(accent, isDark ? 0.2 : 0.24)}
            trackBorderColor={withAlpha(accent, isDark ? 0.48 : 0.42)}
            canConfirm={canConfirm}
            submitting={submitting}
            // Keep the visible CTA copy to the direction only, even in flight.
            submittingLabel={side === 'long' ? 'Long' : 'Short'}
            onComplete={() => void onSubmit()}
          />
        )}
      </View>
    </View>
  );
}

/** `value: null` means the figure is still loading, and shows a skeleton. */
function DetailRow({ label, value }: { label: string; value: string | null }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      {value === null ? (
        <ValueSkeletonLine
          lineHeight={16}
          width={72}
          accessibilityLabel={`Loading ${label.toLowerCase()}`}
        />
      ) : (
        <Text style={styles.detailValue}>{value}</Text>
      )}
    </View>
  );
}

/**
 * Applies one keypad tap to the typed margin string.
 *
 * Shared with the perp detail sheet so the pad and its owner never disagree on
 * what "backspace on an empty field" means.
 */
export function applyPhoenixKeypad(current: string, key: string): string {
  if (key === 'del') return current.slice(0, -1);
  if (key === '.') {
    if (current.includes('.')) return current;
    return current === '' ? '0.' : `${current}.`;
  }
  if (current === '0') return key;
  const next = `${current}${key}`;
  // Two decimals is the most USDC can settle at anyway.
  const [, decimals] = next.split('.');
  if (decimals && decimals.length > 2) return current;
  return next;
}

function formatUsd(value: number, maxFractionDigits = 2): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: Math.min(2, maxFractionDigits),
    maximumFractionDigits: maxFractionDigits,
  })}`;
}

function formatPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return formatUsd(value, value < 1 ? 4 : 0);
}

/**
 * Hermes ships an Intl without `notation: 'compact'`, so it silently returns the
 * full grouped number — "$343,290.97 OI" instead of "$343K OI". Done by hand.
 */
function formatCompactUsd(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value.toFixed(0)}`;
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    // Fills the ticket, which is a fixed near-full-screen card. The keypad keeps
    // a compact shared height; any remaining room belongs to the amount block.
    root: {
      flex: 1,
      paddingHorizontal: 18,
      // No grabber or cancel button lives above this header anymore. Give the
      // body its own breathing room so the logo and quote do not sit flush
      // against the ticket's rounded top edge.
      paddingTop: 18,
      paddingBottom: CTA.inset,
    },

    marketHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 44,
    },
    assetIdentity: { flexDirection: 'row', alignItems: 'center', gap: 9 },
    logoFallback: { fontFamily: F, fontSize: 16, fontWeight: '900' },
    marketSymbol: { fontFamily: F, color: c.text, fontSize: 17, fontWeight: '900' },
    openInterest: { fontFamily: F, color: c.textSecondary, fontSize: 11.5, fontWeight: '700', marginTop: 1 },
    marketQuote: { alignItems: 'flex-end' },
    markPrice: { fontFamily: F, color: c.text, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
    marketChange: {
      fontFamily: F,
      fontSize: 12.5,
      fontWeight: '800',
      marginTop: 1,
      fontVariant: ['tabular-nums'],
    },

    // Takes the slack above the fixed keypad, between a floor that still fits
    // the 48pt figure and a ceiling past which the figure just floats in space.
    amountBlock: {
      flexGrow: 1,
      flexShrink: 1,
      minHeight: 54,
      maxHeight: 180,
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: 4,
    },
    leveragedSize: { fontFamily: F, color: c.textSecondary, fontSize: 12.5, fontWeight: '700', marginTop: 2 },
    leveragedSizeValue: { color: c.text, fontWeight: '800' },
    amountRow: { flexDirection: 'row', alignItems: 'baseline' },
    // Blank or zero, unit included — matched to the spot pad's fade.
    amountPlaceholder: { opacity: 0.14 },
    amountCurrency: { fontFamily: F, color: c.text, fontSize: 38, fontWeight: '900' },
    amountValue: {
      fontFamily: F,
      color: c.text,
      fontSize: 48,
      fontWeight: '900',
      letterSpacing: -2,
    },

    // Pull the ruler slightly toward the amount so the two read as one sizing
    // control instead of separate blocks.
    leverageRow: { marginTop: -4, marginBottom: 0 },

    riskRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 6,
      minHeight: 26,
    },
    riskInline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    riskLabel: { fontFamily: F, color: c.negative, fontSize: 12, fontWeight: '700' },
    riskValue: { fontFamily: F, color: c.negative, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
    autoCloseLink: { fontFamily: F, fontSize: 14, fontWeight: '900' },

    // Consumes the ticket's leftover height, anchoring the risk row, the SL/TP
    // summary, the keypad and everything after it (balance + slider) to the
    // bottom edge as one group.
    bottomStack: { marginTop: 'auto' },

    // Match every other trade keypad: four compact, full-size touch rows.
    keypad: {
      flexGrow: 0,
      flexShrink: 0,
      height: NUMERIC_KEYPAD_HEIGHT + 8,
      paddingTop: 8,
      gap: NUMERIC_KEYPAD_GAP,
    },
    keyRow: { flex: 1, flexDirection: 'row', gap: 8 },
    key: {
      flex: 1,
      alignSelf: 'stretch',
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    keyText: {
      fontFamily: F,
      color: c.text,
      fontSize: NUMERIC_KEYPAD_FONT_SIZE,
      fontWeight: '600',
    },

    autoCloseSummary: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 10,
      marginTop: -5,
      marginBottom: 3,
    },
    autoCloseText: {
      fontFamily: F,
      fontSize: 11,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },

    message: {
      fontFamily: F,
      color: c.negative,
      fontSize: 12,
      lineHeight: 17,
      textAlign: 'center',
      marginTop: 4,
    },

    // Sized to sit between the keypad and the actions without stealing a row of
    // height from either — the pad is already tight on a small phone.
    // Same box as the slide-to-confirm track it stands in for.
    moveCashCta: {
      height: 68,
      borderRadius: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },
    // Same face and size as the slider's track label it stands in for.
    moveCashCtaText: {
      fontFamily: Fonts.displayOne,
      color: c.actionPrimaryText,
      fontSize: 26,
      letterSpacing: 0.6,
    },

    footer: { position: 'relative' },
    balanceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
    availableWrap: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    availableText: { fontFamily: F, color: c.textSecondary, fontSize: 13, fontWeight: '700' },
    // Sized off the amount being typed, not competing with it: the quantity is
    // a consequence of the margin above, so it sits at rung 3 (tertiary).
    quantityText: {
      fontFamily: F,
      color: c.textTertiary,
      fontSize: 13,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    quantityButton: { flexDirection: 'row', alignItems: 'center', gap: 4 },

    pressed: { opacity: 0.85 },
    disabled: { opacity: 0.4 },

    // The breakdown rises from the footer and covers only the lower keypad area,
    // matching the stock buy sheet while keeping the confirm action AND the
    // balance row it sits above visible.
    detailsPanel: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 90,
      paddingHorizontal: 20,
      paddingTop: 4,
      paddingBottom: 8,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      backgroundColor: getSheetColors(c).background,
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: -5 },
      shadowOpacity: 0.14,
      shadowRadius: 12,
      elevation: 8,
    },
    detailRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 4,
    },
    detailLabel: { fontFamily: F, color: c.textSecondary, fontSize: 14, fontWeight: '700' },
    detailValue: { fontFamily: F, color: c.text, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  });
