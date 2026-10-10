import React, { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useThemeStore } from '@/lib/theme-store';

/**
 * The shape of what is about to load, standing in for it while it does.
 *
 * A spinner says only "wait"; a skeleton says "a list of people is coming" —
 * and when the rows land in the same footprint the screen reads as filling in,
 * not as one state being swapped for another. Use this wherever a list or card
 * of known shape is loading. Keep spinners for actions in flight (a button
 * that is submitting, a page appended at the bottom), where there is no
 * content shape to promise.
 *
 * The whole group pulses as one, with one animation — not a bar each.
 */
export type SkeletonVariant =
  /** Avatar · title + subtitle · value on the right (holders, trades, users, assets). */
  | 'row'
  /** A feed card: avatar + byline, two lines of copy, an action row. */
  | 'card'
  /** A comment: small avatar, name + time, two lines of body. */
  | 'comment'
  /** A two-up grid tile (the composer's asset picker). */
  | 'tile'
  /** A settings line: title + subtitle with a switch on the right. */
  | 'setting';

export function SkeletonRows({
  count = 4,
  variant = 'row',
  accessibilityLabel = 'Loading',
  style,
}: {
  count?: number;
  variant?: SkeletonVariant;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useThemeStore();
  const fill = { backgroundColor: colors.surfaceAlt };
  const pulse = useSkeletonPulse();

  const items = Array.from({ length: count }, (_, index) => {
    // Vary line lengths a little so the placeholder reads as text, not a grid.
    const long = index % 2 === 0 ? '72%' : '58%';
    const short = index % 2 === 0 ? '40%' : '48%';
    switch (variant) {
      case 'card':
        return (
          <View key={index} style={[styles.card, { borderBottomColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <View style={[styles.avatar, fill]} />
              <View style={[styles.line, fill, { width: 120, height: 13 }]} />
            </View>
            <View style={styles.cardBody}>
              <View style={[styles.line, fill, { width: '92%', height: 14 }]} />
              <View style={[styles.line, fill, { width: long, height: 14 }]} />
            </View>
            <View style={styles.cardActions}>
              <View style={[styles.dot, fill]} />
              <View style={[styles.dot, fill]} />
              <View style={[styles.dot, fill]} />
              <View style={styles.flex} />
              <View style={[styles.line, fill, { width: 56, height: 14 }]} />
            </View>
          </View>
        );
      case 'comment':
        return (
          <View key={index} style={styles.comment}>
            <View style={[styles.smallAvatar, fill]} />
            <View style={styles.copy}>
              <View style={[styles.line, fill, { width: 110, height: 12 }]} />
              <View style={[styles.line, fill, { width: '88%', height: 13 }]} />
              <View style={[styles.line, fill, { width: short, height: 13 }]} />
            </View>
          </View>
        );
      case 'tile':
        return (
          <View key={index} style={[styles.tile, { borderColor: colors.border }]}>
            <View style={[styles.avatar, fill]} />
            <View style={[styles.line, fill, { width: '62%', height: 14, marginTop: 14 }]} />
            <View style={[styles.line, fill, { width: '40%', height: 11, marginTop: 8 }]} />
          </View>
        );
      case 'setting':
        return (
          <View key={index} style={styles.setting}>
            <View style={styles.copy}>
              <View style={[styles.line, fill, { width: long, height: 15 }]} />
              <View style={[styles.line, fill, { width: '84%', height: 12 }]} />
            </View>
            <View style={[styles.switch, fill]} />
          </View>
        );
      default:
        return (
          <View key={index} style={[styles.row, { borderBottomColor: colors.border }]}>
            <View style={[styles.avatar, fill]} />
            <View style={styles.copy}>
              <View style={[styles.line, fill, { width: long, height: 15 }]} />
              <View style={[styles.line, fill, { width: short, height: 11 }]} />
            </View>
            <View style={[styles.line, fill, { width: 58, height: 15 }]} />
          </View>
        );
    }
  });

  return (
    <Animated.View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      style={[variant === 'tile' ? styles.grid : null, pulse, style]}
    >
      {items}
    </Animated.View>
  );
}

/** One slow breath shared by a whole skeleton group; still under Reduce Motion. */
function useSkeletonPulse() {
  const opacity = useSharedValue(0.6);
  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 780, easing: Easing.inOut(Easing.quad), reduceMotion: ReduceMotion.System }),
        withTiming(0.6, { duration: 780, easing: Easing.inOut(Easing.quad), reduceMotion: ReduceMotion.System }),
      ),
      -1,
      false,
      undefined,
      ReduceMotion.System,
    );
  }, [opacity]);
  return useAnimatedStyle(() => ({ opacity: opacity.value }));
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  smallAvatar: { width: 32, height: 32, borderRadius: 16 },
  copy: { flex: 1, gap: 7 },
  line: { borderRadius: 6 },
  card: { paddingVertical: 16, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardBody: { gap: 8, paddingLeft: 50 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 28, paddingLeft: 50 },
  dot: { width: 20, height: 20, borderRadius: 10 },
  comment: { flexDirection: 'row', gap: 10, paddingVertical: 12 },
  tile: {
    width: '48%',
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
  },
  setting: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 14 },
  switch: { width: 51, height: 31, borderRadius: 16 },
});
