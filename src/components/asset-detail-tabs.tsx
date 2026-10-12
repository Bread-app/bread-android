import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

import { Fonts } from '@/constants/theme';
import { useThemeStore } from '@/lib/theme-store';

export type AssetDetailTab = 'sandwiches' | 'holders' | 'about';

const TABS: { key: AssetDetailTab; label: string }[] = [
  { key: 'sandwiches', label: 'Sandwiches' },
  { key: 'holders', label: 'Holders' },
  { key: 'about', label: 'About' },
];

const SLIDE = { damping: 22, stiffness: 260, mass: 0.7 } as const;

/**
 * Sandwiches · Holders · About, for an asset — one bar for spot and perp alike.
 * Centred on the screen, sitting on a hairline rail; the active tab is marked
 * by an underline that slides to it, and labels cross-fade their colour rather
 * than changing size, so nothing reflows mid-switch.
 */
export function AssetDetailTabs({
  active,
  onChange,
  holderCount,
}: {
  active: AssetDetailTab;
  onChange: (tab: AssetDetailTab) => void;
  /** Rides on the Holders label; hidden while unknown or zero. */
  holderCount?: number | null;
}) {
  const { colors } = useThemeStore();
  const [frames, setFrames] = useState<Partial<Record<AssetDetailTab, { x: number; width: number }>>>({});
  const index = TABS.findIndex((t) => t.key === active);
  const position = useSharedValue(index);
  const left = useSharedValue(0);
  const width = useSharedValue(0);
  const placed = useSharedValue(0);

  useEffect(() => {
    const frame = frames[active];
    if (!frame) return;
    if (placed.value === 0) {
      // First layout: land on the tab, no slide in from nowhere.
      left.value = frame.x;
      width.value = frame.width;
      position.value = index;
      placed.value = 1;
      return;
    }
    left.value = withSpring(frame.x, SLIDE);
    width.value = withSpring(frame.width, SLIDE);
    position.value = withSpring(index, SLIDE);
  }, [active, frames, index, left, placed, position, width]);

  const onTabLayout = useCallback((key: AssetDetailTab) => (e: LayoutChangeEvent) => {
    const { x, width: w } = e.nativeEvent.layout;
    setFrames((prev) => (prev[key]?.x === x && prev[key]?.width === w ? prev : { ...prev, [key]: { x, width: w } }));
  }, []);

  const underline = useAnimatedStyle(() => ({
    opacity: placed.value,
    width: width.value,
    transform: [{ translateX: left.value }],
  }));

  return (
    <View style={[styles.rail, { borderBottomColor: colors.border }]}>
      <View style={styles.row}>
        {TABS.map((tab, i) => {
          const badge = tab.key === 'holders' && holderCount ? holderCount : null;
          const label = `${tab.label}${badge ? ` (${badge > 99 ? '99+' : badge})` : ''}`;
          return (
            <Pressable
              key={tab.key}
              onLayout={onTabLayout(tab.key)}
              onPress={() => {
                if (tab.key === active) return;
                void Haptics.selectionAsync();
                onChange(tab.key);
              }}
              hitSlop={{ top: 6, bottom: 6, left: 12, right: 12 }}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab.key === active }}
              accessibilityLabel={label}
              style={styles.tab}
            >
              <TabLabel i={i} position={position} label={label} on={colors.text} off={colors.textQuaternary} />
            </Pressable>
          );
        })}
        <Animated.View pointerEvents="none" style={[styles.underline, { backgroundColor: colors.text }, underline]} />
      </View>
    </View>
  );
}

function TabLabel({
  i,
  position,
  label,
  on,
  off,
}: {
  i: number;
  position: SharedValue<number>;
  label: string;
  on: string;
  off: string;
}) {
  const near = useDerivedValue(() => Math.max(0, 1 - Math.abs(position.value - i)));
  const style = useAnimatedStyle(() => ({ color: interpolateColor(near.value, [0, 1], [off, on]) }));
  return <Animated.Text style={[styles.label, style]}>{label}</Animated.Text>;
}

const styles = StyleSheet.create({
  rail: { paddingTop: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 30 },
  tab: { minHeight: 40, justifyContent: 'center', paddingBottom: 10 },
  label: { fontFamily: Fonts.rounded, fontSize: 19, fontWeight: '900' },
  underline: { position: 'absolute', left: 0, bottom: -StyleSheet.hairlineWidth, height: 3, borderRadius: 1.5 },
});
