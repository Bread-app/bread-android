import * as Haptics from 'expo-haptics';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;

export type FilterSegment<T extends string> = {
  key: T;
  label: string;
};

type Props<T extends string> = {
  segments: FilterSegment<T>[];
  value: T;
  onChange: (key: T) => void;
  accessibilityLabel: string;
};

/**
 * Text-only filter segments that live ON a section header line rather than in a
 * pill row of their own. A pill row reads as a second navigation bar and pushes
 * the content it filters a whole band down the page; inline text keeps the
 * filter subordinate to the section it belongs to, and a new segment drops in
 * with zero re-layout.
 *
 * Selection is carried by the accent underline plus the text colour step, so it
 * survives both themes without a filled background competing with the cards.
 */
export function FilterSegments<T extends string>({
  segments,
  value,
  onChange,
  accessibilityLabel,
}: Props<T>) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View accessibilityLabel={accessibilityLabel} style={styles.row}>
      {segments.map((segment) => {
        const active = segment.key === value;
        return (
          <PressableScale
            key={segment.key}
            accessibilityRole="button"
            accessibilityLabel={segment.label}
            accessibilityState={{ selected: active }}
            hitSlop={{ top: 12, bottom: 12, left: 4, right: 4 }}
            onPress={() => {
              if (active) return;
              void Haptics.selectionAsync();
              onChange(segment.key);
            }}
            style={styles.segment}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{segment.label}</Text>
            <View style={[styles.underline, active && styles.underlineActive]} />
          </PressableScale>
        );
      })}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
    },
    segment: {
      // Tap height comes from padding so the visible text stays on the header
      // line instead of inflating it.
      paddingVertical: 12,
      alignItems: 'center',
      gap: 3,
    },
    label: {
      color: c.textTertiary,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '700',
      fontFamily: F,
    },
    labelActive: {
      color: c.text,
    },
    underline: {
      height: 2,
      alignSelf: 'stretch',
      borderRadius: 1,
      backgroundColor: 'transparent',
    },
    underlineActive: {
      backgroundColor: c.accent,
    },
  });
