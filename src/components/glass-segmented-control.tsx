import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import React, { useCallback } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, Radius, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { useThemeStore } from '@/lib/theme-store';

const F = Fonts.rounded;

// House pattern (see stock-trade-actions.tsx / trade-amount-sheet.tsx): resolve
// glass availability once at module scope and always ship a solid fallback.
const HAS_GLASS = Platform.OS === 'ios' && isGlassEffectAPIAvailable();

const TRACK_HEIGHT = 34;

type Props<T extends string> = {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  accessibilityLabel?: string;
};

/**
 * Compact segmented picker rendered as an iOS 26 Liquid Glass capsule.
 *
 * Two structural rules are load-bearing and both are learned-the-hard-way
 * conventions from the existing glass call sites:
 *  1. The shell `View` owns sizing + rounding (`overflow: 'hidden'`), never the
 *     `GlassView` — the glass just paints the fill inside it.
 *  2. `GlassView` is a native view and will not auto-size to its children, so
 *     the track has an explicit height. Without it the control collapses to 0.
 *
 * The selected segment is a solid `surfaceSelected` pill rather than more
 * glass: glass-on-glass muddies into an indistinct blur. Visual height stays
 * compact while each segment keeps a 44pt touch target via `hitSlop`.
 */
export function GlassSegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: Props<T>) {
  const styles = useThemedStyles(makeStyles);
  const { scheme } = useThemeStore();

  const handlePress = useCallback(
    (next: T) => {
      if (next === value) return;
      void Haptics.selectionAsync();
      onChange(next);
    },
    [onChange, value],
  );

  const segments = options.map((option) => {
    const selected = option === value;
    return (
      <Pressable
        key={option}
        accessibilityRole="button"
        accessibilityLabel={option}
        accessibilityState={{ selected }}
        hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
        onPress={() => handlePress(option)}
        style={[styles.segment, selected && styles.segmentSelected]}
      >
        <Text style={[styles.label, selected && styles.labelSelected]}>{option}</Text>
      </Pressable>
    );
  });

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={styles.shell}
    >
      {HAS_GLASS ? (
        <GlassView
          // "regular", not "clear": over a light background `clear` has almost
          // no presence and the track reads as three loose labels rather than a
          // capsule.
          glassEffectStyle="regular"
          isInteractive
          // The app's light/dark toggle is independent of the OS appearance
          // (see lib/theme-store), so the scheme has to be passed explicitly.
          colorScheme={scheme === 'dark' ? 'dark' : 'light'}
          style={styles.track}
        >
          {segments}
        </GlassView>
      ) : (
        <View style={[styles.track, styles.trackSolid]}>{segments}</View>
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    shell: {
      height: TRACK_HEIGHT,
      borderRadius: Radius.md,
      overflow: 'hidden',
      alignSelf: 'flex-start',
    },
    track: {
      height: TRACK_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 3,
      gap: 2,
    },
    trackSolid: {
      backgroundColor: c.surfaceAlt,
    },
    segment: {
      minWidth: 44,
      height: TRACK_HEIGHT - 6,
      paddingHorizontal: 10,
      borderRadius: Radius.md - 4,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmentSelected: {
      backgroundColor: c.surfaceSelected,
    },
    label: {
      color: c.iconMuted,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: '800',
      fontFamily: F,
    },
    labelSelected: {
      color: c.text,
    },
  });
