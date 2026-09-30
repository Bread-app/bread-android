import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;

type Props = {
  /** Small uppercase kicker above the title. Ignored by the `quiet` variant. */
  eyebrow?: string;
  title: string;
  /** Renders a right-aligned "See all" affordance when provided. */
  onSeeAll?: () => void;
  seeAllLabel?: string;
  /** Optional control (e.g. a segmented picker) pinned to the right. */
  accessory?: React.ReactNode;
  /**
   * `display` is the original heavy title. `quiet` is the supporting-tier
   * header: one 13pt line, no eyebrow, and a "See all" in secondary rather
   * than blue — blue is reserved for the one primary action in a region.
   */
  variant?: 'display' | 'quiet';
};

/**
 * Shared section heading — title on the left, an optional accessory control or
 * "See all" link on the right.
 *
 * The two variants are the hierarchy: a screen gets at most one `display`
 * header, and everything in its supporting tier uses `quiet` so the sections
 * stop competing at the same weight.
 */
export function SectionHeader({
  eyebrow,
  title,
  onSeeAll,
  seeAllLabel = 'See all',
  accessory,
  variant = 'display',
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const quiet = variant === 'quiet';

  return (
    <View style={[styles.row, quiet && styles.rowQuiet]}>
      <View style={styles.copy}>
        {eyebrow && !quiet ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={[styles.title, quiet && styles.titleQuiet]} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {accessory ??
        (onSeeAll ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`${seeAllLabel} ${title}`}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 8 }}
            onPress={onSeeAll}
            style={styles.seeAll}
          >
            <Text style={[styles.seeAllText, quiet && styles.seeAllTextQuiet]}>
              {seeAllLabel}
            </Text>
          </PressableScale>
        ) : null)}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      marginBottom: 12,
    },
    rowQuiet: {
      // The quiet header is a 32pt line, not a band: its accessory carries its
      // own tap padding, so the row itself only needs the 12pt gap to content.
      minHeight: 32,
    },
    copy: {
      flexShrink: 1,
      minWidth: 0,
    },
    eyebrow: {
      marginBottom: 3,
      color: c.textSecondary,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: '600',
      fontFamily: F,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    title: {
      color: c.text,
      fontSize: 28,
      lineHeight: 32,
      fontWeight: '900',
      fontFamily: F,
      letterSpacing: -0.4,
    },
    titleQuiet: {
      fontSize: 13,
      lineHeight: 17,
      fontWeight: '700',
      letterSpacing: 0,
    },
    seeAll: {
      minHeight: 44,
      justifyContent: 'center',
    },
    seeAllText: {
      color: c.actionPrimary,
      fontSize: 14,
      lineHeight: 18,
      fontWeight: '700',
      fontFamily: F,
    },
    seeAllTextQuiet: {
      color: c.textSecondary,
      fontSize: 13,
      lineHeight: 17,
    },
  });
