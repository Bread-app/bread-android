import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import LottieView from "lottie-react-native";
import React, { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Fonts } from "@/constants/theme";
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;

// The composer's generating screen is deliberately plain white in both themes —
// it is a full-bleed pause in the flow, not a themed surface.
const GENERATING_BG = "#FFFFFF";
const GENERATING_FG = "#000000";

/**
 * The full-screen "your sandwich is cooking" state.
 *
 * Covers everything — it sits outside the composer's SafeAreaView so the white
 * takes the notch and the bottom CTA too. While it is up, the composer is gone
 * and the only things on screen are the animation and the live stage label.
 *
 * How long it stays up is not this component's decision, and the distinction
 * matters: a podcast drops it the moment the analysis is safe on the server,
 * because from there a banner and a push do the reporting. A typed thesis has
 * nowhere to hand off to, so it holds this screen for its whole run.
 */
export function CookingOverlay({
  visible,
  stage,
  hint,
  onBack,
}: {
  visible: boolean;
  stage: string | null;
  /** Overrides the default reassurance line — see the caption phases below. */
  hint?: string;
  onBack: () => void;
}): React.ReactElement | null {
  const insets = useSafeAreaInsets();
  // A missing or unparseable animation must not take the whole loading state
  // down with it; the static loaf is the same idea, standing still.
  const [lottieFailed, setLottieFailed] = useState(false);

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Keep building in the background"
        hitSlop={14}
        onPress={onBack}
        style={[styles.back, { top: insets.top + 6 }]}
      >
        <Ionicons name="chevron-back" size={24} color={GENERATING_FG} />
      </PressableScale>

      {lottieFailed ? (
        <Image
          source={require("../../assets/images/sandwich-loading.png")}
          style={styles.art}
          resizeMode="contain"
        />
      ) : (
        <LottieView
          source={require("../../assets/animations/cooking.json")}
          autoPlay
          loop
          style={styles.art}
          onAnimationFailure={() => setLottieFailed(true)}
        />
      )}

      <Text style={styles.stage}>{stage ?? "Firing oven…"}</Text>
      <Text style={styles.hint}>{hint ?? "Head back whenever you like — it keeps cooking up top."}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: GENERATING_BG,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    // Later sibling wins on iOS; Android needs the elevation to match.
    zIndex: 100,
    elevation: 100,
  },
  back: {
    position: "absolute",
    left: 14,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  art: {
    width: 180,
    height: 180,
  },
  stage: {
    marginTop: 20,
    textAlign: "center",
    color: GENERATING_FG,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
    fontFamily: F,
  },
  hint: {
    marginTop: 10,
    textAlign: "center",
    color: "rgba(0,0,0,0.42)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    fontFamily: F,
  },
  artWrap: {
    width: 260,
    height: 260,
    alignItems: "center",
    justifyContent: "center",
  },
  halo: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: "rgba(0,0,0,0.05)",
  },
  handoffTitle: {
    marginTop: 4,
    textAlign: "center",
    color: GENERATING_FG,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
    letterSpacing: -0.4,
    fontFamily: F,
  },
  handoffMessage: {
    marginTop: 10,
    textAlign: "center",
    color: "rgba(0,0,0,0.45)",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    fontFamily: F,
  },
  doneButton: {
    position: "absolute",
    left: 32,
    right: 32,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GENERATING_FG,
  },
  doneLabel: {
    color: GENERATING_BG,
    fontSize: 16,
    fontWeight: "800",
    fontFamily: F,
  },
});

/**
 * The "we'll take it from here" screen.
 *
 * Shown the instant a pasted episode is safe on the server. From that point the
 * analysis outlives the app, so there is nothing left for the user to watch and
 * nothing for them to confirm — the markets are built for them and a push says
 * when they are ready. This screen exists only to say that, and then get out of
 * the way.
 *
 * Deliberately NOT a preview: showing the episode's calls here and then
 * building them anyway asks for a decision that was never actually being taken.
 */
export function NotifyHandoffOverlay({
  visible,
  title = "Mixing your sandwich",
  message = "We'll notify you the moment it's ready — you can keep using the app.",
  onDone,
}: {
  visible: boolean;
  title?: string;
  message?: string;
  onDone: () => void;
}): React.ReactElement | null {
  const insets = useSafeAreaInsets();
  const enter = useSharedValue(0);
  // Two independent loops: the bowl rocks like it is being stirred, and a soft
  // ring breathes behind it. Kept separate so neither restarts the other.
  const stir = useSharedValue(0);
  const halo = useSharedValue(0);

  useEffect(() => {
    if (!visible) {
      enter.value = 0;
      return;
    }
    enter.value = withSpring(1, { damping: 15, stiffness: 180, mass: 0.9 });
    stir.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(-1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      true,
    );
    halo.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [enter, halo, stir, visible]);

  const artStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [
      { scale: 0.86 + enter.value * 0.14 },
      { rotate: `${stir.value * 4}deg` },
      { translateY: -Math.abs(stir.value) * 5 },
    ],
  }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: enter.value * (0.5 - halo.value * 0.32),
    transform: [{ scale: 0.9 + halo.value * 0.22 }],
  }));
  const copyStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 14 }],
  }));

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <View style={styles.artWrap}>
        <Animated.View style={[styles.halo, haloStyle]} />
        <Animated.Image
          source={require("../../assets/images/mixing-bowl.png")}
          style={[styles.art, artStyle]}
          resizeMode="contain"
        />
      </View>

      <Animated.View style={copyStyle}>
        <Text style={styles.handoffTitle}>{title}</Text>
        <Text style={styles.handoffMessage}>{message}</Text>
      </Animated.View>

      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Done"
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onDone();
        }}
        style={[styles.doneButton, { bottom: insets.bottom + 28 }]}
      >
        <Text style={styles.doneLabel}>Done</Text>
      </PressableScale>
    </View>
  );
}
