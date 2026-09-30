import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

const F = Fonts.rounded;

export type HoldingsCategoryKey = 'sandwiches' | 'perps' | 'tokens';
export type HoldingsCategoryFilter = 'all' | HoldingsCategoryKey;

export const HOLDINGS_CATEGORIES: readonly HoldingsCategoryFilter[] = [
  'all',
  'sandwiches',
  'tokens',
  'perps',
];

export const HOLDINGS_CATEGORY_LABELS: Record<HoldingsCategoryFilter, string> = {
  all: 'All',
  sandwiches: 'Sandwiches',
  tokens: 'Tokens',
  perps: 'Perps',
};

/**
 * The All / Sandwiches / Tokens / Perps chips under the Holdings tab. Shared by
 * the own profile and the other-user profile so a portfolio filters the same
 * way whoever's it is.
 */
export function HoldingsCategorySwitch({
  value,
  onChange,
}: {
  value: HoldingsCategoryFilter;
  onChange: (category: HoldingsCategoryFilter) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.switch} accessibilityLabel="Holding type">
      {HOLDINGS_CATEGORIES.map((category) => {
        const selected = category === value;
        return (
          <Pressable
            key={category}
            accessibilityRole="button"
            accessibilityLabel={`Show ${HOLDINGS_CATEGORY_LABELS[category]}`}
            accessibilityState={{ selected }}
            hitSlop={{ top: 3, bottom: 3, left: 0, right: 0 }}
            onPress={() => {
              if (!selected) onChange(category);
            }}
            style={({ pressed }) => [
              styles.button,
              selected && styles.buttonActive,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={[styles.buttonText, selected && styles.buttonTextActive]}>
              {HOLDINGS_CATEGORY_LABELS[category]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    switch: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 40,
      gap: 6,
      marginTop: 6,
    },
    button: {
      height: 34,
      paddingHorizontal: 11,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    buttonActive: {
      backgroundColor: c.surfaceAlt,
    },
    buttonPressed: {
      transform: [{ scale: 0.96 }],
    },
    buttonText: {
      color: c.textSecondary,
      fontSize: 12,
      fontWeight: '800',
      fontFamily: F,
    },
    buttonTextActive: {
      color: c.text,
    },
  });
