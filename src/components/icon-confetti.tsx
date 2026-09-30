import * as Haptics from 'expo-haptics';
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from 'react';
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

/**
 * Imperative confetti overlay that rains a burst of token logos down the
 * screen — fired after a successful buy. For a single stock pass its one icon;
 * for a sandwich pass every leg's logo and the burst cycles through them.
 *
 * Mount it once near the top of a sheet/screen as an absolute-fill overlay
 * (it renders nothing until `fire()` is called) and keep the ref around:
 *
 *   const confettiRef = useRef<IconConfettiRef>(null);
 *   confettiRef.current?.fire([stock.icon]);
 */
export type IconConfettiRef = {
  fire: (icons: (string | null | undefined)[]) => void;
};

type Piece = {
  key: string;
  uri: string;
  startX: number;
  driftX: number;
  delay: number;
  duration: number;
  rotateDir: number;
  spin: number;
  size: number;
};

const PIECE_COUNT = 26;
const FALL_MS = 2600;

function ConfettiPiece({
  piece,
  height,
  onDone,
}: {
  piece: Piece;
  height: number;
  onDone: (key: string) => void;
}) {
  const progress = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withSequence(
      withDelay(piece.delay, withTiming(1, { duration: 140 })),
      withDelay(piece.duration - 440, withTiming(0, { duration: 300 })),
    );
    progress.value = withDelay(
      piece.delay,
      withTiming(
        1,
        { duration: piece.duration, easing: Easing.in(Easing.quad) },
        (finished) => {
          if (finished) runOnJS(onDone)(piece.key);
        },
      ),
    );
    // Animation params are fixed per piece; run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => {
    const translateY = -60 + progress.value * (height + 120);
    const translateX = piece.driftX * Math.sin(progress.value * Math.PI * 2);
    const rotate = piece.rotateDir * piece.spin * progress.value;
    return {
      opacity: opacity.value,
      transform: [
        { translateX },
        { translateY },
        { rotate: `${rotate}deg` },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.piece,
        { left: piece.startX, width: piece.size, height: piece.size },
        animatedStyle,
      ]}
    >
      <Image source={{ uri: piece.uri }} style={styles.icon} />
    </Animated.View>
  );
}

export const IconConfetti = forwardRef<IconConfettiRef>(function IconConfetti(_props, ref) {
  const { width, height } = useWindowDimensions();
  const [pieces, setPieces] = useState<Piece[]>([]);

  const removePiece = useCallback((key: string) => {
    setPieces((prev) => prev.filter((piece) => piece.key !== key));
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      fire: (icons) => {
        const sources = icons.filter(
          (uri): uri is string => typeof uri === 'string' && uri.length > 0,
        );
        if (sources.length === 0) return;

        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        const burst = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
        const next: Piece[] = Array.from({ length: PIECE_COUNT }).map((_, i) => {
          const size = 30 + Math.random() * 22;
          return {
            key: `${burst}-${i}`,
            // Cycle through the basket's logos so every leg is represented.
            uri: sources[i % sources.length],
            startX: Math.random() * Math.max(1, width - size),
            driftX: (Math.random() - 0.5) * 80,
            delay: Math.random() * 420,
            duration: FALL_MS * (0.75 + Math.random() * 0.5),
            rotateDir: Math.random() > 0.5 ? 1 : -1,
            spin: 180 + Math.random() * 540,
            size,
          };
        });
        setPieces((prev) => [...prev, ...next]);
      },
    }),
    [width],
  );

  if (pieces.length === 0) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map((piece) => (
        <ConfettiPiece
          key={piece.key}
          piece={piece}
          height={height}
          onDone={removePiece}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  piece: {
    position: 'absolute',
    top: 0,
  },
  icon: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#ffffff',
  },
});
