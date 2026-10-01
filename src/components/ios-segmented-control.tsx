import React, { useCallback, useState } from 'react';
import { Host, Picker } from '@expo/ui/swift-ui';
import { frame } from '@expo/ui/swift-ui/modifiers';
import { LayoutChangeEvent, Platform, StyleSheet, View } from 'react-native';

import { SegmentedPicker } from '@/components/segmented-picker';
import { useThemedStyles } from '@/hooks/use-themed-styles';

/**
 * Generic segmented switch, built on the same primitive as `AssetMarketToggle`
 * (the Spot / Perp switch) so the two read as one control used twice.
 *
 * On iOS this is a real SwiftUI segmented `Picker` — not a reimplementation of
 * one. That distinction matters more than it sounds: a hand-rolled track and
 * thumb can land within a couple of points of UIKit and still feel wrong,
 * because what it misses is the press states, the thumb's drag behaviour,
 * Dynamic Type and the system animation curve. Android draws the iOS look by
 * hand with `SegmentedPicker` (sliding thumb, single-line labels).
 *
 * The width is MEASURED rather than fixed. SwiftUI's `frame` needs a number,
 * but this control sits at the trailing edge of a row whose leading content
 * ("Holdings (12)" at 20pt/900) grows with the user's holdings — so a constant
 * that fits a 430pt screen overflows a 375pt one and wraps the tab labels.
 */

const DEFAULT_WIDTH = 124;
const CONTROL_HEIGHT = 34;

type Props<T extends string> = {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  accessibilityLabel?: string;
};

export function IosSegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: Props<T>) {
  const styles = useThemedStyles(makeStyles);
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  const selectedIndex = Math.max(0, options.indexOf(value));

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    // Guarded: feeding every layout pass back into `frame` would re-lay-out the
    // host, which re-fires layout.
    setWidth((current) => (next > 0 && Math.abs(current - next) > 1 ? next : current));
  }, []);

  if (Platform.OS === 'ios') {
    return (
      <View style={styles.hostWrap} onLayout={handleLayout}>
        <Host style={{ width, height: CONTROL_HEIGHT }}>
          <Picker
            options={options as unknown as string[]}
            selectedIndex={selectedIndex}
            variant="segmented"
            modifiers={[frame({ width, height: CONTROL_HEIGHT })]}
            onOptionSelected={({ nativeEvent }) => {
              const next = options[nativeEvent.index];
              if (next !== undefined && next !== value) onChange(next);
            }}
          />
        </Host>
      </View>
    );
  }

  return (
    <SegmentedPicker
      options={options}
      value={value}
      onChange={onChange}
      height={CONTROL_HEIGHT}
      // Its row sizes to content, so a flexible track would collapse here.
      width={DEFAULT_WIDTH}
      accessibilityLabel={accessibilityLabel}
    />
  );
}

const makeStyles = () =>
  StyleSheet.create({
    hostWrap: {
      height: CONTROL_HEIGHT,
    },
  });
