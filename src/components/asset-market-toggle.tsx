import React from 'react';
import { Host, Picker } from '@expo/ui/swift-ui';
import { frame } from '@expo/ui/swift-ui/modifiers';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

export type AssetMarketMode = 'spot' | 'perp';

type Props = {
  value: AssetMarketMode;
  onChange: (value: AssetMarketMode) => void;
};

const MARKET_OPTIONS = ['Spot', 'Perp'];
const NATIVE_TOGGLE_WIDTH = 128;
/** Both platforms draw the same 48pt row, so a host can align chrome to it. */
export const ASSET_MARKET_TOGGLE_HEIGHT = 48;
const NATIVE_TOGGLE_HEIGHT = ASSET_MARKET_TOGGLE_HEIGHT;

/** Callers that align the toggle with another chrome control need its box. */
export const ASSET_MARKET_TOGGLE_WIDTH = NATIVE_TOGGLE_WIDTH;

/** Compact venue switch shown only when the same underlying trades both ways. */
export function AssetMarketToggle({ value, onChange }: Props) {
  const styles = useThemedStyles(makeStyles);

  if (Platform.OS === 'ios') {
    return (
      <Host style={styles.nativeHost}>
        <Picker
          options={MARKET_OPTIONS}
          selectedIndex={value === 'spot' ? 0 : 1}
          variant="segmented"
          modifiers={[
            frame({ width: NATIVE_TOGGLE_WIDTH, height: NATIVE_TOGGLE_HEIGHT }),
          ]}
          onOptionSelected={({ nativeEvent }) => {
            onChange(nativeEvent.index === 0 ? 'spot' : 'perp');
          }}
        />
      </Host>
    );
  }

  return (
    <View style={styles.container} accessibilityLabel="Market type">
      {(['spot', 'perp'] as const).map((option) => {
        const selected = value === option;
        return (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityLabel={`Show ${option} market`}
            accessibilityState={{ selected }}
            onPress={() => onChange(option)}
            style={({ pressed }) => [
              styles.option,
              selected && styles.optionSelected,
              pressed && !selected && styles.optionPressed,
            ]}
          >
            <Text style={[styles.label, selected && styles.labelSelected]}>
              {option === 'spot' ? 'Spot' : 'Perp'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    nativeHost: {
      width: NATIVE_TOGGLE_WIDTH,
      height: NATIVE_TOGGLE_HEIGHT,
    },
    container: {
      height: ASSET_MARKET_TOGGLE_HEIGHT,
      padding: 2,
      borderRadius: 24,
      backgroundColor: c.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      flexDirection: 'row',
      alignItems: 'center',
    },
    option: {
      minWidth: 62,
      height: 44,
      paddingHorizontal: 12,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    optionSelected: { backgroundColor: c.text },
    optionPressed: { backgroundColor: c.surface },
    label: {
      color: c.textTertiary,
      fontSize: 13,
      fontWeight: '800',
      fontFamily: Fonts.rounded,
    },
    labelSelected: { color: c.textInverse },
  });
