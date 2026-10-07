import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ValueSkeleton } from '@/components/value-skeleton';
import { Fonts, Radius, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { BoardTone, HeaderPalette } from './header-palette';
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;
/** The P&L sits on the plain system face so it reads as a stat, not a headline. */
const SANS = Fonts.sans;
/**
 * Separation for the figures against the board, in place of the phosphor glow
 * they used to carry.
 *
 * The glow was a bleed in each figure's OWN colour — the thing that read as lit
 * phosphor on a near-black board. On the sky-blue one it has nothing to glow
 * against: white on light blue just smears, and the P&L washes toward the
 * ground. A soft dark drop does the separating instead, heavier under the
 * balance because it carries more weight.
 */
const VALUE_SHADOW = 'rgba(0, 0, 0, 0.20)';
const PNL_SHADOW = 'rgba(0, 0, 0, 0.22)';

type Props = {
  /** True once both the balance read and the history read can be trusted. */
  ready: boolean;
  valueLabel: string;
  changeUsd: number | null;
  positive: boolean;
  loadingValue: boolean;
  /** Rendered opposite the balance, on the same line. */
  action?: React.ReactNode;
  showError: boolean;
  onRetry: () => void;
};

/**
 * The portfolio hero: balance and its 7-day P&L, on the header board.
 *
 * Presentational only — every value is passed in. Colours come from
 * `HeaderPalette` and `BoardTone` rather than the theme tokens, because this
 * block never sits on the page background.
 */
export function PortfolioHero({
  ready,
  valueLabel,
  changeUsd,
  positive,
  loadingValue,
  action,
  showError,
  onRetry,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const changeLabel = changeUsd === null
    ? null
    : `${changeUsd >= 0 ? '+' : '-'}${new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Math.abs(changeUsd))}`;

  const changeTone = positive ? BoardTone.up : BoardTone.down;

  return (
    <View style={styles.section}>
      {/* The balance and the action share ONE line, centred on each other, so
          the figure sits level with the button rather than floating above its
          midpoint. The balance is the single flexible block, so the column it
          gets is the row minus the button's fixed width — a long balance
          shrinks its own type rather than pushing the native button off the
          right edge. The P&L sits on its own line beneath. */}
      <View style={styles.valueRow}>
        {ready ? (
          <Text
            // Nothing on screen names this number, so the label has to carry
            // the context for screen readers.
            accessibilityLabel={`Portfolio value ${valueLabel}`}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            numberOfLines={1}
            style={styles.value}
          >
            {valueLabel}
          </Text>
        ) : loadingValue ? (
          <View style={styles.valueBlock}>
            <ValueSkeleton
              width={140}
              height={34}
              radius={Radius.md}
              color={HeaderPalette.skeleton}
              accessibilityLabel="Loading portfolio value"
            />
          </View>
        ) : (
          <Text style={styles.value}>—</Text>
        )}
        {action}
      </View>

      {ready && changeLabel !== null ? (
        <Text
          accessibilityLabel={`Your portfolio P and L ${changeLabel}`}
          adjustsFontSizeToFit
          minimumFontScale={0.74}
          numberOfLines={1}
          style={[
            styles.change,
            // The board tones the ticker uses, so "down" is the same pink in
            // both — they sit inches apart.
            { color: changeTone },
          ]}
        >
          {changeLabel}
        </Text>
      ) : (
        <ValueSkeleton
          width={84}
          height={16}
          radius={8}
          color={HeaderPalette.skeleton}
          style={styles.changeSkeleton}
          accessibilityLabel="Loading portfolio P and L"
        />
      )}

      {showError ? (
        <View style={styles.errorRow}>
          <Text style={styles.errorText}>Couldn&apos;t refresh your portfolio.</Text>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Retry portfolio"
            onPress={onRetry}
            style={styles.retryButton}
          >
            <Text style={styles.retryText}>Try again</Text>
          </PressableScale>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (_c: ThemeColors) =>
  StyleSheet.create({
    section: {},
    valueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
    },
    valueBlock: {
      flex: 1,
      minWidth: 0,
    },
    value: {
      flex: 1,
      minWidth: 0,
      color: HeaderPalette.value,
      fontSize: 30,
      lineHeight: 36,
      fontWeight: '900',
      fontFamily: F,
      fontVariant: ['tabular-nums'],
      letterSpacing: -0.8,
      textShadowColor: VALUE_SHADOW,
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 4,
    },

    change: {
      marginTop: 2,
      fontSize: 16,
      lineHeight: 21,
      fontWeight: '800',
      fontFamily: SANS,
      fontVariant: ['tabular-nums'],
      letterSpacing: -0.2,
      // A dark drop, not a glow: it keeps the tone itself pure so the green and
      // the pink read as our own, and still separates them from the board.
      textShadowColor: PNL_SHADOW,
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 3,
    },
    changeSkeleton: {
      marginTop: 8,
    },
    errorRow: {
      marginTop: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    errorText: {
      color: HeaderPalette.muted,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '500',
      fontFamily: F,
    },
    retryButton: {
      minHeight: 40,
      borderRadius: Radius.lg,
      paddingHorizontal: 14,
      backgroundColor: HeaderPalette.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    retryText: {
      color: '#FFFFFF',
      fontSize: 12,
      fontWeight: '800',
      fontFamily: F,
    },
  });
