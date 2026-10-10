import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect } from 'react';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

const SPRING = { damping: 18, stiffness: 260, mass: 0.7, reduceMotion: ReduceMotion.System };

/**
 * An expand/collapse chevron that turns instead of swapping glyphs. It is
 * always the `chevron-down` glyph, rotated half a turn when it should point up,
 * so a toggle reads as the same arrow flipping over. The first render is placed,
 * not animated.
 */
export function RotatingChevron({
  up,
  size,
  color,
}: {
  /** True when the arrow should point up. */
  up: boolean;
  size: number;
  color: string;
}) {
  const turn = useSharedValue(up ? 1 : 0);

  useEffect(() => {
    turn.value = withSpring(up ? 1 : 0, SPRING);
  }, [turn, up]);

  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.value * 180}deg` }],
  }));

  return (
    <Animated.View style={style}>
      <Ionicons name="chevron-down" size={size} color={color} />
    </Animated.View>
  );
}
