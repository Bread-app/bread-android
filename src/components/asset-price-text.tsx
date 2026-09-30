import React from 'react';
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import { Fonts } from '@/constants/theme';

const TRACKING_EM = -0.04;

type AssetPriceTextProps = {
  label: string;
  size: number;
  lineHeight: number;
  style?: StyleProp<TextStyle>;
};

/** Tight, tabular asset price with uniformly sized digits. */
export function AssetPriceText({ label, size, lineHeight, style }: AssetPriceTextProps) {
  return (
    <Text
      accessibilityLabel={label}
      numberOfLines={1}
      style={[
        styles.price,
        style,
        { fontSize: size, lineHeight, letterSpacing: size * TRACKING_EM },
      ]}
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  price: {
    fontFamily: Fonts.rounded,
    fontVariant: ['tabular-nums'],
  },
});
