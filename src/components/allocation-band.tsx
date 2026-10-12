import * as Haptics from 'expo-haptics';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

import { AssetLogo } from '@/components/asset-logo';
import { Fonts } from '@/constants/theme';
import { useThemeStore } from '@/lib/theme-store';

/** One colour per leg, in order; the rows below reuse it as their key. */
export const ALLOCATION_COLORS = ['#38BDF8', '#35F046', '#A78BFA', '#FBBF24', '#F472B6', '#2DD4BF', '#FB923C', '#818CF8'];
export const allocationColor = (index: number) => ALLOCATION_COLORS[index % ALLOCATION_COLORS.length];

const HEIGHT = 56;
const GAP = 3;
/** No leg can be dragged below this; removing a leg is the row's ✕. */
const MIN = 0.01;
const SETTLE = { damping: 20, stiffness: 240, mass: 0.6 } as const;

type BandLeg = { id: string; symbol: string; imageUrl?: string | null };

/**
 * The basket's allocation as one horizontal band: a segment per leg, sized by
 * its share. Drag the seam between two segments and those two trade weight —
 * everything else stays put, so the band always adds up to 100%, for two legs
 * or ten. Moves in 1% steps with a tick every 5%.
 *
 * `ratios` (0–1, summing to 1) is shared with the host and updated on the UI
 * thread; `onLive` gets each new whole-percent split, `onCommit` the final one.
 */
export function AllocationBand({
  legs,
  ratios,
  onLive,
  onCommit,
}: {
  legs: readonly BandLeg[];
  ratios: SharedValue<number[]>;
  onLive: (ratios: number[]) => void;
  onCommit: (ratios: number[]) => void;
}) {
  const { colors } = useThemeStore();
  const [width, setWidth] = useState(0);
  const lastKey = useSharedValue('');

  // Hop to JS only when a whole percent changes: labels and rows read that.
  useAnimatedReaction(
    () => {
      // A plain loop: an inline arrow passed to .map is not a worklet.
      let key = '';
      const r = ratios.value;
      for (let i = 0; i < r.length; i += 1) key += `${Math.round(r[i] * 100)},`;
      return key;
    },
    (key, prev) => {
      if (key === prev || key === lastKey.value) return;
      lastKey.value = key;
      runOnJS(onLive)(ratios.value.slice());
    },
  );

  return (
    <View
      style={[styles.band, { backgroundColor: colors.surfaceAlt }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {width > 0
        ? legs.map((leg, i) => <Segment key={leg.id} leg={leg} index={i} ratios={ratios} width={width} />)
        : null}
      {width > 0
        ? legs.slice(0, -1).map((leg, i) => (
            <Seam key={`seam-${leg.id}`} index={i} ratios={ratios} width={width} onCommit={onCommit} />
          ))
        : null}
    </View>
  );
}

function Segment({ leg, index, ratios, width }: { leg: BandLeg; index: number; ratios: SharedValue<number[]>; width: number }) {
  const style = useAnimatedStyle(() => {
    const r = ratios.value;
    let left = 0;
    for (let i = 0; i < index; i += 1) left += r[i] ?? 0;
    const w = (r[index] ?? 0) * width;
    return { left: left * width + (index ? GAP / 2 : 0), width: Math.max(0, w - (index ? GAP / 2 : 0) - (index < r.length - 1 ? GAP / 2 : 0)) };
  });
  // Logo and figure only when the segment has room for them.
  const roomy = useAnimatedStyle(() => ({ opacity: (ratios.value[index] ?? 0) * width >= 64 ? 1 : 0 }));
  const tight = useAnimatedStyle(() => ({ opacity: (ratios.value[index] ?? 0) * width >= 30 ? 1 : 0 }));
  const [pct, setPct] = useState(() => Math.round((ratios.value[index] ?? 0) * 100));
  useAnimatedReaction(
    () => Math.round((ratios.value[index] ?? 0) * 100),
    (next, prev) => {
      if (next !== prev) runOnJS(setPct)(next);
    },
  );
  return (
    <Animated.View style={[styles.segment, { backgroundColor: allocationColor(index) }, style]}>
      <Animated.View style={[styles.segmentInner, tight]}>
        <Animated.View style={roomy}>
          <AssetLogo uri={leg.imageUrl ?? null} size={22} borderRadius={11} backgroundColor="rgba(255,255,255,0.6)" fallback={<View />} />
        </Animated.View>
        <Text style={styles.segmentPct} numberOfLines={1}>{pct}%</Text>
      </Animated.View>
    </Animated.View>
  );
}

/** The draggable boundary between leg `index` and `index + 1`. */
function Seam({ index, ratios, width, onCommit }: { index: number; ratios: SharedValue<number[]>; width: number; onCommit: (ratios: number[]) => void }) {
  const start = useSharedValue<number[]>([]);
  const lastStep = useSharedValue(-1);
  const active = useSharedValue(0);

  const tick = (big: boolean) => {
    void (big ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light) : Haptics.selectionAsync());
  };

  const pan = Gesture.Pan()
    .hitSlop({ left: 18, right: 18, top: 10, bottom: 10 })
    .activeOffsetX([-2, 2])
    .onStart(() => {
      start.value = ratios.value.slice();
      lastStep.value = Math.round((ratios.value[index] ?? 0) * 100);
      active.value = withSpring(1, SETTLE);
    })
    .onUpdate((e) => {
      const base = start.value;
      const pair = (base[index] ?? 0) + (base[index + 1] ?? 0);
      if (pair <= MIN * 2) return;
      const raw = (base[index] ?? 0) + e.translationX / width;
      // Whole percent steps, so the seam clicks into place under the finger.
      const a = Math.min(pair - MIN, Math.max(MIN, Math.round(raw * 100) / 100));
      const next = base.slice();
      next[index] = a;
      next[index + 1] = Math.round((pair - a) * 100) / 100;
      ratios.value = next;
      const step = Math.round(a * 100);
      if (step !== lastStep.value) {
        lastStep.value = step;
        runOnJS(tick)(step % 5 === 0);
      }
    })
    .onFinalize(() => {
      active.value = withSpring(0, SETTLE);
      runOnJS(onCommit)(ratios.value.slice());
    });

  const style = useAnimatedStyle(() => {
    let left = 0;
    for (let i = 0; i <= index; i += 1) left += ratios.value[i] ?? 0;
    return {
      left: left * width - 14,
      transform: [{ scale: 1 + active.value * 0.12 }],
    };
  });
  const knob = useAnimatedStyle(() => ({ height: 26 + active.value * 12 }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.seam, style]} accessibilityRole="adjustable" accessibilityLabel="Drag to rebalance">
        <Animated.View style={[styles.knob, knob]} />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  band: { height: HEIGHT, borderRadius: 16, overflow: 'visible', marginBottom: 12 },
  segment: { position: 'absolute', top: 0, bottom: 0, borderRadius: 14, overflow: 'hidden', justifyContent: 'center' },
  segmentInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  segmentPct: { fontFamily: Fonts.rounded, fontSize: 15, fontWeight: '900', color: '#0B1622' },
  seam: { position: 'absolute', top: 0, bottom: 0, width: 28, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  knob: {
    width: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
});
