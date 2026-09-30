import { usePrivy } from "@privy-io/expo";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FullWindowOverlay } from "react-native-screens";

import { Fonts, type ThemeColors } from "@/constants/theme";
import { useThemedStyles } from "@/hooks/use-themed-styles";
import { buildAllMomentSandwiches } from "@/lib/api";
import type { PodcastMoment, PodcastSourceStatus, Sandwich } from "@/lib/api";
import {
  clearComposerJob,
  clearComposerJobForSource as clearStoredComposerJobForSource,
  readComposerJob,
  saveComposerJob,
} from "@/lib/composer-job-store";
import { resumePodcastSpec } from "@/lib/podcast-job";
import { useSandwichComposer } from "@/lib/sandwich-composer-store";
import { useThemeStore } from "@/lib/theme-store";
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;

/**
 * What a finished composer job hands back. Both shapes are exactly what the
 * composer screen needs to land on its result view, so a job that completed
 * while the user was somewhere else can be adopted later without re-running the
 * pipeline.
 */
export type ComposerJobResult =
  | { kind: "sandwich"; sandwich: Sandwich }
  | { kind: "podcast"; source: PodcastSourceStatus; moments: PodcastMoment[] };

export type ComposerJobKind = ComposerJobResult["kind"];

export type ComposerJob = {
  id: number;
  kind: ComposerJobKind;
  /** Steady headline for the whole run, e.g. "Cooking your sandwich". */
  title: string;
  /** Live pipeline stage, e.g. "Listening to the podcast…". */
  stage: string;
  status: "running" | "ready" | "error";
  error: string | null;
  /**
   * When the WORK began, not this process. A job resumed at launch carries the
   * original paste's timestamp, so the banner can draw a bar that reflects how
   * long the episode has really been cooking.
   */
  startedAt: number;
  /**
   * Set once the job exists on the server and can be picked up again after the
   * app dies. Null for the whole life of a text thesis, which has no durable
   * id — losing that one is losing it.
   */
  resume: { sourceId: string } | null;
};

/**
 * Handed to `run` so it can announce the moment its work became durable.
 *
 * Opt-in on purpose: a spec that never calls `markDurable` is never persisted
 * and never resumed, which is exactly right for the text-thesis job.
 */
export type ComposerJobHandle = {
  signal: AbortSignal;
  markDurable: (input: {
    sourceId: string;
    title: string;
    readyStage: string;
    startedAtMs: number;
  }) => void;
};

export type RunSpec = {
  kind: ComposerJobKind;
  title: string;
  stage: string;
  /** Label the banner shows once the job lands. */
  readyStage: string;
  /** Age of the underlying work, for a resumed job. Defaults to now. */
  startedAtMs?: number;
  /** Pre-set for a resumed job: it is durable before it starts running. */
  resume?: { sourceId: string };
  run: (onStage: (stage: string) => void, handle: ComposerJobHandle) => Promise<ComposerJobResult>;
};

type ComposerProgressContextValue = {
  job: ComposerJob | null;
  /** The finished payload, waiting for the composer screen to pick it up. */
  result: ComposerJobResult | null;
  /**
   * Start the long pipeline. The work is awaited *here*, above the router, so
   * popping the composer screen mid-flight no longer strands it — the global
   * banner takes over and the result is held until the screen comes back.
   */
  runJob: (spec: RunSpec) => number;
  /** Drop the job (and its result) once the screen has adopted it. */
  clearJob: () => void;
  /** Drop only the live/persisted podcast job matching a notification tap. */
  clearJobForSource: (sourceId: string) => void;
  /** True while the composer screen is mounted, so the banner can stay out of its way. */
  composerVisible: boolean;
  setComposerVisible: (visible: boolean) => void;
  /**
   * Put the banner away without touching the job.
   *
   * Hiding is a display decision, not a cancellation: the episode keeps cooking
   * on the server and the push still lands. Anything that actually stops work
   * goes through {@link clearJob} instead.
   */
  hideBanner: () => void;
  /** True while the current job's banner is put away. */
  bannerHidden: boolean;
};

const ComposerProgressContext = createContext<ComposerProgressContextValue | null>(null);

let jobIdSeq = 1;

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Try again.";
}

/**
 * Owns the one in-flight "build me a sandwich" job, app-wide. The composer
 * screen starts it and reads it back; {@link ComposerProgressBanner} reports it
 * on every other screen the way Instagram reports an upload — a slim bar under
 * the status bar with a progress line, ending in an Open button.
 *
 * Mounted in `(app)/_layout` *inside* `SandwichComposerProvider`, because the
 * banner's Open button reopens the composer route through it.
 */
export function ComposerProgressProvider({ children }: { children: React.ReactNode }) {
  const [job, setJob] = useState<ComposerJob | null>(null);
  const [result, setResult] = useState<ComposerJobResult | null>(null);
  const [composerVisible, setComposerVisible] = useState(false);
  // The banner the user put away. Keyed by job id *and* status, so hiding the
  // "still cooking" bar does not also hide the "calls are ready" one that
  // replaces it — and a brand new job is always reported.
  const [hiddenKey, setHiddenKey] = useState<string | null>(null);
  // Only the newest job may write state; an abandoned one resolves into a void.
  const activeIdRef = useRef<number | null>(null);
  const activeSourceIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const dismissedSourceIdsRef = useRef<Set<string>>(new Set());
  const { user } = usePrivy();
  const privyUserId = user?.id ?? null;
  // Read in async callbacks that must not re-run when the identity object's
  // reference changes.
  const privyUserIdRef = useRef(privyUserId);
  privyUserIdRef.current = privyUserId;

  const runJob = useCallback((spec: RunSpec) => {
    abortControllerRef.current?.abort();
    const owner = privyUserIdRef.current;
    // Replacing the one allowed job abandons its old on-disk descriptor. The
    // new resumable spec queues its own save immediately after this clear.
    void clearComposerJob(owner);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const id = jobIdSeq++;
    activeIdRef.current = id;
    activeSourceIdRef.current = spec.resume?.sourceId ?? null;
    setResult(null);
    const startedAt = spec.startedAtMs ?? Date.now();
    setJob({
      id,
      kind: spec.kind,
      title: spec.title,
      stage: spec.stage,
      status: "running",
      error: null,
      startedAt,
      resume: spec.resume ?? null,
    });

    void (async () => {
      // The stage the job last reported, so a job persisted mid-flight is
      // resumed showing where it actually got to.
      let lastStage = spec.stage;
      let durable = spec.resume ?? null;

      const persist = () => {
        if (!durable) return;
        void saveComposerJob(owner, {
          v: 1,
          kind: "podcast",
          sourceId: durable.sourceId,
          title: spec.title,
          stage: lastStage,
          readyStage: spec.readyStage,
          startedAt: new Date(startedAt).toISOString(),
        });
      };
      persist();

      try {
        const value = await spec.run(
          (stage) => {
            if (activeIdRef.current !== id) return;
            lastStage = stage;
            persist();
            setJob((current) => (current && current.id === id ? { ...current, stage } : current));
          },
          {
            signal: controller.signal,
            markDurable: (input) => {
              if (activeIdRef.current !== id) return;
              durable = { sourceId: input.sourceId };
              activeSourceIdRef.current = input.sourceId;
              dismissedSourceIdsRef.current.delete(input.sourceId);
              void saveComposerJob(owner, {
                v: 1,
                kind: "podcast",
                sourceId: input.sourceId,
                title: input.title,
                stage: lastStage,
                readyStage: input.readyStage,
                startedAt: new Date(input.startedAtMs).toISOString(),
              });
              setJob((current) =>
                current && current.id === id
                  ? { ...current, resume: { sourceId: input.sourceId } }
                  : current,
              );
            },
          },
        );
        if (activeIdRef.current !== id) return;
        // Only the current job owns the one storage slot. A superseded job
        // resolving late must never clear the replacement's descriptor.
        void clearComposerJob(owner);
        abortControllerRef.current = null;
        setResult(value);
        setJob((current) =>
          current && current.id === id
            ? { ...current, status: "ready", stage: spec.readyStage }
            : current,
        );
      } catch (err) {
        if (activeIdRef.current !== id) return;
        void clearComposerJob(owner);
        abortControllerRef.current = null;
        setJob((current) =>
          current && current.id === id
            ? { ...current, status: "error", error: errorMessage(err) }
            : current,
        );
      }
    })();

    return id;
  }, []);

  const hideBanner = useCallback(() => {
    setJob((current) => {
      if (current) setHiddenKey(`${current.id}:${current.status}`);
      return current;
    });
  }, []);

  const bannerHidden = job !== null && hiddenKey === `${job.id}:${job.status}`;

  const clearJob = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    activeIdRef.current = null;
    activeSourceIdRef.current = null;
    setJob(null);
    setResult(null);
    void clearComposerJob(privyUserIdRef.current);
  }, []);

  const clearJobForSource = useCallback((sourceId: string) => {
    const owner = privyUserIdRef.current;
    dismissedSourceIdsRef.current.add(sourceId);
    void clearStoredComposerJobForSource(owner, sourceId);
    if (activeSourceIdRef.current !== sourceId) return;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    activeIdRef.current = null;
    activeSourceIdRef.current = null;
    setJob(null);
    setResult(null);
  }, []);

  /**
   * Build every call in a finished episode, wherever the user happens to be.
   *
   * This used to run on the composer screen, which meant the episode's markets
   * only existed once the user came back and sat through a preview of calls
   * that were about to be built regardless. Nothing was ever being decided
   * there, so the build moved here and the preview went away: the episode
   * finishes on its own and the push is what brings the user back to it.
   *
   * A run that produces nothing is not surfaced — the episode screen reports
   * what it finds, and the banner has already said the calls are ready.
   */
  const { appUser, notifyCreated } = useSandwichComposer();
  const builtSourcesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!result || result.kind !== "podcast") return;
    const sourceId = result.source.id;
    if (builtSourcesRef.current.has(sourceId)) return;
    builtSourcesRef.current.add(sourceId);
    void buildAllMomentSandwiches(sourceId, appUser)
      .then(({ sandwiches }) => {
        // The feed behind gets every new market, not just one.
        for (const entry of sandwiches) notifyCreated(entry.sandwich);
      })
      .catch(() => {});
  }, [appUser, notifyCreated, result]);

  /**
   * Adopt a job the app was killed in the middle of.
   *
   * The analysis kept running on the server the whole time, so this is a
   * re-attach, not a restart: no captions are refetched and no second pipeline
   * is started. Once per identity — the ref guard is against Privy handing back
   * a new user object for the same person, which must not launch a second
   * waiter against the same source.
   */
  const rehydratedForRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const owner = privyUserId;
    if (rehydratedForRef.current === owner) return;
    rehydratedForRef.current = owner;
    let cancelled = false;
    void (async () => {
      const stored = await readComposerJob(owner);
      // A job started in this session already owns the banner; the stored copy
      // is its own record, not a second job to run.
      if (
        cancelled ||
        !stored ||
        dismissedSourceIdsRef.current.has(stored.sourceId) ||
        activeIdRef.current !== null
      ) return;
      runJob(resumePodcastSpec(stored));
    })();
    return () => {
      cancelled = true;
    };
  }, [privyUserId, runJob]);

  const value = useMemo(
    () => ({
      job,
      result,
      runJob,
      clearJob,
      clearJobForSource,
      composerVisible,
      setComposerVisible,
      hideBanner,
      bannerHidden,
    }),
    [job, result, runJob, clearJob, clearJobForSource, composerVisible, hideBanner, bannerHidden],
  );

  return (
    <ComposerProgressContext.Provider value={value}>
      {children}
      <ComposerProgressBanner />
    </ComposerProgressContext.Provider>
  );
}

export function useComposerProgress(): ComposerProgressContextValue {
  const ctx = useContext(ComposerProgressContext);
  if (!ctx) {
    throw new Error("useComposerProgress must be used within a ComposerProgressProvider");
  }
  return ctx;
}

// ─── Banner ─────────────────────────────────────────────────────────────────

/** How long the creeping bar takes to reach its ceiling while work is running. */
const CREEP_MS = 75_000;
const CREEP_CEILING = 0.9;

function ComposerProgressBanner() {
  const ctx = useContext(ComposerProgressContext);
  const { reopen } = useSandwichComposer();
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const insets = useSafeAreaInsets();
  const enter = useSharedValue(0);
  const progress = useSharedValue(0);
  const [mounted, setMounted] = useState<ComposerJob | null>(null);
  const hapticRef = useRef<number | null>(null);
  // Stable for the gesture worklet, which runs off the JS thread.
  const hideBanner = ctx?.hideBanner;
  const hide = useCallback(() => {
    void Haptics.selectionAsync();
    hideBanner?.();
  }, [hideBanner]);

  const job = ctx?.job ?? null;
  const composerVisible = ctx?.composerVisible ?? false;
  // While the composer itself is up it shows the full-screen loading state, so
  // a second report of the same job on top of it would just be noise.
  //
  // `bannerHidden` is the user's own call — swiped up or closed. It puts the
  // bar away for this status only; the work carries on and the push still
  // arrives, and the next status brings the bar back with something new to say.
  const visible = job !== null && !composerVisible && !(ctx?.bannerHidden ?? false);

  useEffect(() => {
    if (visible && job) {
      setMounted(job);
      enter.value = withSpring(1, { damping: 20, stiffness: 240, mass: 0.8 });
    } else {
      enter.value = withTiming(0, { duration: 180 });
      const timer = setTimeout(() => setMounted(null), 200);
      return () => clearTimeout(timer);
    }
  }, [enter, job, visible]);

  // Keyed on the job identity, not the whole job: a stage label changing must
  // not restart the bar, while a *new* job must reset it from zero.
  const jobId = job?.id ?? null;
  const jobStatus = job?.status ?? null;
  const jobStartedAt = job?.startedAt ?? null;
  useEffect(() => {
    if (jobId === null) {
      progress.value = 0;
      return;
    }
    if (jobStatus === "running") {
      // Nothing reports real percentages back from the pipeline, so the bar
      // creeps toward a ceiling it never reaches and only completes on landing.
      //
      // Seeded from how long the WORK has been running, not this animation: a
      // job resumed after the app was killed for twenty minutes appears at the
      // ceiling and holds, which is honest. A bar restarting from zero would
      // claim the episode had started over, which it had not.
      const elapsed = Math.max(0, Date.now() - (jobStartedAt ?? Date.now()));
      const t = Math.min(1, elapsed / CREEP_MS);
      progress.value = CREEP_CEILING * (1 - (1 - t) * (1 - t)); // Easing.out(quad)
      progress.value = withTiming(CREEP_CEILING, {
        duration: Math.max(200, CREEP_MS - elapsed),
        easing: Easing.out(Easing.quad),
      });
    } else {
      progress.value = withTiming(1, { duration: 320 });
    }
  }, [jobId, jobStartedAt, jobStatus, progress]);

  useEffect(() => {
    if (!job || job.status === "running" || hapticRef.current === job.id) return;
    hapticRef.current = job.id;
    void Haptics.notificationAsync(
      job.status === "ready"
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Error,
    );
  }, [job]);

  const shellStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * -24 }],
  }));

  const barStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  // Flick it up to put it away — the same gesture the OS uses for a banner
  // notification, and the reason the whole card (not just the X) is draggable.
  const dragY = useSharedValue(0);
  const dismissGesture = Gesture.Pan()
    .onUpdate((event) => {
      dragY.value = Math.min(0, event.translationY);
    })
    .onEnd((event) => {
      if (event.translationY < -28 || event.velocityY < -600) {
        dragY.value = withTiming(-140, { duration: 160 }, (finished) => {
          if (finished) {
            dragY.value = 0;
            runOnJS(hide)();
          }
        });
        return;
      }
      dragY.value = withSpring(0, { damping: 22, stiffness: 300 });
    });

  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: dragY.value }] }));

  if (!mounted) return null;

  const current = job ?? mounted;
  const ready = current.status === "ready";
  const failed = current.status === "error";
  const openLabel = current.kind === "podcast" ? "Open calls" : "Open post";
  // A finished episode belongs to its own screen now, not to the composer: the
  // markets were built in the background, so there is nothing for the composer
  // to hand over. `sourceId` alone is enough — every market of an episode
  // shares one, and the episode screen rebuilds itself from it.
  const podcastSourceId =
    ctx?.result?.kind === "podcast" ? ctx.result.source.id : current.resume?.sourceId ?? null;

  const content = (
    <View style={[styles.host, { paddingTop: insets.top + 4 }]} pointerEvents="box-none">
      <GestureDetector gesture={dismissGesture}>
      <Animated.View style={[styles.card, shellStyle, dragStyle]}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={ready ? openLabel : current.title}
          disabled={!ready && !failed}
          onPress={() => {
            if (ready) {
              if (current.kind === "podcast") {
                if (podcastSourceId) {
                  router.push({
                    pathname: "/podcast-sandwich",
                    params: { sourceId: podcastSourceId },
                  });
                }
                ctx?.clearJob();
                return;
              }
              reopen();
              return;
            }
            if (failed) ctx?.clearJob();
          }}
          style={styles.row}
        >
          <View
            style={[
              styles.badge,
              ready && { backgroundColor: colors.positive },
              failed && { backgroundColor: colors.negative },
            ]}
          >
            {current.status === "running" ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Ionicons
                name={ready ? "checkmark" : "alert"}
                size={20}
                color={colors.textInverse}
              />
            )}
          </View>

          <View style={styles.textCol}>
            <Text style={styles.title} numberOfLines={1}>
              {failed ? "Couldn't build it" : current.title}
            </Text>
            <Text style={styles.stage} numberOfLines={1}>
              {failed ? current.error ?? "Try again." : current.stage}
            </Text>
          </View>

          {ready ? (
            <View style={styles.openButton}>
              <Text style={styles.openLabel}>{openLabel}</Text>
            </View>
          ) : failed ? (
            <Ionicons name="close" size={20} color={colors.iconMuted} />
          ) : (
            // Keeps the one-line stage text clear of the hide control, which is
            // absolutely positioned so it stays outside this Pressable.
            <View style={styles.hideSpacer} />
          )}
        </PressableScale>

        {/* Hiding is not cancelling — the episode keeps cooking either way, so
            this sits outside the row's press target and never clears the job.
            Only offered while the work is running: a landed job is dismissed by
            opening it, and either one can still be flicked away. */}
        {current.status === "running" && (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Hide"
            hitSlop={10}
            onPress={hide}
            style={styles.hideButton}
          >
            <Ionicons name="close" size={15} color={colors.iconMuted} />
          </PressableScale>
        )}

        <View style={styles.track}>
          <Animated.View
            style={[
              styles.bar,
              barStyle,
              failed && { backgroundColor: colors.negative },
              ready && { backgroundColor: colors.positive },
            ]}
          />
        </View>
      </Animated.View>
      </GestureDetector>
    </View>
  );

  // Same reasoning as the toast host: gorhom sheets portal above this provider,
  // so on iOS the banner has to ride in a FullWindowOverlay to stay on top.
  return Platform.OS === "ios" ? <FullWindowOverlay>{content}</FullWindowOverlay> : content;
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    host: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 99998,
      alignItems: "center",
      paddingHorizontal: 12,
      pointerEvents: "box-none",
    },
    card: {
      width: "100%",
      maxWidth: 440,
      borderRadius: 20,
      overflow: "hidden",
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      shadowColor: c.shadow,
      shadowOpacity: 0.18,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 18,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    badge: {
      width: 38,
      height: 38,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surfaceAlt,
    },
    textCol: {
      flex: 1,
      minWidth: 0,
      gap: 1,
    },
    title: {
      color: c.text,
      fontSize: 15,
      fontWeight: "800",
      fontFamily: F,
      letterSpacing: -0.2,
    },
    stage: {
      color: c.textSecondary,
      fontSize: 13,
      fontWeight: "600",
      fontFamily: F,
    },
    openButton: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: c.actionPrimary,
    },
    openLabel: {
      color: c.actionPrimaryText,
      fontSize: 13,
      fontWeight: "800",
      fontFamily: F,
    },
    hideSpacer: {
      width: 22,
    },
    hideButton: {
      position: "absolute",
      top: 4,
      right: 4,
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: "center",
      justifyContent: "center",
    },
    track: {
      height: 3,
      width: "100%",
      backgroundColor: c.surfaceAlt,
    },
    bar: {
      height: 3,
      backgroundColor: c.actionPrimary,
    },
  });
