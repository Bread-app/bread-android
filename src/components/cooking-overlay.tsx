import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  useReducedMotion,
  withDelay,
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

// ─── Cooking scene ───────────────────────────────────────────────────────────
//
// The wait is research-backed and can run a minute or more, so the screen has to
// carry it. Everything that moves here is tied to something real: the step
// tracker and the stack height follow the pipeline's own stage labels, and the
// quips only fill the gaps between them.

type CookingKind = "sandwich" | "podcast";

const STEP_LABELS: Record<CookingKind, [string, string, string]> = {
  sandwich: ["Read", "Research", "Stack"],
  podcast: ["Captions", "Listen", "Match"],
};

const QUIPS: Record<CookingKind, string[]> = {
  sandwich: [
    "Slicing through the hype…",
    "Toasting the bull case…",
    "Weighing the bear case…",
    "Checking the bread isn't stale…",
    "Finding what actually moves on this…",
    "Pricing in the vibes…",
    "Asking the market nicely…",
  ],
  podcast: [
    "Skipping the ad reads…",
    "Catching every ticker drop…",
    "Separating calls from banter…",
    "Rewinding the good bits…",
    "Taking notes so you don't have to…",
  ],
};

/** Maps the pipeline's live stage label onto the three-step tracker. */
function stepForStage(stage: string | null): number {
  const s = (stage ?? "").toLowerCase();
  if (/building|matching|stack/.test(s)) return 2;
  if (/research|paywalled|listening|queued/.test(s)) return 1;
  return 0;
}

type Layer = { key: string; kind: "bun-bottom" | "filling" | "bun-top"; color?: string; label?: string; width?: number };

// Each filling is named for what the pipeline is actually gathering, so the
// sandwich reads as the basket being assembled rather than decoration.
const FILLINGS: Layer[] = [
  { key: "f0", kind: "filling", color: "#6CC25A", label: "research", width: 168 },
  { key: "f1", kind: "filling", color: "#E8553F", label: "catalysts", width: 146 },
  { key: "f2", kind: "filling", color: "#F7C948", label: "conviction", width: 160 },
  { key: "f3", kind: "filling", color: "#8C5A3C", label: "markets", width: 152 },
];
const BUN_BOTTOM: Layer = { key: "bb", kind: "bun-bottom" };
const BUN_TOP: Layer = { key: "bt", kind: "bun-top" };

/** How many fillings each step is allowed to have dropped. */
const FILLING_CAP = [1, 3, FILLINGS.length];
/** While waiting inside a step, a new filling drops this often. */
const DROP_EVERY_MS = 3200;

const BUN = "#E2A458";
const BUN_CRUST = "#C98A3E";

/**
 * The full-screen "your sandwich is cooking" state.
 *
 * Covers everything — it sits outside the composer's SafeAreaView so the white
 * takes the notch and the bottom CTA too. While it is up, the composer is gone
 * and the only things on screen are the cooking scene and the live stage label.
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
  kind = "sandwich",
  input,
  startedAt,
  onBack,
}: {
  visible: boolean;
  stage: string | null;
  /** Overrides the default reassurance line — see the caption phases below. */
  hint?: string;
  kind?: CookingKind;
  /** The thesis being cooked, shown as the ticket the scanner reads. */
  input?: string;
  /** When the job began, for the elapsed clock. */
  startedAt?: number;
  onBack: () => void;
}): React.ReactElement | null {
  const insets = useSafeAreaInsets();
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

      <CookingScene kind={kind} stage={stage} input={input} />

      <Text style={styles.stage} accessibilityLiveRegion="polite">
        {stage ?? "Firing oven…"}
      </Text>
      <QuipTicker kind={kind} />

      <View style={[styles.footer, { bottom: insets.bottom + 20 }]}>
        {startedAt ? <ElapsedClock startedAt={startedAt} /> : null}
        <Text style={styles.hint}>{hint ?? "Head back whenever you like — it keeps cooking up top."}</Text>
      </View>
    </View>
  );
}

function CookingScene({
  kind,
  stage,
  input,
}: {
  kind: CookingKind;
  stage: string | null;
  input?: string;
}): React.ReactElement {
  const step = stepForStage(stage);
  // Steps only move forward: a resumed "researching" label after a retry must
  // not un-stack the sandwich.
  const [maxStep, setMaxStep] = useState(step);
  useEffect(() => {
    if (step <= maxStep) return;
    void Haptics.selectionAsync();
    setMaxStep(step);
  }, [maxStep, step]);

  const [fillings, setFillings] = useState(0);
  const cap = FILLING_CAP[maxStep];
  useEffect(() => {
    if (fillings >= cap) return;
    // Reaching the final step snaps the rest in quickly; inside a step they
    // trickle so a long research wait still shows progress.
    const delay = fillings === 0 ? 700 : maxStep === 2 ? 380 : DROP_EVERY_MS;
    const timer = setTimeout(() => setFillings((n) => Math.min(n + 1, cap)), delay);
    return () => clearTimeout(timer);
  }, [cap, fillings, maxStep]);

  const done = maxStep === 2 && fillings >= FILLINGS.length;
  const layers: Layer[] = [BUN_BOTTOM, ...FILLINGS.slice(0, fillings), ...(done ? [BUN_TOP] : [])];

  return (
    <View style={styles.scene}>
      {kind === "sandwich" && input?.trim() ? <ThesisTicket text={input.trim()} reading={maxStep === 0} /> : null}
      {kind === "podcast" ? <EpisodeChip /> : null}

      <View style={styles.stackArea}>
        <View style={styles.stack}>
          {layers.map((layer, index) => (
            <DroppingLayer key={layer.key} layer={layer} index={index} />
          ))}
          {/* Last child of a column-reverse stack, so it always rides the top layer. */}
          <Steam />
        </View>
        <View style={styles.plate} />
      </View>

      <StepTracker labels={STEP_LABELS[kind]} step={maxStep} />
    </View>
  );
}

function DroppingLayer({ layer, index }: { layer: Layer; index: number }): React.ReactElement {
  const reduceMotion = useReducedMotion();
  const drop = useSharedValue(reduceMotion ? 0 : 1);
  const squash = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    drop.value = withSpring(0, { damping: 11, stiffness: 170, mass: 0.8 });
    // Land with a little squash so the stack feels like it has weight.
    squash.value = withDelay(
      260,
      withSequence(withTiming(1, { duration: 90 }), withSpring(0, { damping: 8, stiffness: 260 })),
    );
    const timer = setTimeout(
      () => void Haptics.impactAsync(layer.kind === "bun-top" ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light),
      260,
    );
    return () => clearTimeout(timer);
  }, [drop, layer.kind, reduceMotion, squash]);

  // Fillings sit at alternating slight angles so the stack looks hand-made.
  const tilt = layer.kind === "filling" ? (index % 2 === 0 ? -2 : 2.5) : 0;
  const style = useAnimatedStyle(() => ({
    opacity: 1 - drop.value * 0.6,
    transform: [
      { translateY: -drop.value * 280 },
      { rotate: `${tilt + drop.value * tilt * 4}deg` },
      { scaleX: 1 + squash.value * 0.06 },
      { scaleY: 1 - squash.value * 0.18 },
    ],
  }));

  if (layer.kind === "bun-bottom") {
    return <Animated.View style={[styles.bunBottom, style]} />;
  }
  if (layer.kind === "bun-top") {
    return (
      <Animated.View style={[styles.bunTop, style]}>
        {SEEDS.map((seed, i) => (
          <View key={i} style={[styles.seed, { left: seed.x, top: seed.y, transform: [{ rotate: `${seed.r}deg` }] }]} />
        ))}
      </Animated.View>
    );
  }
  return (
    <Animated.View style={[styles.filling, { width: layer.width, backgroundColor: layer.color }, style]}>
      <Text style={styles.fillingLabel} numberOfLines={1}>
        {layer.label}
      </Text>
    </Animated.View>
  );
}

const SEEDS = [
  { x: 34, y: 12, r: -20 },
  { x: 62, y: 7, r: 10 },
  { x: 92, y: 9, r: -8 },
  { x: 120, y: 15, r: 24 },
  { x: 50, y: 24, r: 30 },
  { x: 104, y: 25, r: -26 },
];

/** Three wisps rising off the stack, staggered so it never looks like a loop. */
function Steam(): React.ReactElement | null {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return null;
  return (
    <View style={styles.steam} pointerEvents="none">
      {[0, 1, 2].map((i) => (
        <Wisp key={i} delay={i * 650} x={(i - 1) * 26} />
      ))}
    </View>
  );
}

function Wisp({ delay, x }: { delay: number; x: number }): React.ReactElement {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2000, easing: Easing.out(Easing.quad) }), -1, false));
  }, [delay, t]);
  const style = useAnimatedStyle(() => ({
    opacity: Math.sin(t.value * Math.PI) * 0.55,
    transform: [{ translateX: x + Math.sin(t.value * Math.PI * 2) * 5 }, { translateY: -t.value * 46 }, { scaleY: 0.7 + t.value * 0.5 }],
  }));
  return <Animated.View style={[styles.wisp, style]} />;
}

/** The user's own words, with a highlighter sweeping them while they are read. */
function ThesisTicket({ text, reading }: { text: string; reading: boolean }): React.ReactElement {
  const reduceMotion = useReducedMotion();
  const enter = useSharedValue(0);
  const sweep = useSharedValue(0);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    enter.value = withSpring(1, { damping: 16, stiffness: 180 });
  }, [enter]);
  useEffect(() => {
    if (!reading || reduceMotion) {
      sweep.value = withTiming(0, { duration: 200 });
      return;
    }
    sweep.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [reading, reduceMotion, sweep]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * -12 }, { rotate: "-1.5deg" }],
  }));
  const bandStyle = useAnimatedStyle(() => ({
    opacity: reading ? 1 : 0,
    transform: [{ translateY: sweep.value * Math.max(0, height - 20) }],
  }));

  return (
    <Animated.View style={[styles.ticket, cardStyle]} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
      <Animated.View style={[styles.ticketBand, bandStyle]} pointerEvents="none" />
      <Text style={styles.ticketText} numberOfLines={3}>
        “{text}”
      </Text>
      {!reading ? (
        <View style={styles.ticketStamp}>
          <Ionicons name="checkmark" size={11} color="#FFFFFF" />
        </View>
      ) : null}
    </Animated.View>
  );
}

function EpisodeChip(): React.ReactElement {
  return (
    <View style={styles.episodeChip}>
      <Ionicons name="logo-youtube" size={14} color="#FF0033" />
      <Text style={styles.episodeChipText}>Episode</Text>
    </View>
  );
}

function StepTracker({ labels, step }: { labels: [string, string, string]; step: number }): React.ReactElement {
  return (
    <View style={styles.tracker}>
      {labels.map((label, i) => (
        <React.Fragment key={label}>
          {i > 0 ? <View style={[styles.trackerLine, i <= step && styles.trackerLineOn]} /> : null}
          <StepDot label={label} state={i < step ? "done" : i === step ? "active" : "todo"} />
        </React.Fragment>
      ))}
    </View>
  );
}

function StepDot({ label, state }: { label: string; state: "done" | "active" | "todo" }): React.ReactElement {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (state !== "active" || reduceMotion) {
      pulse.value = 0;
      return;
    }
    pulse.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }), -1, false);
  }, [pulse, reduceMotion, state]);
  const ringStyle = useAnimatedStyle(() => ({
    opacity: (1 - pulse.value) * 0.5,
    transform: [{ scale: 1 + pulse.value * 0.9 }],
  }));

  return (
    <View style={styles.stepItem}>
      <View style={styles.stepDotWrap}>
        {state === "active" ? <Animated.View style={[styles.stepRing, ringStyle]} /> : null}
        <View style={[styles.stepDot, state !== "todo" && styles.stepDotOn]}>
          {state === "done" ? <Ionicons name="checkmark" size={11} color="#FFFFFF" /> : null}
        </View>
      </View>
      <Text style={[styles.stepLabel, state !== "todo" && styles.stepLabelOn]}>{label}</Text>
    </View>
  );
}

/** Rotating one-liners under the real stage, so the screen never sits still. */
function QuipTicker({ kind }: { kind: CookingKind }): React.ReactElement {
  const quips = QUIPS[kind];
  const [index, setIndex] = useState(() => Math.floor(Math.random() * quips.length));
  const t = useSharedValue(1);
  useEffect(() => {
    const timer = setInterval(() => {
      t.value = 0;
      t.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.quad) });
      setIndex((i) => (i + 1) % quips.length);
    }, 2800);
    return () => clearInterval(timer);
  }, [quips.length, t]);
  const style = useAnimatedStyle(() => ({ opacity: t.value, transform: [{ translateY: (1 - t.value) * 8 }] }));
  return (
    <Animated.Text style={[styles.quip, style]} numberOfLines={1}>
      {quips[index]}
    </Animated.Text>
  );
}

function ElapsedClock({ startedAt }: { startedAt: number }): React.ReactElement {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const secs = Math.max(0, Math.floor((now - startedAt) / 1000));
  const label = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  return <Text style={styles.clock}>{label}</Text>;
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
  scene: {
    width: "100%",
    alignItems: "center",
  },
  ticket: {
    alignSelf: "stretch",
    marginBottom: 18,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: "#FFF8EC",
    borderWidth: 1,
    borderColor: "rgba(201,138,62,0.25)",
    overflow: "hidden",
  },
  ticketBand: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 20,
    backgroundColor: "rgba(247,201,72,0.45)",
  },
  ticketText: {
    paddingRight: 18,
    color: GENERATING_FG,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "700",
    fontFamily: F,
  },
  ticketStamp: {
    position: "absolute",
    right: 10,
    top: 10,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2FB463",
  },
  episodeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 18,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.05)",
  },
  episodeChipText: {
    color: GENERATING_FG,
    fontSize: 13,
    fontWeight: "700",
    fontFamily: F,
  },
  stackArea: {
    width: 220,
    height: 210,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  stack: {
    flexDirection: "column-reverse",
    alignItems: "center",
    marginBottom: 4,
  },
  plate: {
    width: 210,
    height: 10,
    borderRadius: 5,
    backgroundColor: "rgba(0,0,0,0.06)",
  },
  bunBottom: {
    width: 156,
    height: 26,
    marginTop: 2,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    backgroundColor: BUN,
    borderBottomWidth: 4,
    borderBottomColor: BUN_CRUST,
  },
  bunTop: {
    width: 160,
    height: 46,
    borderTopLeftRadius: 80,
    borderTopRightRadius: 80,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    backgroundColor: BUN,
    borderTopWidth: 3,
    borderTopColor: BUN_CRUST,
  },
  seed: {
    position: "absolute",
    width: 7,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#FFF4DC",
  },
  filling: {
    height: 15,
    marginTop: 2,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  fillingLabel: {
    color: "rgba(255,255,255,0.95)",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    fontFamily: F,
  },
  steam: {
    width: 0,
    height: 6,
  },
  wisp: {
    position: "absolute",
    left: -3,
    bottom: 0,
    width: 6,
    height: 22,
    borderRadius: 3,
    backgroundColor: "rgba(0,0,0,0.12)",
  },
  tracker: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 26,
  },
  trackerLine: {
    width: 36,
    height: 2,
    marginTop: 8,
    borderRadius: 1,
    backgroundColor: "rgba(0,0,0,0.10)",
  },
  trackerLineOn: {
    backgroundColor: GENERATING_FG,
  },
  stepItem: {
    alignItems: "center",
    width: 64,
  },
  stepDotWrap: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  stepRing: {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: GENERATING_FG,
  },
  stepDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.10)",
  },
  stepDotOn: {
    backgroundColor: GENERATING_FG,
  },
  stepLabel: {
    marginTop: 6,
    color: "rgba(0,0,0,0.35)",
    fontSize: 12,
    fontWeight: "700",
    fontFamily: F,
  },
  stepLabelOn: {
    color: GENERATING_FG,
  },
  quip: {
    marginTop: 8,
    textAlign: "center",
    color: "rgba(0,0,0,0.42)",
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "600",
    fontFamily: F,
  },
  footer: {
    position: "absolute",
    left: 32,
    right: 32,
    alignItems: "center",
  },
  clock: {
    color: "rgba(0,0,0,0.55)",
    fontSize: 13,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    fontFamily: F,
  },
  stage: {
    marginTop: 22,
    textAlign: "center",
    color: GENERATING_FG,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
    fontFamily: F,
  },
  hint: {
    marginTop: 6,
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
