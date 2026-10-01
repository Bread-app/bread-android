import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { useThemeStore } from '@/lib/theme-store';

const THUMB_INSET = 2;

// iOS-feel spring: ~0.35s response, ~0.8 damping fraction (mass 1).
const THUMB_SPRING = { stiffness: 320, damping: 29, mass: 1 };

type Props<T extends string> = {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  height: number;
  /** Fixed width; omit to fill the parent. */
  width?: number;
  labelFor?: (option: T) => string;
  accessibilityLabel?: string;
};

/**
 * The iOS segmented `Picker`, redrawn for Android.
 *
 * iOS gets the real SwiftUI control (see `IosSegmentedControl` /
 * `AssetMarketToggle`); Android has no equivalent, and Material's segmented
 * button is a different design language. So this copies the iOS one: a
 * translucent capsule track, a raised white thumb that SLIDES to the selection
 * on a spring (not a fill that jumps), and single-line labels that never wrap.
 *
 * The thumb is positioned from the measured track width, so the control can sit
 * in a flexible row without fixed numbers.
 */
export function SegmentedPicker<T extends string>({
  options,
  value,
  onChange,
  height,
  width,
  labelFor = (option) => option,
  accessibilityLabel,
}: Props<T>) {
  const { scheme, colors } = useThemeStore();
  const isDark = scheme === 'dark';
  const [trackWidth, setTrackWidth] = useState(width ?? 0);

  const count = Math.max(options.length, 1);
  const selectedIndex = Math.max(0, options.indexOf(value));
  const segmentWidth = trackWidth > 0 ? (trackWidth - THUMB_INSET * 2) / count : 0;

  const offset = useSharedValue(selectedIndex * segmentWidth);
  const firstLayout = trackWidth === 0;

  useEffect(() => {
    const target = selectedIndex * segmentWidth;
    // Snap on the first measurement so the thumb doesn't fly in from 0.
    offset.value = firstLayout ? target : withSpring(target, THUMB_SPRING);
  }, [firstLayout, offset, segmentWidth, selectedIndex]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setTrackWidth((current) => (next > 0 && next !== current ? next : current));
  }, []);

  const radius = height / 2;
  const thumbHeight = height - THUMB_INSET * 2;

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      onLayout={width == null ? handleLayout : undefined}
      style={[
        styles.track,
        {
          height,
          width,
          borderRadius: radius,
          backgroundColor: isDark ? 'rgba(118,118,128,0.24)' : 'rgba(118,118,128,0.12)',
        },
      ]}>
      {segmentWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.thumb,
            {
              width: segmentWidth,
              height: thumbHeight,
              borderRadius: thumbHeight / 2,
              backgroundColor: isDark ? '#636366' : '#FFFFFF',
              boxShadow: isDark
                ? '0px 2px 6px rgba(0,0,0,0.35)'
                : '0px 2px 6px rgba(0,0,0,0.12), 0px 0px 0.5px rgba(0,0,0,0.10)',
            },
            thumbStyle,
          ]}
        />
      ) : null}
      {options.map((option) => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityLabel={labelFor(option)}
            accessibilityState={{ selected }}
            hitSlop={{ top: Math.max(0, (44 - height) / 2), bottom: Math.max(0, (44 - height) / 2) }}
            onPress={() => {
              if (selected) return;
              void Haptics.selectionAsync();
              onChange(option);
            }}
            style={styles.segment}>
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                { color: colors.text, opacity: selected ? 1 : 0.62 },
                selected && styles.labelSelected,
              ]}>
              {labelFor(option)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: THUMB_INSET,
  },
  thumb: {
    position: 'absolute',
    top: THUMB_INSET,
    left: THUMB_INSET,
  },
  segment: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  labelSelected: {
    fontWeight: '700',
  },
});
