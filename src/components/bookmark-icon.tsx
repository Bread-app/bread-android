import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useRef } from 'react';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

const SPRING = { damping: 11, stiffness: 320, mass: 0.6, reduceMotion: ReduceMotion.System };

/**
 * The bookmark glyph, confirming its own state change so no toast has to.
 *
 * Saving drops the filled ribbon in from above with a small overshoot — it
 * reads as being pinned to the card. Removing gives a short shrink-and-settle.
 * The first render (and every re-render that doesn't change `saved`) is still.
 */
export function BookmarkIcon({
  saved,
  size,
  color,
}: {
  saved: boolean;
  size: number;
  color: string;
}) {
  const scale = useSharedValue(1);
  const lift = useSharedValue(0);
  const previous = useRef(saved);

  useEffect(() => {
    if (previous.current === saved) return;
    previous.current = saved;
    if (saved) {
      lift.value = withSequence(
        withTiming(-size * 0.28, { duration: 0, reduceMotion: ReduceMotion.System }),
        withSpring(0, SPRING),
      );
      scale.value = withSequence(
        withTiming(0.72, { duration: 0, reduceMotion: ReduceMotion.System }),
        withSpring(1, SPRING),
      );
    } else {
      scale.value = withSequence(
        withTiming(0.82, { duration: 90, reduceMotion: ReduceMotion.System }),
        withSpring(1, SPRING),
      );
    }
  }, [lift, saved, scale, size]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: lift.value }, { scale: scale.value }],
  }));

  return (
    <Animated.View style={style}>
      <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={size} color={color} />
    </Animated.View>
  );
}
