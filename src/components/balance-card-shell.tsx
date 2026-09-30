import React, { useEffect, useRef } from "react";
import {
  Animated,
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";

import { Fonts } from "@/constants/theme";
import { ValueSkeleton } from "@/components/value-skeleton";

const F = Fonts.rounded;

/** Standard ID-1 / credit-card aspect ratio (85.6mm × 53.98mm ≈ 1.586). */
export const CARD_ASPECT_RATIO = 1.586;

export const CARD_TEXTURE_URI =
  "https://thumbs.dreamstime.com/b/closeup-sandwich-bread-texture-18087663.jpg";

/**
 * Splits a formatted "$1,234.56" balance into its integer ("$1,234") and
 * decimal (".56") parts so the cents can render smaller. Non-currency states
 * ("—") fall through with no decimal part.
 */
function splitBalance(label: string): { intPart: string; decPart: string | null } {
  const match = label.match(/^(-?\$[\d,]+)(\.\d+)$/);
  if (match) return { intPart: match[1], decPart: match[2] };
  return { intPart: label, decPart: null };
}

/**
 * A balance number filled with a vertical gradient. MaskedView clips the
 * LinearGradient to the glyph shapes; an invisible text copy sizes the fill.
 */
export function GradientBalance({
  label,
  colors,
  locations,
  loading = false,
  skeletonColor,
}: {
  label: string;
  /** Top-to-bottom fill for the digits. */
  colors: readonly [string, string, ...string[]];
  locations?: readonly [number, number, ...number[]];
  /**
   * The balance hasn't arrived yet. Shows a bar the height of the digits
   * instead of the label — a figure we don't have yet is unknown, not absent,
   * and a dash on a balance card reads as "your account is empty".
   */
  loading?: boolean;
  /** Fill for the loading bar. Each card sets one that reads on its own face. */
  skeletonColor?: string;
}) {
  const { intPart, decPart } = splitBalance(label);

  if (loading) {
    // The wrapper keeps the digits' own line height (56) so the label above it
    // doesn't shift when the balance lands; the bar itself is shorter than the
    // glyphs, because a full-height block reads as a redaction.
    return (
      <View style={[styles.balanceMask, styles.balanceLoading]}>
        <ValueSkeleton
          width={196}
          height={40}
          radius={12}
          color={skeletonColor ?? "rgba(0,0,0,0.14)"}
          accessibilityLabel="Loading balance"
        />
      </View>
    );
  }

  const textRow = (hidden: boolean) => (
    <View style={[styles.balanceRow, hidden && styles.balanceHidden]}>
      <Text numberOfLines={1} style={styles.balanceValue}>
        {intPart}
      </Text>
      {decPart ? (
        <Text numberOfLines={1} style={styles.balanceDecimal}>
          {decPart}
        </Text>
      ) : null}
    </View>
  );

  return (
    <MaskedView style={styles.balanceMask} maskElement={textRow(false)}>
      <LinearGradient
        colors={colors}
        locations={locations}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      >
        {textRow(true)}
      </LinearGradient>
    </MaskedView>
  );
}

type FlipCardProps = {
  /** Controlled flip state — true shows the back face. */
  flipped: boolean;
  /** Tap handler. The shell never flips itself; the owner decides. */
  onPress: () => void;
  /** Gradient for the front face, top-left to bottom-right. */
  frontColors: readonly [string, string, ...string[]];
  /** Gradient for the back face. Usually the front colours reversed. */
  backColors: readonly [string, string, ...string[]];
  /** Overlays the bread photo texture. */
  textured?: boolean;
  /** Opacity of the texture overlay, 0–1. */
  textureOpacity?: number;
  front: React.ReactNode;
  back: React.ReactNode;
};

/**
 * The flippable "credit card" surface shared by every balance card: two
 * absolutely-stacked faces rotated around Y, with backface culling doing the
 * hiding. Content and colours come from the caller so each card keeps its own
 * identity while the geometry and motion stay identical.
 */
export function FlipCard({
  flipped,
  onPress,
  frontColors,
  backColors,
  textured = false,
  textureOpacity = 0.92,
  front,
  back,
}: FlipCardProps) {
  const flipAnim = useRef(new Animated.Value(flipped ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(flipAnim, {
      toValue: flipped ? 1 : 0,
      friction: 8,
      tension: 60,
      useNativeDriver: true,
    }).start();
  }, [flipAnim, flipped]);

  const frontInterpolate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });
  const backInterpolate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["180deg", "360deg"],
  });

  const texture = textured ? (
    <ImageBackground
      source={{ uri: CARD_TEXTURE_URI }}
      style={StyleSheet.absoluteFill}
      imageStyle={[styles.cardTexture, { opacity: textureOpacity }]}
    />
  ) : null;

  return (
    <Pressable onPress={onPress} style={styles.cardWrapper}>
      <Animated.View
        style={[
          styles.cardFace,
          { transform: [{ perspective: 1000 }, { rotateY: frontInterpolate }] },
        ]}
      >
        <LinearGradient
          colors={frontColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.card}
        >
          {texture}
          {front}
        </LinearGradient>
      </Animated.View>

      <Animated.View
        style={[
          styles.cardFace,
          { transform: [{ perspective: 1000 }, { rotateY: backInterpolate }] },
        ]}
      >
        <LinearGradient
          colors={backColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.card}
        >
          {texture}
          {back}
        </LinearGradient>
      </Animated.View>
    </Pressable>
  );
}

export const cardStyles = StyleSheet.create({
  label: {
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.7,
    fontFamily: F,
  },
  backLabel: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
    fontFamily: F,
  },
  backFooter: {
    fontSize: 11,
    fontWeight: "600",
    textAlign: "center",
    fontFamily: F,
  },
});

const styles = StyleSheet.create({
  cardWrapper: {
    width: "100%",
    aspectRatio: CARD_ASPECT_RATIO,
    alignSelf: "stretch",
  },
  cardFace: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    backfaceVisibility: "hidden",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
  },
  cardTexture: {
    borderRadius: 24,
  },
  card: {
    flex: 1,
    borderRadius: 24,
    padding: 24,
    justifyContent: "center",
    alignItems: "flex-start",
    overflow: "hidden",
  },
  balanceMask: {
    alignSelf: "flex-start",
    marginTop: 4,
  },
  balanceLoading: {
    height: 56,
    justifyContent: "center",
  },
  balanceRow: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  balanceHidden: {
    opacity: 0,
  },
  balanceValue: {
    color: "#000000",
    fontSize: 56,
    lineHeight: 56,
    fontWeight: "800",
    fontFamily: F,
  },
  balanceDecimal: {
    color: "#000000",
    fontSize: 42,
    lineHeight: 42,
    fontWeight: "800",
    fontFamily: F,
  },
});
