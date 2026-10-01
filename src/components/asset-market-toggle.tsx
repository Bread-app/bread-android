import React from 'react';
import { Host, Picker } from '@expo/ui/swift-ui';
import { frame } from '@expo/ui/swift-ui/modifiers';
import { Platform, StyleSheet } from 'react-native';

import { SegmentedPicker } from '@/components/segmented-picker';
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
    <SegmentedPicker
      options={['spot', 'perp'] as const}
      value={value}
      onChange={onChange}
      height={ASSET_MARKET_TOGGLE_HEIGHT}
      width={NATIVE_TOGGLE_WIDTH}
      labelFor={(option) => (option === 'spot' ? 'Spot' : 'Perp')}
      accessibilityLabel="Market type"
    />
  );
}

const makeStyles = () =>
  StyleSheet.create({
    nativeHost: {
      width: NATIVE_TOGGLE_WIDTH,
      height: NATIVE_TOGGLE_HEIGHT,
    },
  });
