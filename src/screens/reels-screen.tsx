import Ionicons from "@expo/vector-icons/Ionicons";
import { usePrivy } from "@privy-io/expo";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type ViewToken,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AssetLogo } from "@/components/asset-logo";
import {
  SandwichShareSheet,
  type SandwichShareSheetRef,
} from "@/components/sandwich-share-sheet";
import {
  YouTubeClipPlayer,
  type YouTubeClipPlayerHandle,
} from "@/components/youtube-clip-player";
import { Fonts } from "@/constants/theme";
import {
  appUserPayloadFromPrivyUser,
  getCachedPosts,
  getPostPage,
  setCardLike,
  type Sandwich,
  type SandwichLeg,
  type SandwichPost,
} from "@/lib/api";
import {
  applyCardSocialToPosts,
  cardSocial,
  POST_COMMENTS_ENABLED,
  toggledCardSocial,
} from "@/lib/card-social";
import { formatTimestamp, getMomentWindow, momentCaption, type MomentWindow } from "@/lib/moment";
import {
  formatCardCount,
  formatCardPnl,
  formatLegSide,
  getBuilderMeta,
  getBuilderTake,
  getLegPrimaryLine,
  getSourceVideo,
  LIKE_PINK,
  type SourceVideo,
} from "@/lib/sandwich-feed";
import { useSandwichDetail } from "@/lib/sandwich-detail-store";
import { getAnonymousSocialId } from "@/lib/social-identity";
import { fetchCaptions } from "@/lib/youtube-captions";
import { useToast } from "@/lib/toast-store";

/**
 * Video sandwiches, one call per screen.
 *
 * Only cards built from a YouTube source make it in — a reel with nothing
 * moving in it is a slide. An episode is N calls on one card, and each call is
 * its own page here, playing the clip from the moment it was made. Consecutive
 * pages of one episode reuse the card's likes, because there is one set of them.
 *
 * The cards come off the same `/api/posts` cursor the For You list reads, so a
 * like here and a like there are the same write. Buying routes through the
 * detail screen: it is the one buy surface with the wallet/cash providers wired
 * and proven.
 */

const F = Fonts.rounded;
const F_DISPLAY = Fonts.display;
const PAGE_SIZE = 20;
/** Keep paging past text-only cards until at least this many reels are queued. */
const MIN_REELS_AHEAD = 4;
/** …but never chain more requests than this for one top-up. */
const MAX_PAGES_PER_TOPUP = 5;

const INK = "#0b0b0f";
const UP = "#35F046";
const DOWN = "#FF1F4B";
const CYAN = "#38BDF8";

type Reel = {
  key: string;
  post: SandwichPost;
  sandwich: Sandwich;
  video: SourceVideo;
  moment: MomentWindow | null;
  /** 1-based position of this call within its episode, and the episode's size. */
  callIndex: number;
  callCount: number;
};

/** One reel per call on every video card; text-only cards are dropped. */
function buildReels(posts: SandwichPost[]): Reel[] {
  const reels: Reel[] = [];
  for (const post of posts) {
    const lead = post.sandwiches[0];
    const video = lead ? getSourceVideo(lead) : null;
    if (!video) continue;
    // Calls in the order they were said, so swiping down walks the episode.
    const calls = post.sandwiches
      .map((sandwich) => ({ sandwich, moment: getMomentWindow(sandwich) }))
      .sort((a, b) => (a.moment?.startMs ?? 0) - (b.moment?.startMs ?? 0));
    calls.forEach(({ sandwich, moment }, index) => {
      reels.push({
        key: `${post.id}:${sandwich.id}`,
        post,
        sandwich,
        video,
        moment,
        callIndex: index + 1,
        callCount: calls.length,
      });
    });
  }
  return reels;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)}d`;
  return `${Math.floor(seconds / (86400 * 7))}w`;
}

function pnlTint(value: number | null) {
  if (value === null || value === 0) return "#FFFFFF";
  return value > 0 ? UP : DOWN;
}

function thumbnailFor(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

// ─── Captions ────────────────────────────────────────────────────────────────

type CaptionLine = { startMs: number; endMs: number; text: string };

/** One fetch per video for the life of the app — episodes repeat down the pager. */
const captionCache = new Map<string, Promise<CaptionLine[] | null>>();

function loadCaptions(videoId: string): Promise<CaptionLine[] | null> {
  let pending = captionCache.get(videoId);
  if (!pending) {
    pending = fetchCaptions(videoId).then((segments) => {
      if (!segments) return null;
      // youtube-transcript reports srv3 tracks in ms and classic tracks in
      // fractional seconds, with nothing on the row to say which.
      const inSeconds =
        segments.some((seg) => !Number.isInteger(seg.offset) || !Number.isInteger(seg.duration)) ||
        segments.every((seg) => seg.duration < 60);
      const scale = inSeconds ? 1000 : 1;
      const lines = segments
        .map((seg) => ({
          startMs: Math.round(seg.offset * scale),
          endMs: Math.round((seg.offset + seg.duration) * scale),
          text: seg.text
            .replace(/\s+/g, " ")
            .replace(/\[(music|applause|laughter)\]/gi, "")
            .trim(),
        }))
        .filter((line) => line.text.length > 0)
        .sort((a, b) => a.startMs - b.startMs);
      return lines.length > 0 ? lines : null;
    });
    // A miss is not cached forever — the next time the video comes round, retry.
    void pending.then((lines) => {
      if (!lines) captionCache.delete(videoId);
    });
    captionCache.set(videoId, pending);
  }
  return pending;
}

function useCaptions(videoId: string, enabled: boolean): CaptionLine[] | null {
  const [lines, setLines] = useState<CaptionLine[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadCaptions(videoId).then((next) => {
      if (!cancelled) setLines(next);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, videoId]);
  return lines;
}

/** Index of the last line that has started by `ms`, or -1. */
function lineAt(lines: CaptionLine[], ms: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].startMs <= ms) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

type CaptionStripHandle = { setTime: (ms: number) => void };

/**
 * Live captions, under the clip rather than burned over it. Owns its own clock
 * so the 4Hz time ticks re-render two lines of text, not the whole page.
 */
const CaptionStrip = forwardRef<CaptionStripHandle, { lines: CaptionLine[]; startMs: number }>(
  function CaptionStrip({ lines, startMs }, ref) {
    const [index, setIndex] = useState(() => Math.max(0, lineAt(lines, startMs)));
    useImperativeHandle(
      ref,
      () => ({
        setTime: (ms: number) => {
          const next = lineAt(lines, ms);
          if (next >= 0) setIndex((current) => (current === next ? current : next));
        },
      }),
      [lines],
    );

    const current = lines[index];
    const previous = index > 0 ? lines[index - 1] : null;
    if (!current) return null;
    return (
      <View style={styles.captions} pointerEvents="none">
        {previous ? (
          <Text style={styles.captionPrev} numberOfLines={1}>
            {previous.text}
          </Text>
        ) : null}
        <Animated.Text
          key={index}
          entering={FadeIn.duration(140)}
          style={styles.captionLine}
          numberOfLines={2}
        >
          {current.text}
        </Animated.Text>
      </View>
    );
  },
);

// ─── Leg chip ────────────────────────────────────────────────────────────────

const LegChip = memo(function LegChip({ leg }: { leg: SandwichLeg }) {
  const ticker = getLegPrimaryLine(leg);
  const side = formatLegSide(leg);
  return (
    <View style={styles.legChip}>
      <AssetLogo
        uri={leg.imageUrl}
        size={22}
        backgroundColor="rgba(255,255,255,0.12)"
        fallback={
          <View style={styles.legLogoFallback}>
            <Text style={styles.legLogoLetter}>{ticker.slice(0, 1).toUpperCase()}</Text>
          </View>
        }
      />
      <Text style={styles.legTicker} numberOfLines={1}>
        {ticker}
      </Text>
      {side ? <Text style={styles.legSide}>{side}</Text> : null}
      {leg.pnlPct !== null ? (
        <Text style={[styles.legPnl, { color: pnlTint(leg.pnlPct) }]}>
          {formatCardPnl(leg.pnlPct)}
        </Text>
      ) : null}
    </View>
  );
});

// ─── Action rail button ──────────────────────────────────────────────────────

function RailButton({
  icon,
  label,
  color = "#FFFFFF",
  onPress,
  accessibilityLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label?: string;
  color?: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      onPressIn={() => {
        scale.value = withTiming(0.86, { duration: 90 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 12, stiffness: 320 });
      }}
      onPress={onPress}
      style={styles.railButton}
    >
      <Animated.View style={animated}>
        <Ionicons name={icon} size={34} color={color} style={styles.railIconShadow} />
      </Animated.View>
      {label !== undefined ? <Text style={styles.railLabel}>{label}</Text> : null}
    </Pressable>
  );
}

// ─── One page ────────────────────────────────────────────────────────────────

type ReelPageProps = {
  reel: Reel;
  height: number;
  width: number;
  active: boolean;
  /** Within a page of the active one: load the player paused so a swipe lands on a warm embed. */
  preload: boolean;
  muted: boolean;
  topInset: number;
  bottomInset: number;
  onToggleMuted: () => void;
  onToggleLike: (sandwich: Sandwich, forceLike?: boolean) => void;
  onOpen: (sandwich: Sandwich) => void;
  onComment: (sandwich: Sandwich) => void;
  onShare: (sandwich: Sandwich) => void;
};

const ReelPage = memo(function ReelPage({
  reel,
  height,
  width,
  active,
  preload,
  muted,
  topInset,
  bottomInset,
  onToggleMuted,
  onToggleLike,
  onOpen,
  onComment,
  onShare,
}: ReelPageProps) {
  const { post, sandwich, video, moment } = reel;
  const social = cardSocial(post.sandwiches);
  const caption = momentCaption(sandwich);
  const builder = getBuilderMeta(sandwich);
  const pnl = sandwich.pnlPct;
  const isPerpBasis = sandwich.pnlBasis === "underlying_move";
  const legs = sandwich.legs.slice(0, 4);
  const hiddenLegs = sandwich.legs.length - legs.length;
  const thumbnail = thumbnailFor(video.videoId);
  const videoHeight = Math.round((width * 9) / 16);

  // ── Player ──
  const playerRef = useRef<YouTubeClipPlayerHandle>(null);
  const [playing, setPlaying] = useState(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // Neighbours boot paused at their moment; the swipe that makes one active
  // is what starts it. Booting the IFrame API is the slow part, and by now it
  // has already happened. `seek` queues itself if the embed isn't ready yet.
  useEffect(() => {
    if (active) {
      playerRef.current?.seek(moment?.startMs ?? 0, moment?.endMs ?? null);
    } else {
      setPlaying(false);
      playerRef.current?.pause();
    }
  }, [active, moment]);

  const lines = useCaptions(video.videoId, preload);
  const captionRef = useRef<CaptionStripHandle>(null);
  const onTime = useCallback((ms: number) => captionRef.current?.setTime(ms), []);

  // Sound is one setting for the whole pager, like a reel app: whatever the
  // viewer chose last carries onto the next clip.
  useEffect(() => {
    if (playing) playerRef.current?.setMuted(muted);
  }, [muted, playing]);

  const onPlayerState = useCallback(
    (state: "playing" | "paused" | "ended") => {
      if (state === "playing") {
        setPlaying(true);
        // Every (re)start goes through the embed's clip loader, which grabs
        // sound on its own — so re-assert the viewer's choice each time.
        playerRef.current?.setMuted(mutedRef.current);
      } else if (state === "ended") {
        // Loop the call, like a reel does.
        playerRef.current?.seek(moment?.startMs ?? 0, moment?.endMs ?? null);
      }
    },
    [moment],
  );

  // ── Gestures: single tap toggles sound, double tap likes ──
  const burstX = useSharedValue(0);
  const burstY = useSharedValue(0);
  const burstScale = useSharedValue(0);
  const burstOpacity = useSharedValue(0);
  const burstStyle = useAnimatedStyle(() => ({
    opacity: burstOpacity.value,
    transform: [
      { translateX: burstX.value - 55 },
      { translateY: burstY.value - 55 },
      { scale: burstScale.value },
      { rotate: `${(1 - burstScale.value) * -18}deg` },
    ],
  }));

  const likeFromDoubleTap = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onToggleLike(sandwich, true);
  }, [onToggleLike, sandwich]);

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(260)
    .onEnd((event, success) => {
      if (!success) return;
      burstX.value = event.x;
      burstY.value = event.y;
      burstScale.value = 0.2;
      burstOpacity.value = 1;
      burstScale.value = withSequence(
        withSpring(1.15, { damping: 9, stiffness: 260 }),
        withTiming(1, { duration: 120 }),
      );
      burstOpacity.value = withDelay(520, withTiming(0, { duration: 260 }));
      runOnJS(likeFromDoubleTap)();
    });
  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd((_event, success) => {
      if (success) runOnJS(onToggleMuted)();
    });
  const taps = Gesture.Exclusive(doubleTap, singleTap);

  const heartScale = useSharedValue(1);
  const likedOnMount = useRef(social.viewerHasLiked);
  useEffect(() => {
    if (likedOnMount.current === social.viewerHasLiked) return;
    likedOnMount.current = social.viewerHasLiked;
    heartScale.value = withSequence(
      withTiming(1.25, { duration: 110, easing: Easing.out(Easing.quad) }),
      withSpring(1, { damping: 10, stiffness: 300 }),
    );
  }, [heartScale, social.viewerHasLiked]);
  const heartStyle = useAnimatedStyle(() => ({ transform: [{ scale: heartScale.value }] }));

  const accent = pnlTint(pnl);
  const quote = caption?.text ?? (getBuilderTake(sandwich) || sandwich.name);

  return (
    <View style={[styles.page, { height }]}>
      {/* Backdrop: the episode still, blurred out to the edges. */}
      <Image
        source={{ uri: thumbnail }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        blurRadius={36}
      />
      <LinearGradient
        colors={["rgba(11,11,15,0.6)", "rgba(11,11,15,0.45)", "rgba(11,11,15,0.96)"]}
        locations={[0, 0.4, 0.75]}
        style={StyleSheet.absoluteFill}
      />

      {/* The clip. Only the page on screen and its neighbours mount a player —
          every WebView is a whole browser, and a pager full of them would sink
          the scroll. */}
      <View style={[styles.videoFrame, { top: topInset + 64, height: videoHeight }]}>
        {preload ? (
          <YouTubeClipPlayer
            ref={playerRef}
            videoId={video.videoId}
            initialStartMs={moment?.startMs ?? 0}
            initialEndMs={moment?.endMs ?? null}
            autoplay={false}
            hideControls
            onTime={onTime}
            posterUri={thumbnail}
            onStateChange={onPlayerState}
            renderFallback={() => (
              <Image source={{ uri: thumbnail }} style={StyleSheet.absoluteFill} contentFit="cover" />
            )}
          />
        ) : (
          <Image source={{ uri: thumbnail }} style={StyleSheet.absoluteFill} contentFit="cover" />
        )}
      </View>

      {lines ? (
        <View style={[styles.captionsWrap, { top: topInset + 64 + videoHeight + 12 }]}>
          <CaptionStrip ref={captionRef} lines={lines} startMs={moment?.startMs ?? 0} />
        </View>
      ) : null}

      {/* Tap layer over everything but the rail and CTA. Sits above the
          WebView so YouTube never sees a touch. */}
      <GestureDetector gesture={taps}>
        <View style={StyleSheet.absoluteFill}>
          <View style={[styles.body, { paddingBottom: bottomInset + 92 }]}>
            <View style={styles.metaRow}>
              {moment ? (
                <View style={styles.momentPill}>
                  <Ionicons name="play" size={10} color="#FFFFFF" />
                  <Text style={styles.momentText}>{formatTimestamp(moment.startMs)}</Text>
                </View>
              ) : null}
              {reel.callCount > 1 ? (
                <Text style={styles.callCount}>
                  Call {reel.callIndex} of {reel.callCount}
                </Text>
              ) : null}
            </View>

            <View>
              <Text style={[styles.pnlHeadline, { color: accent }]}>{formatCardPnl(pnl)}</Text>
              <Text style={styles.pnlCaption}>
                {isPerpBasis ? "underlying move since the call" : "since the call"}
              </Text>
            </View>

            {/* The live captions already carry what was said; the quote is
                the fallback when the video has none. */}
            {lines ? null : (
              <Text style={styles.quote} numberOfLines={3}>
                {caption ? `“${quote}”` : quote}
              </Text>
            )}

            <View style={styles.legRow}>
              {legs.map((leg) => (
                <LegChip key={leg.id} leg={leg} />
              ))}
              {hiddenLegs > 0 ? (
                <View style={styles.legChip}>
                  <Text style={styles.legTicker}>+{hiddenLegs}</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.byline}>
              {video.channelAvatarUrl ? (
                <Image source={{ uri: video.channelAvatarUrl }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Ionicons name="logo-youtube" size={16} color="#FFFFFF" />
                </View>
              )}
              <View style={styles.bylineText}>
                <Text style={styles.handle} numberOfLines={1}>
                  {video.channelName ?? "YouTube"}
                  <Text style={styles.time}>  · {timeAgo(post.publishedAt ?? post.createdAt)}</Text>
                </Text>
                <Text style={styles.via} numberOfLines={1}>
                  {video.title}
                  {builder ? `  ·  built by @${builder.name}` : ""}
                </Text>
              </View>
            </View>
          </View>

          <Animated.View pointerEvents="none" style={[styles.burst, burstStyle]}>
            <Ionicons name="heart" size={110} color={LIKE_PINK} />
          </Animated.View>
        </View>
      </GestureDetector>

      {/* Sound state, top-right of the clip. */}
      {active && playing ? (
        <Animated.View
          entering={FadeIn.duration(160)}
          exiting={FadeOut.duration(160)}
          pointerEvents="none"
          style={[styles.soundBadge, { top: topInset + 64 + videoHeight - 40 }]}
        >
          <Ionicons name={muted ? "volume-mute" : "volume-high"} size={15} color="#FFFFFF" />
          {muted ? <Text style={styles.soundText}>Tap for sound</Text> : null}
        </Animated.View>
      ) : null}

      {/* Right rail */}
      <View style={[styles.rail, { bottom: bottomInset + 120 }]}>
        <Animated.View style={heartStyle}>
          <RailButton
            icon={social.viewerHasLiked ? "heart" : "heart-outline"}
            color={social.viewerHasLiked ? LIKE_PINK : "#FFFFFF"}
            label={formatCardCount(social.likeCount)}
            accessibilityLabel={social.viewerHasLiked ? "Unlike" : "Like"}
            onPress={() => onToggleLike(sandwich)}
          />
        </Animated.View>
        {POST_COMMENTS_ENABLED ? (
          <RailButton
            icon="chatbubble-ellipses"
            label={formatCardCount(social.commentCount)}
            accessibilityLabel="Comments"
            onPress={() => onComment(sandwich)}
          />
        ) : null}
        <RailButton
          icon="paper-plane"
          label="Share"
          accessibilityLabel="Share"
          onPress={() => onShare(sandwich)}
        />
        <RailButton
          icon="stats-chart"
          label="Chart"
          accessibilityLabel="Open details"
          onPress={() => onOpen(sandwich)}
        />
      </View>

      {/* Buy CTA */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Buy this call"
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onOpen(sandwich);
        }}
        style={({ pressed }) => [styles.cta, { bottom: bottomInset + 18 }, pressed && styles.ctaPressed]}
      >
        <Text style={styles.ctaText}>🥪  Buy this call</Text>
      </Pressable>
    </View>
  );
});

// ─── Screen ──────────────────────────────────────────────────────────────────

export function ReelsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user } = usePrivy();
  const appUser = useMemo(() => appUserPayloadFromPrivyUser(user), [user]);
  const toast = useToast();
  const sandwichDetail = useSandwichDetail();
  const shareSheetRef = useRef<SandwichShareSheetRef>(null);

  const [anonymousId, setAnonymousId] = useState<string | null>(null);
  // Every card paged in, text-only ones included: likes are written back onto
  // this list, and the cursor walks it. The reels are derived from it.
  const [posts, setPosts] = useState<SandwichPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageHeight, setPageHeight] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  // Sound on by default; the embed falls back to muted if iOS refuses.
  const [muted, setMuted] = useState(false);
  const loadingMoreRef = useRef(false);

  const reels = useMemo(() => buildReels(posts), [posts]);

  useEffect(() => {
    let cancelled = false;
    void getAnonymousSocialId(appUser?.privyUserId).then((value) => {
      if (!cancelled) setAnonymousId(value);
    });
    return () => {
      cancelled = true;
    };
  }, [appUser?.privyUserId]);

  /**
   * Page the feed until enough video cards are queued. Video cards are a slice
   * of the feed, so a single page can hold none — stopping there would show an
   * empty pager over a feed that has plenty further down.
   */
  const fetchUntilReels = useCallback(
    async (startCursor: string | null, existing: SandwichPost[], wantReels: number) => {
      let rows = existing;
      let next = startCursor;
      let more = true;
      const baseline = buildReels(existing).length;
      for (let i = 0; i < MAX_PAGES_PER_TOPUP; i++) {
        const page = await getPostPage(PAGE_SIZE, next, null, anonymousId);
        const seen = new Set(rows.map((post) => post.id));
        rows = [...rows, ...page.posts.filter((post) => !seen.has(post.id))];
        next = page.nextCursor;
        more = next !== null;
        if (!more || buildReels(rows).length - baseline >= wantReels) break;
      }
      return { rows, cursor: next, more };
    },
    [anonymousId],
  );

  const loadFirstPage = useCallback(async () => {
    if (!anonymousId) return;
    const cached = getCachedPosts(PAGE_SIZE, null, anonymousId);
    if (cached && buildReels(cached).length > 0) {
      setPosts(cached);
      setLoading(false);
    }
    setError(null);
    try {
      const result = await fetchUntilReels(null, [], MIN_REELS_AHEAD);
      setPosts(result.rows);
      setCursor(result.cursor);
      setHasMore(result.more);
    } catch (err) {
      if (!cached) setError(err instanceof Error ? err.message : "Couldn't load videos.");
    } finally {
      setLoading(false);
    }
  }, [anonymousId, fetchUntilReels]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || !hasMore || !cursor || !anonymousId) return;
    loadingMoreRef.current = true;
    void fetchUntilReels(cursor, posts, MIN_REELS_AHEAD)
      .then((result) => {
        setPosts(result.rows);
        setCursor(result.cursor);
        setHasMore(result.more);
      })
      .catch(() => {
        // The next swipe toward the end retries.
      })
      .finally(() => {
        loadingMoreRef.current = false;
      });
  }, [anonymousId, cursor, fetchUntilReels, hasMore, posts]);

  // Top up as the viewer nears the end of what's queued.
  useEffect(() => {
    if (reels.length > 0 && activeIndex >= reels.length - 3) loadMore();
  }, [activeIndex, loadMore, reels.length]);

  /** Same optimistic card-like the For You list does. `forceLike` is the double tap: it only ever likes. */
  const handleToggleLike = useCallback(
    async (sandwich: Sandwich, forceLike = false) => {
      if (!anonymousId) return;
      const before = cardSocial([sandwich]);
      if (forceLike && before.viewerHasLiked) return;
      if (!forceLike) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const optimistic = toggledCardSocial(before);
      setPosts((current) => applyCardSocialToPosts(current, sandwich, optimistic));
      try {
        const updated = await setCardLike(sandwich, optimistic.viewerHasLiked, anonymousId);
        setPosts((current) => applyCardSocialToPosts(current, sandwich, updated));
      } catch (err) {
        setPosts((current) => applyCardSocialToPosts(current, sandwich, before));
        toast.showToast(err instanceof Error ? err.message : "Couldn't like that.", "error");
      }
    },
    [anonymousId, toast],
  );

  const applyUpdatedSandwich = useCallback((updated: Sandwich) => {
    setPosts((current) =>
      current.map((post) =>
        post.sandwiches.some((item) => item.id === updated.id)
          ? {
              ...post,
              sandwiches: post.sandwiches.map((item) => (item.id === updated.id ? updated : item)),
            }
          : post,
      ),
    );
  }, []);

  const handleOpen = useCallback(
    (sandwich: Sandwich) => sandwichDetail.open(sandwich, { onUpdated: applyUpdatedSandwich }),
    [sandwichDetail, applyUpdatedSandwich],
  );
  const handleComment = useCallback(
    (sandwich: Sandwich) =>
      sandwichDetail.open(sandwich, { onUpdated: applyUpdatedSandwich, showComments: true }),
    [sandwichDetail, applyUpdatedSandwich],
  );
  const handleShare = useCallback((sandwich: Sandwich) => {
    shareSheetRef.current?.open(sandwich);
  }, []);
  const toggleMuted = useCallback(() => {
    void Haptics.selectionAsync();
    setMuted((value) => !value);
  }, []);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0];
      if (first?.index != null) setActiveIndex(first.index);
    },
  ).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setPageHeight(Math.round(event.nativeEvent.layout.height));
  }, []);

  const renderItem = useCallback(
    ({ item, index }: { item: Reel; index: number }) => (
      <ReelPage
        reel={item}
        height={pageHeight}
        width={width}
        active={index === activeIndex}
        preload={Math.abs(index - activeIndex) <= 1}
        muted={muted}
        topInset={insets.top}
        bottomInset={insets.bottom}
        onToggleMuted={toggleMuted}
        onToggleLike={handleToggleLike}
        onOpen={handleOpen}
        onComment={handleComment}
        onShare={handleShare}
      />
    ),
    [
      pageHeight,
      width,
      activeIndex,
      muted,
      insets.top,
      insets.bottom,
      toggleMuted,
      handleToggleLike,
      handleOpen,
      handleComment,
      handleShare,
    ],
  );

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({ length: pageHeight, offset: pageHeight * index, index }),
    [pageHeight],
  );

  return (
    <View style={styles.screen} onLayout={onLayout}>
      <StatusBar style="light" />

      {pageHeight > 0 && reels.length > 0 ? (
        <FlatList
          data={reels}
          keyExtractor={(reel) => reel.key}
          renderItem={renderItem}
          getItemLayout={getItemLayout}
          pagingEnabled
          snapToInterval={pageHeight}
          snapToAlignment="start"
          decelerationRate="fast"
          disableIntervalMomentum
          showsVerticalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          initialNumToRender={2}
          maxToRenderPerBatch={3}
          windowSize={5}
          extraData={`${activeIndex}:${muted}`}
        />
      ) : loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#FFFFFF" />
        </View>
      ) : (
        <Animated.View entering={FadeIn.duration(200)} style={styles.center}>
          <Ionicons name="logo-youtube" size={36} color="rgba(255,255,255,0.5)" />
          <Text style={styles.emptyTitle}>{error ? "Couldn't load videos" : "No video sandwiches yet"}</Text>
          {error ? (
            <Pressable onPress={() => void loadFirstPage()} style={styles.retry}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          ) : null}
        </Animated.View>
      )}

      {/* Top chrome */}
      <View pointerEvents="box-none" style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={12}
          onPress={() => router.back()}
          style={styles.closeButton}
        >
          <Ionicons name="chevron-down" size={28} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.topTitle}>Clips</Text>
        <View style={styles.closeButton} />
      </View>

      <SandwichShareSheet ref={shareSheetRef} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: INK,
  },
  page: {
    width: "100%",
    overflow: "hidden",
    backgroundColor: INK,
  },
  videoFrame: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: "#000",
    overflow: "hidden",
  },
  body: {
    flex: 1,
    justifyContent: "flex-end",
    paddingLeft: 20,
    paddingRight: 84,
    gap: 12,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  momentPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  momentText: {
    fontFamily: F,
    fontWeight: "800",
    fontSize: 12,
    color: "#FFFFFF",
    fontVariant: ["tabular-nums"],
  },
  callCount: {
    fontFamily: F,
    fontWeight: "700",
    fontSize: 12,
    color: "rgba(255,255,255,0.6)",
  },
  pnlHeadline: {
    fontFamily: F_DISPLAY,
    fontSize: 52,
    lineHeight: 58,
    letterSpacing: -1.2,
    fontVariant: ["tabular-nums"],
  },
  pnlCaption: {
    fontFamily: F,
    fontWeight: "700",
    fontSize: 13,
    color: "rgba(255,255,255,0.6)",
    marginTop: -2,
  },
  quote: {
    fontFamily: F,
    fontWeight: "800",
    fontSize: 20,
    lineHeight: 27,
    color: "#FFFFFF",
  },
  legRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  legChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 5,
    paddingRight: 11,
    paddingVertical: 5,
    minHeight: 32,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
    maxWidth: "100%",
  },
  legLogoFallback: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  legLogoLetter: {
    fontFamily: F,
    fontWeight: "900",
    fontSize: 11,
    color: "#FFFFFF",
  },
  legTicker: {
    fontFamily: F,
    fontWeight: "800",
    fontSize: 13,
    color: "#FFFFFF",
    flexShrink: 1,
    paddingLeft: 2,
  },
  legSide: {
    fontFamily: F,
    fontWeight: "800",
    fontSize: 10,
    color: "rgba(255,255,255,0.6)",
    textTransform: "uppercase",
  },
  legPnl: {
    fontFamily: F,
    fontWeight: "800",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  byline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 2,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
  },
  avatarFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FF0033",
  },
  bylineText: {
    flex: 1,
    minWidth: 0,
  },
  handle: {
    fontFamily: F,
    fontWeight: "900",
    fontSize: 15,
    color: "#FFFFFF",
  },
  time: {
    fontWeight: "600",
    color: "rgba(255,255,255,0.55)",
  },
  via: {
    fontFamily: F,
    fontWeight: "600",
    fontSize: 12,
    color: "rgba(255,255,255,0.55)",
    marginTop: 1,
  },
  burst: {
    position: "absolute",
    left: 0,
    top: 0,
  },
  captionsWrap: {
    position: "absolute",
    left: 16,
    right: 16,
  },
  captions: {
    gap: 4,
  },
  captionPrev: {
    fontFamily: F,
    fontWeight: "700",
    fontSize: 14,
    lineHeight: 19,
    color: "rgba(255,255,255,0.4)",
  },
  captionLine: {
    fontFamily: F,
    fontWeight: "800",
    fontSize: 19,
    lineHeight: 25,
    color: "#FFFFFF",
  },
  soundBadge: {
    position: "absolute",
    right: 10,
    height: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 15,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  soundText: {
    fontFamily: F,
    fontWeight: "800",
    fontSize: 12,
    color: "#FFFFFF",
  },
  rail: {
    position: "absolute",
    right: 10,
    alignItems: "center",
    gap: 18,
  },
  railButton: {
    alignItems: "center",
    minWidth: 56,
  },
  railIconShadow: {
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowRadius: 6,
  },
  railLabel: {
    fontFamily: F,
    fontWeight: "800",
    fontSize: 12,
    color: "#FFFFFF",
    marginTop: 2,
    fontVariant: ["tabular-nums"],
  },
  cta: {
    position: "absolute",
    left: 16,
    right: 16,
    height: 54,
    borderRadius: 27,
    backgroundColor: CYAN,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: CYAN,
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
  },
  ctaPressed: {
    transform: [{ scale: 0.97 }],
    opacity: 0.92,
  },
  ctaText: {
    fontFamily: F,
    fontWeight: "900",
    fontSize: 17,
    color: "#FFFFFF",
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  topTitle: {
    fontFamily: F,
    fontWeight: "900",
    fontSize: 17,
    color: "#FFFFFF",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  emptyTitle: {
    fontFamily: F,
    fontWeight: "800",
    fontSize: 16,
    color: "#FFFFFF",
  },
  retry: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  retryText: {
    fontFamily: F,
    fontWeight: "800",
    fontSize: 14,
    color: "#FFFFFF",
  },
});
