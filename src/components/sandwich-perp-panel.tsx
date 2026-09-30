import React, { useEffect } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue } from 'react-native-reanimated';
import { AssetLogo } from '@/components/asset-logo';

import { LeverageRuler } from '@/components/leverage-ruler';
import { Colors, Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { PerpSandwichRisk } from '@/hooks/use-perp-sandwich-risk';
import { withAlpha } from '@/lib/color-utils';
import { ValueSkeletonLine } from '@/components/value-skeleton';
import { useThemeStore } from '@/lib/theme-store';

const F = Fonts.rounded;

/** Reanimated drives text only through a TextInput's `text` prop. */
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1000) return `$${Math.round(value).toLocaleString('en-US')}`;
  return `$${value.toFixed(value < 10 ? 2 : 0)}`;
}

/**
 * `formatUsd` on the UI thread. Same output, minus `toLocaleString` — the
 * worklet runtime has no Intl to group the thousands with.
 */
function formatUsdWorklet(value: number): string {
  'worklet';
  if (!Number.isFinite(value)) return '—';
  if (value < 1000) return `$${value.toFixed(value < 10 ? 2 : 0)}`;
  let rest = Math.round(value);
  let grouped = '';
  while (rest >= 1000) {
    grouped = `,${(rest % 1000).toString().padStart(3, '0')}${grouped}`;
    rest = Math.floor(rest / 1000);
  }
  return `$${rest}${grouped}`;
}

/**
 * Cents always. The shared `formatUsd` rounds above $10, which is exactly wrong
 * for the debit line: "$100" against a $100.34 requirement reads as affordable
 * when it isn't.
 */
function formatUsdExact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  })}`;
}

export type SandwichPerpPanelProps = {
  side: 'long' | 'short';
  risk: PerpSandwichRisk;
  leverage: number;
  onChangeLeverage: (next: number) => void;
  /** Fixed light scheme for the trade pad overlay. */
  forceScheme?: 'light' | 'dark';
};

/**
 * Risk controls for a perp Sandwich entry, rendered inside the buy pad's
 * `thesisContent` slot: leverage, stop-loss, and what the split actually does to
 * each leg.
 *
 * Two constraints shape this:
 *
 * 1. **Height is fixed and small.** The pad's dialpad and confirm button own
 *    ~380pt of a 94%-height sheet with scrolling disabled, so everything here
 *    has to live in ~150-190pt (less on an SE) or it collides with the keypad.
 *    Hence the single-line header, the shrunk ruler, and one line per leg.
 * 2. **There is no stop control here, by design.** A protective stop is still
 *    placed with every entry — the backend refuses an order without one — but
 *    its maintenance-aware ceiling contracts as leverage rises, which makes it
 *    a poor thing to hand someone on a keypad. The owner keeps a sane default
 *    and clamps it under the ceiling.
 *    The single-market Phoenix pad still exposes the full control.
 */
export function SandwichPerpPanel({
  side,
  risk,
  leverage,
  onChangeLeverage,
  forceScheme = 'light',
}: SandwichPerpPanelProps) {
  const styles = useThemedStyles(makeStyles, forceScheme);
  const { colors: currentColors } = useThemeStore();
  const colors = forceScheme ? Colors[forceScheme] : currentColors;
  const accent = side === 'long' ? colors.actionBuy : colors.actionSell;

  // The rail publishes the mark under its pointer here on the UI thread, ahead
  // of the commit that reaches React when the finger lifts.
  const liveLeverage = useSharedValue(leverage);
  // Position size is linear in leverage and the legs' margins are not, so the
  // live figure is the committed one rescaled. Derived from `notionalUsd`
  // rather than the entered amount so it inherits whatever the risk hook did
  // with rounding and per-leg minimums.
  const marginBase = leverage > 0 ? risk.notionalUsd / leverage : 0;
  // Held as a shared value so the readout re-runs off the rail alone. A
  // TextInput is uncontrolled: a new `defaultValue` on re-render does not reach
  // the screen, so a keypad edit has to arrive through the worklet too.
  const marginBaseValue = useSharedValue(marginBase);
  useEffect(() => {
    marginBaseValue.value = marginBase;
  }, [marginBase, marginBaseValue]);
  const sizeProps = useAnimatedProps(() => {
    const text = `${formatUsdWorklet(marginBaseValue.value * liveLeverage.value)} position`;
    // `text` is a TextInput-only animated prop and isn't in its public props.
    return { text, defaultValue: text } as unknown as TextInputProps;
  });

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={[styles.badge, { color: accent, borderColor: withAlpha(accent, 0.4) }]}>
          {side === 'long' ? 'LONG' : 'SHORT'}
        </Text>
        <View style={styles.headerSpacer} />
        {/* Leverage is deliberately absent here: the ruler prints it directly
            below at 28pt, and the header repeating it meant the same number
            appeared twice in a panel fighting for every point. The size
            it drives is animated instead, so it tracks the rail during a drag
            rather than jumping when the finger lifts. */}
        <AnimatedTextInput
          editable={false}
          pointerEvents="none"
          defaultValue={`${formatUsd(risk.notionalUsd)} position`}
          animatedProps={sizeProps}
          style={styles.size}
        />
      </View>

      <LeverageRuler
        value={leverage}
        max={risk.selectableMaxLeverage}
        accent={accent}
        onChange={onChangeLeverage}
        height={80}
        slot={58}
        hideCaption
        forceScheme={forceScheme}
        liveValue={liveLeverage}
      />

      {/* The entry deposits collateral before it opens anything, and it funds
          margin *plus* fees. Showing the debit is the difference between a
          disabled button with a reason and a `phoenix_insufficient_cash` 422
          after the tap. Collateral already in Phoenix is spent first, so this
          can read below the margin — or $0. */}
      <Text style={styles.cashMoved} numberOfLines={1}>
        {risk.cashMovedUsd > 0
          ? `Moves ${formatUsdExact(risk.cashMovedUsd)} from cash`
          : 'Funded by your Phoenix collateral'}
        {risk.availableMarginUsd > 0 && risk.cashMovedUsd > 0
          ? ` · ${formatUsdExact(risk.availableMarginUsd)} already posted`
          : ''}
      </Text>

      {/* What the split actually does, sat directly under the leverage that
          drives it. The protective stop is still placed with the order — the
          backend requires one — it just isn't tuned from here. */}
      <View style={styles.legs}>
        {risk.legs.map((leg) => (
          <View key={leg.legId} style={styles.legRow}>
            <AssetLogo
              uri={leg.imageUrl}
              size={20}
              borderRadius={10}
              backgroundColor={colors.surfaceAlt}
              fallback={
                <View style={[styles.legLogo, styles.legLogoFallback]}>
                  <Text style={styles.legLogoInitial}>{leg.symbol.slice(0, 1)}</Text>
                </View>
              }
            />
            <Text style={styles.legSymbol} numberOfLines={1}>
              {leg.symbol}
            </Text>
            {/* Liquidation needs this leg's mark. While the first markets+prices
                round trip is still out the level is unknown, not undefined —
                a dash there reads as a leg that can't be liquidated. The whole
                readout goes at once so the row keeps a single gap. */}
            {leg.liquidationPrice === null && risk.loading ? (
              <ValueSkeletonLine
                lineHeight={16}
                width={104}
                accessibilityLabel={`Loading ${leg.symbol} margin and liquidation price`}
              />
            ) : (
              <Text style={styles.legDetail} numberOfLines={1}>
                {formatUsd(leg.marginUsd)} · liq {formatPrice(leg.liquidationPrice)}
              </Text>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    // `alignSelf: stretch` is load-bearing: the pad's amount slot centers its
    // children, so without it the panel shrink-wraps to its widest row and the
    // leg symbols truncate to "G…".
    card: { alignSelf: 'stretch', gap: 4, marginTop: 2 },

    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    headerSpacer: { flex: 1 },
    badge: {
      fontFamily: F,
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 0.6,
      borderWidth: 1,
      borderRadius: 6,
      paddingHorizontal: 6,
      paddingVertical: 2,
      overflow: 'hidden',
    },
    // A TextInput measures from its `defaultValue`, not from the text
    // Reanimated pushes into it, so the box is fixed and right-aligned rather
    // than left to shrink-wrap a stale string.
    size: {
      width: 160,
      height: 18,
      padding: 0,
      textAlign: 'right',
      fontFamily: F,
      fontSize: 13,
      fontWeight: '800',
      color: c.textSecondary,
      fontVariant: ['tabular-nums'],
      includeFontPadding: false,
    },

    cashMoved: {
      fontFamily: F,
      fontSize: 12,
      fontWeight: '700',
      color: c.textSecondary,
      fontVariant: ['tabular-nums'],
    },

    legs: { gap: 4 },
    legRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    legLogo: { width: 20, height: 20, borderRadius: 10, backgroundColor: c.surfaceAlt },
    legLogoFallback: { alignItems: 'center', justifyContent: 'center' },
    legLogoInitial: { fontFamily: F, fontSize: 10, fontWeight: '900', color: c.textSecondary },
    // Pushes the margin/liq readout to the right edge of the row.
    legSymbol: { flex: 1, fontFamily: F, fontSize: 13, fontWeight: '800', color: c.text },
    legDetail: {
      fontFamily: F,
      fontSize: 12,
      fontWeight: '600',
      color: c.textTertiary,
      fontVariant: ['tabular-nums'],
    },
  });
