import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ValueSkeleton } from '@/components/value-skeleton';
import { Fonts, Radius, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { useThemeStore } from '@/lib/theme-store';

import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;
/** The P&L sits on the plain system face so it reads as a stat, not a headline. */
const SANS = Fonts.sans;
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
 * The portfolio hero: balance and its 7-day P&L on the themed page ground.
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
  const { colors } = useThemeStore();
  const changeLabel = changeUsd === null
    ? null
    : `${changeUsd >= 0 ? '+' : '-'}${new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Math.abs(changeUsd))}`;

  const changeTone = positive ? colors.positive : colors.negative;

  return (
    <View style={styles.section}>
      {/* The balance and P&L stack on the left; the action sits at the bottom
          right. The balance column is the single flexible block, so a long
          balance shrinks its own type rather than pushing the native button
          off the right edge. */}
      <View style={styles.valueRow}>
        <View style={styles.valueColumn}>
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
                color={colors.surfaceAlt}
                accessibilityLabel="Loading portfolio value"
              />
            </View>
          ) : (
            <Text style={styles.value}>—</Text>
          )}

          {ready && changeLabel !== null ? (
            <Text
              accessibilityLabel={`Your portfolio P and L ${changeLabel}`}
              adjustsFontSizeToFit
              minimumFontScale={0.74}
              numberOfLines={1}
              style={[
                styles.change,
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
              color={colors.surfaceAlt}
              style={styles.changeSkeleton}
              accessibilityLabel="Loading portfolio P and L"
            />
          )}
        </View>
        {/* Centred on the balance + P&L block (so lower than the balance line
            alone), and right-aligned to the same 24pt gutter as the feed. */}
        {action}
      </View>

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

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    section: {},
    valueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
    },
    valueColumn: {
      flex: 1,
      minWidth: 0,
    },
    valueBlock: {
      minWidth: 0,
    },
    value: {
      minWidth: 0,
      color: c.text,
      fontSize: 30,
      lineHeight: 36,
      fontWeight: '900',
      fontFamily: F,
      fontVariant: ['tabular-nums'],
      letterSpacing: -0.8,
    },

    change: {
      marginTop: 2,
      fontSize: 16,
      lineHeight: 21,
      fontWeight: '800',
      fontFamily: SANS,
      fontVariant: ['tabular-nums'],
      letterSpacing: -0.2,
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
      color: c.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '500',
      fontFamily: F,
    },
    retryButton: {
      minHeight: 40,
      borderRadius: Radius.lg,
      paddingHorizontal: 14,
      backgroundColor: c.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    retryText: {
      color: c.text,
      fontSize: 12,
      fontWeight: '800',
      fontFamily: F,
    },
  });
