import React, { useEffect, useRef, useState } from "react";
import {
  Image,
  ImageBackground,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { Fonts } from "@/constants/theme";
import { useShake } from "@/hooks/use-shake";

const F = Fonts.rounded;
const M = Fonts.mono;

// ── Geometry ─────────────────────────────────────────────────────────────────
// The leather wallet is 100% stationary. The card lives hidden inside it (behind
// the leather face), and ONLY the card moves: it slides straight down, emerges
// from the bottom opening, crosses in FRONT of the wallet partway out, and
// settles resting partially outside. No transform is ever applied to the wallet.
const WALLET_H = 210;
const CARD_H = 188;
const CARD_CLOSED_Y = 12; // tucked inside the wallet (behind the leather face)
const CARD_OPEN_Y = 168; // pulled out: top still overlaps wallet, body hangs below
const CARD_TRAVEL = CARD_OPEN_Y - CARD_CLOSED_Y;
// Progress at which the card crosses from behind the wallet to in front of it —
// "as it comes out, it transitions in front". Kept past halfway so it reads as
// the card cresting out of the slot rather than a hard z-swap.
const FRONT_AT = 0.58;
const CONTAINER_OPEN_H = CARD_OPEN_Y + CARD_H + 16;

// Opening glides out of the pocket with just a hint of settle (enough damping to
// read as smooth, not bouncy). Closing eases back in rather than snapping, so the
// card feels like it's being drawn back into the wallet.
const OPEN_SPRING = { damping: 15, stiffness: 92, mass: 1 } as const;
const SNAP_SPRING = { damping: 22, stiffness: 150, mass: 0.95 } as const;

// User-supplied leather grain. A dark gradient sits under it so the wallet still
// reads as leather even if this remote texture fails to load.
const LEATHER_TEXTURE_URI =
  "https://png.pngtree.com/png-clipart/20240501/original/pngtree-dark-sleek-leather-texture-overlay-png-image_14983726.png";

// ── Palette ──────────────────────────────────────────────────────────────────
const WHITE = "#FFFFFF";
const FIELD_BG = "#F3F4FB";
const INK = "#0B1220";
const INK_DIM = "#8A93A3";
const LABEL = "#A6ABBE";
const POSITIVE = "#02ED45";
const NEGATIVE = "#D2042D";
const STITCH = "rgba(247,225,193,0.55)";
const BRASS = "#D9A64A";
const BRASS_DEEP = "#A9772B";
const CARD_TINT = "#E9C77B"; // warm card text/brand

// ── Public data shape (unchanged for the wallet screen) ──────────────────────
export type PassportToken = {
  key: string;
  symbol: string;
  name: string;
  icon: string | null;
  usd: number;
  change24h: number | null;
};

export type PassportBadge = {
  label: string;
  verified: boolean;
};

export type PassportData = {
  avatarUrl: string | null;
  walletAddress: string | null;
  passportNo: string;
  eid: string;
  network: string;
  ready: boolean;
  totalValue: number;
  cash: number;
  holdingsCount: number;
  change24hPct: number | null;
  tokens: PassportToken[];
  badges: PassportBadge[];
};

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/** Worklet-safe "1,234.56" formatter (Intl isn't available on the UI thread). */
function groupMoney(n: number, decimals: number): string {
  "worklet";
  const fixed = Math.max(0, n).toFixed(decimals);
  const dot = fixed.indexOf(".");
  const intPart = dot === -1 ? fixed : fixed.slice(0, dot);
  const decPart = dot === -1 ? "" : fixed.slice(dot);
  let out = "";
  const len = intPart.length;
  for (let i = 0; i < len; i++) {
    if (i > 0 && (len - i) % 3 === 0) out += ",";
    out += intPart[i];
  }
  return out + decPart;
}

function compactUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `$${n.toFixed(0)}`;
}

function last4(addr: string | null): string {
  return addr ? addr.slice(-4).toUpperCase() : "····";
}

/** A currency figure that counts up from 0 → value when `active` flips true. */
function AnimatedMoney({
  value,
  active,
  prefix = "$",
  decimals = 2,
  style,
}: {
  value: number;
  active: boolean;
  prefix?: string;
  decimals?: number;
  style?: StyleProp<any>;
}) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = active ? withTiming(1, { duration: 950 }) : 0;
  }, [active, value, progress]);

  const animatedProps = useAnimatedProps(() => {
    const current = value * progress.value;
    return { text: `${prefix}${groupMoney(current, decimals)}` } as any;
  });

  return (
    <AnimatedTextInput
      editable={false}
      underlineColorAndroid="transparent"
      style={style}
      animatedProps={animatedProps}
      defaultValue={`${prefix}${groupMoney(value, decimals)}`}
    />
  );
}

/** Fades + lifts its children in once `progress` passes `start`. */
function Reveal({
  progress,
  start,
  style,
  children,
}: {
  progress: SharedValue<number>;
  start: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [start, start + 0.18], [0, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(
          progress.value,
          [start, start + 0.24],
          [16, 0],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));
  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

/** A verification chip that "stamps" in. */
function Stamp({ open, delay, badge }: { open: boolean; delay: number; badge: PassportBadge }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = open ? withDelay(delay, withSpring(1, { damping: 6, stiffness: 150 })) : 0;
  }, [open, delay, v]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(v.value, [0, 0.15, 1], [0, 1, 1], Extrapolation.CLAMP),
    transform: [
      { scale: interpolate(v.value, [0, 1], [1.6, 1], Extrapolation.CLAMP) },
      { rotate: `${interpolate(v.value, [0, 1], [-9, -3], Extrapolation.CLAMP)}deg` },
    ],
  }));

  return (
    <Animated.View
      style={[styles.chip, badge.verified ? styles.chipOn : styles.chipOff, animatedStyle]}
    >
      <Text style={[styles.chipCheck, { color: badge.verified ? POSITIVE : INK_DIM }]}>
        {badge.verified ? "✓" : "○"}
      </Text>
      <Text
        style={[styles.chipText, { color: badge.verified ? INK : INK_DIM }]}
        numberOfLines={1}
      >
        {badge.label}
      </Text>
    </Animated.View>
  );
}

function Stat({ value, label, tint }: { value: string; label: string; tint?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statNum, tint ? { color: tint } : null]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function PassportWallet({
  data,
  onOpenChange,
}: {
  data: PassportData;
  /** Fired when the card crosses the open/closed threshold (drops out / tucks back). */
  onOpenChange?: (open: boolean) => void;
}) {
  const progress = useSharedValue(0); // 0 closed → 1 open
  const hint = useSharedValue(0); // looping peek hint

  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const setOpenState = (next: boolean) => {
    openRef.current = next;
    setOpen(next);
    onOpenChange?.(next);
  };

  // Once the card has emerged past FRONT_AT it crosses in front of the wallet.
  const [cardFront, setCardFront] = useState(false);

  useAnimatedReaction(
    () => progress.value,
    (v, prev) => {
      const p = prev ?? 0;
      if (v > 0.9 && p <= 0.9) runOnJS(setOpenState)(true);
      else if (v < 0.5 && p >= 0.5) runOnJS(setOpenState)(false);
      if (v >= FRONT_AT && p < FRONT_AT) runOnJS(setCardFront)(true);
      else if (v < FRONT_AT && p >= FRONT_AT) runOnJS(setCardFront)(false);
    },
  );

  useEffect(() => {
    hint.value = withRepeat(withTiming(1, { duration: 1000 }), -1, true);
  }, [hint]);

  const snapTo = (toOpen: boolean) => {
    progress.value = withSpring(toOpen ? 1 : 0, toOpen ? OPEN_SPRING : SNAP_SPRING);
  };

  const toggle = () => {
    const goingOpen = !openRef.current;
    void Haptics.impactAsync(
      goingOpen ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
    );
    snapTo(goingOpen);
  };

  const onShake = () => {
    if (openRef.current) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      snapTo(false);
      return;
    }
    // The card is flung out of the pocket and settles with an overshoot.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    progress.value = withSpring(1, OPEN_SPRING);
    setTimeout(() => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }, 480);
  };

  useShake(onShake, { threshold: 1.2, cooldownMs: 800 });

  // ── Gestures ──────────────────────────────────────────────────────────────
  const startProgress = useSharedValue(0);
  const pan = Gesture.Pan()
    .activeOffsetY([-14, 14])
    .onBegin(() => {
      startProgress.value = progress.value;
    })
    .onUpdate((e) => {
      // Pull the card DOWN (out of the bottom) to open.
      const next = startProgress.value + e.translationY / CARD_TRAVEL;
      progress.value = Math.min(1, Math.max(0, next));
    })
    .onEnd((e) => {
      const flungOpen = e.velocityY > 600;
      const flungShut = e.velocityY < -600;
      const goingOpen = flungOpen || (!flungShut && progress.value > 0.5);
      progress.value = withSpring(goingOpen ? 1 : 0, goingOpen ? OPEN_SPRING : SNAP_SPRING);
      runOnJS(Haptics.impactAsync)(
        goingOpen ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
      );
    });
  const tap = Gesture.Tap().maxDuration(260).onEnd(() => runOnJS(toggle)());
  const gesture = Gesture.Exclusive(pan, tap);

  // ── Animated styles ───────────────────────────────────────────────────────
  // Container grows downward to make room for the extended card + detail panel.
  // The wallet itself NEVER gets a transform — it is laid out statically.
  const containerStyle = useAnimatedStyle(() => ({
    height: interpolate(
      progress.value,
      [0, 1],
      [WALLET_H, CONTAINER_OPEN_H],
      Extrapolation.CLAMP,
    ),
  }));

  // The only moving object. translateY is intentionally NOT clamped so the
  // overshoot of the spring carries the card slightly past its resting point
  // before it settles — the weighted, tactile pull-out.
  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: CARD_CLOSED_Y + CARD_TRAVEL * progress.value }],
    shadowOpacity: interpolate(progress.value, [0, 0.4, 1], [0, 0.1, 0.34], Extrapolation.CLAMP),
  }));

  const hintStyle = useAnimatedStyle(() => ({
    opacity:
      interpolate(progress.value, [0, 0.15], [1, 0], Extrapolation.CLAMP) *
      interpolate(hint.value, [0, 1], [0.45, 1]),
    transform: [{ translateY: interpolate(hint.value, [0, 1], [0, 3]) }],
  }));

  // The pocket mouth: as the card pushes out, the bottom opening deepens and
  // darkens (and eases shut as the card returns) so the wallet reads as opening
  // at the bottom rather than the card just sliding over a static lip.
  const slotStyle = useAnimatedStyle(() => ({
    height: interpolate(progress.value, [0, 0.3], [9, 22], Extrapolation.CLAMP),
    opacity: interpolate(progress.value, [0, 0.25], [0.5, 1], Extrapolation.CLAMP),
  }));

  const countActive = open && data.ready;

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.outer, containerStyle]}>
        {/* Credit card — the ONLY object that moves. Hidden inside the wallet
            (behind it) when closed; slides down out the bottom and crosses in
            front of the wallet as it emerges. */}
        <Animated.View style={[styles.card, cardStyle, { zIndex: cardFront ? 3 : 1 }]}>
          <LinearGradient
            colors={["#222634", "#14161F", "#0C0D14"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.cardFill}
          >
            <View style={styles.cardTopRow}>
              <Text style={styles.contactless}>))) </Text>
            </View>

            <View style={styles.chipEmv}>
              <View style={styles.chipLine} />
              <View style={styles.chipLine} />
            </View>

            <Text style={styles.cardLabel}>CASH BALANCE</Text>
            {data.ready ? (
              <AnimatedMoney value={data.cash} active={countActive} style={styles.cardBalance} />
            ) : (
              <Text style={styles.cardBalance}>—</Text>
            )}

          </LinearGradient>
        </Animated.View>

        {/* Leather wallet — completely stationary, no transform ever. */}
        <View style={styles.wallet}>
          <ImageBackground
            source={{ uri: LEATHER_TEXTURE_URI }}
            style={styles.walletFill}
            imageStyle={styles.walletTexture}
          >
            <LinearGradient
              colors={["#5A3A28", "#3A2418", "#241410"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0.6, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <ImageBackground
              source={{ uri: LEATHER_TEXTURE_URI }}
              style={StyleSheet.absoluteFill}
              imageStyle={styles.walletTextureOverlay}
            />
            {/* Embossed identity. */}
            <View style={styles.emblem}>
              {data.avatarUrl ? (
                <Image source={{ uri: data.avatarUrl }} style={styles.emblemAvatar} />
              ) : (
                <View style={styles.emblemRing} />
              )}
            </View>

            {/* Card slot at the bottom — the opening the card slides out of.
                Animated so the mouth deepens as the card emerges. */}
            <Animated.View style={[styles.slot, slotStyle]} pointerEvents="none" />

            {/* Brass snap tab on the right edge. */}
            <View style={styles.snapTab}>
              <View style={styles.snap}>
                <View style={styles.snapInner} />
              </View>
            </View>
          </ImageBackground>
        </View>

        {/* Pull hint sits over the wallet while closed. */}
        <Animated.View style={[styles.hint, hintStyle]} pointerEvents="none">
          <Text style={styles.hintText}>shake · pull down · tap</Text>
        </Animated.View>

      </Animated.View>
    </GestureDetector>
  );
}

const CARD_RADIUS = 18;

const styles = StyleSheet.create({
  outer: {
    width: "100%",
  },
  flex1: { flex: 1 },
  // ── Card ──
  card: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: CARD_H,
    borderRadius: CARD_RADIUS,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 16,
    elevation: 12,
  },
  cardFill: {
    flex: 1,
    borderRadius: CARD_RADIUS,
    padding: 18,
    overflow: "hidden",
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardBrand: {
    color: CARD_TINT,
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 2,
    fontFamily: F,
  },
  contactless: {
    color: "rgba(233,199,123,0.7)",
    fontSize: 16,
    fontWeight: "900",
    transform: [{ rotate: "90deg" }],
  },
  chipEmv: {
    width: 34,
    height: 26,
    borderRadius: 6,
    backgroundColor: BRASS,
    marginTop: 12,
    paddingVertical: 5,
    paddingHorizontal: 6,
    justifyContent: "space-between",
  },
  chipLine: {
    height: 2,
    borderRadius: 1,
    backgroundColor: BRASS_DEEP,
  },
  cardLabel: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.5,
    fontFamily: M,
    marginTop: 12,
  },
  cardBalance: {
    color: WHITE,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "900",
    fontFamily: F,
    letterSpacing: -0.8,
    padding: 0,
    marginTop: 2,
  },
  cardBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: "auto",
  },
  cardNumber: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 2,
    fontFamily: M,
  },
  cardChange: {
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  cardChangeText: {
    fontSize: 12,
    fontWeight: "900",
    fontFamily: F,
  },
  cardNetwork: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 1.5,
    fontFamily: M,
    marginTop: "auto" as any,
  },
  // ── Leather wallet (stationary) ──
  wallet: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: WALLET_H,
    borderRadius: 22,
    overflow: "hidden",
    zIndex: 2,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 16,
  },
  walletFill: {
    flex: 1,
  },
  walletTexture: {
    borderRadius: 22,
    resizeMode: "cover",
  },
  walletTextureOverlay: {
    borderRadius: 22,
    resizeMode: "cover",
    opacity: 0.5,
  },
  slot: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 14,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
  },
  stitch: {
    position: "absolute",
    top: 10,
    left: 10,
    right: 10,
    bottom: 10,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: STITCH,
    borderStyle: "dashed",
  },
  emblem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  emblemRing: {
    width: 52,
    height: 40,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "rgba(247,225,193,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  emblemLetter: {
    color: "rgba(247,225,193,0.85)",
    fontSize: 22,
    fontWeight: "900",
    fontFamily: F,
  },
  emblemAvatar: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "rgba(247,225,193,0.5)",
  },
  emboss: {
    color: "rgba(247,225,193,0.5)",
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: 6,
    fontFamily: F,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  embossSub: {
    color: "rgba(247,225,193,0.32)",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 3,
    fontFamily: M,
  },
  snapTab: {
    position: "absolute",
    right: 0,
    top: WALLET_H / 2 - 26,
    width: 26,
    height: 52,
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
    backgroundColor: "#2A170F",
    alignItems: "center",
    justifyContent: "center",
  },
  snap: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: BRASS,
    alignItems: "center",
    justifyContent: "center",
  },
  snapInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: BRASS_DEEP,
  },
  hint: {
    position: "absolute",
    top: WALLET_H - 30,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 5,
  },
  hintText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.5,
    fontFamily: M,
  },
  stat: {
    flex: 1,
    alignItems: "center",
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: "#E6E8F0",
  },
  statNum: {
    color: INK,
    fontSize: 22,
    fontWeight: "900",
    fontFamily: F,
    letterSpacing: -0.5,
  },
  statLabel: {
    color: LABEL,
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 1.2,
    fontFamily: M,
    marginTop: 3,
  },
  section: {
    marginTop: 16,
  },
  sectionLabel: {
    color: LABEL,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.5,
    fontFamily: M,
    marginBottom: 8,
  },
  empty: {
    color: INK_DIM,
    fontSize: 13,
    fontWeight: "600",
    fontFamily: F,
  },
  tokenRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 5,
  },
  tokenIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: FIELD_BG,
    marginRight: 10,
  },
  tokenIconFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  tokenIconLetter: {
    color: INK,
    fontSize: 13,
    fontWeight: "900",
    fontFamily: F,
  },
  tokenSymbol: {
    color: INK,
    fontSize: 14,
    fontWeight: "800",
    fontFamily: F,
  },
  tokenName: {
    color: INK_DIM,
    fontSize: 11,
    fontWeight: "600",
    fontFamily: F,
  },
  tokenRight: {
    alignItems: "flex-end",
  },
  tokenUsd: {
    color: INK,
    fontSize: 14,
    fontWeight: "800",
    fontFamily: F,
  },
  tokenChange: {
    fontSize: 11,
    fontWeight: "700",
    fontFamily: F,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  chipOn: {
    borderColor: "rgba(2,237,69,0.5)",
    backgroundColor: "rgba(2,237,69,0.07)",
  },
  chipOff: {
    borderColor: "#E0E3EC",
    backgroundColor: "#F7F8FB",
  },
  chipCheck: {
    fontSize: 11,
    fontWeight: "900",
    fontFamily: F,
  },
  chipText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
    fontFamily: M,
  },
});
