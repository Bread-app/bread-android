import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, LinearTransition, ReduceMotion } from 'react-native-reanimated';

import { AssetLogo as RemoteAssetLogo } from '@/components/asset-logo';
import type { Sandwich, SandwichLeg } from '@/lib/api';
import { youTubeWatchUrl } from '@/lib/api';
import { cardSocial } from '@/lib/card-social';
import { formatTimestamp, getMomentWindow } from '@/lib/moment';
import { callCaption, formatPct, marketTicker } from '@/lib/podcast-call-format';
import { YouTubeClipPlayer, type YouTubeClipPlayerHandle } from '@/components/youtube-clip-player';
import { PressableScale } from '@/components/pressable-scale';
import { ShareIcon } from '@/components/share-icon';
import { VerifiedBadge } from '@/components/verified-badge';
// Value import back into the screen module. Safe from a cycle: sandwich-screen's
// only reference here is `import { type PodcastGroupVideo }`, a type-only
// specifier that is erased before it reaches the bundler.
import { HeartToggle, type HeartToggleRef } from '@/components/heart-toggle';
import { HandleText } from '@/components/handle-text';
import { getCreatorMeta } from '@/lib/sandwich-feed';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemeStore } from '@/lib/theme-store';
import { useThemedStyles } from '@/hooks/use-themed-styles';

const F = Fonts.rounded;

/** Calls shown before the rest go behind "Show all" — two rows of the grid. */
const VISIBLE_CALLS = 4;

export type PodcastGroupVideo = {
  videoId: string;
  url: string;
  title: string;
  channelName: string | null;
  channelHandle: string | null;
  channelAvatarUrl: string | null;
  summary: string | null;
  publishedAt: string | null;
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Delegates to the shared AssetLogo, which also renders SVG. Many issuer logos
 * are served as `image/svg+xml` with no `.svg` suffix (Backpack Securities'
 * `/api/stock-logo/{SYMBOL}`), and RN's <Image> cannot decode those — SKHY and
 * DRAM showed as bare letters for exactly that reason.
 */
function AssetLogo({
  uri,
  letter,
  size = 42,
}: {
  uri: string | null;
  letter: string;
  size?: number;
}) {
  const styles = useThemedStyles(makeStyles);
  // 1pt of the diameter is the border the base style draws.
  const inner = size - 2;
  return (
    <View style={[styles.logo, { width: size, height: size, borderRadius: size / 2 }]}>
      <RemoteAssetLogo
        uri={uri}
        size={inner}
        fallback={
          <Text style={[styles.logoText, { fontSize: inner * 0.42 }]}>
            {letter.slice(0, 1).toUpperCase()}
          </Text>
        }
      />
    </View>
  );
}

/** A sandwich's legs in their authored order — the order the stack draws them. */
function orderedLegs(sandwich: Sandwich): SandwichLeg[] {
  return [...sandwich.legs].sort((a, b) => a.order - b.order);
}

/** Chronological by call — the order the episode happened in. */
function orderByTimestamp(sandwiches: Sandwich[]): Sandwich[] {
  return [...sandwiches].sort((a, b) => {
    const aMs = getMomentWindow(a)?.startMs ?? null;
    const bMs = getMomentWindow(b)?.startMs ?? null;
    if (aMs == null && bMs == null) return a.createdAt.localeCompare(b.createdAt);
    if (aMs == null) return 1;
    if (bMs == null) return -1;
    return aMs - bMs;
  });
}

/**
 * One tradeable position, and every moment the episode made it in.
 *
 * A card is what you act on, and what you act on is a position — so two
 * moments that resolve to the same instruments on the same side are ONE card.
 * Left as two, they read as two opportunities: the same asset twice, with two
 * slightly different returns (each entry is snapshotted at its own moment), and
 * nothing saying that taking both doubles a single position.
 */
export type CallGroup = {
  key: string;
  /** The moment the call was first made — whose entry, and so whose return, is
   *  the honest "since this was called". */
  lead: Sandwich;
  /** Every mention, chronological. Length 1 for most calls. */
  mentions: Sandwich[];
};

/**
 * Key a call by what trading it actually produces: its instruments and its
 * side. A basket keys on its whole leg set, so a lone NVDA call never merges
 * into a basket that happens to hold NVDA — those are different positions. A
 * long and a short on the same asset stay apart for the same reason: the
 * speaker changed their mind, and that is two trades, not one.
 */
function positionKey(sandwich: Sandwich): string {
  const legs = orderedLegs(sandwich)
    .map((leg) => (leg.underlyingSymbol ?? leg.symbol ?? leg.label ?? leg.mint ?? '').toUpperCase())
    .filter(Boolean)
    .sort()
    .join('+');
  return `${legs || sandwich.id}:${sandwich.direction === 'down' ? 'short' : 'long'}`;
}

function groupCalls(sandwiches: Sandwich[]): CallGroup[] {
  const byKey = new Map<string, Sandwich[]>();
  for (const sandwich of orderByTimestamp(sandwiches)) {
    const key = positionKey(sandwich);
    const existing = byKey.get(key);
    if (existing) existing.push(sandwich);
    else byKey.set(key, [sandwich]);
  }
  return [...byKey.entries()].map(([key, mentions]) => ({
    key,
    lead: mentions[0],
    mentions,
  }));
}

/**
 * Best-performing call first. An unpriced call has no claim on the top of the
 * grid, so nulls sink — and ties fall back to chronology, which keeps the order
 * stable rather than letting equal returns shuffle between renders.
 */
function orderByReturn(groups: CallGroup[]): CallGroup[] {
  return [...groups].sort((a, b) => {
    const aPct = a.lead.pnlPct;
    const bPct = b.lead.pnlPct;
    if (aPct == null && bPct == null) return 0;
    if (aPct == null) return 1;
    if (bPct == null) return -1;
    return bPct - aPct;
  });
}

function channelHandleLabel(video: PodcastGroupVideo): string {
  const handle = video.channelHandle ?? video.channelName ?? null;
  if (!handle) return 'YouTube';
  return handle.startsWith('@') ? handle : `@${handle}`;
}

/**
 * The whole episode, and the ONLY screen a YouTube-sourced call has: the
 * channel, the video, then every timestamp as its own market.
 *
 * Laid out as the sandwich detail is laid out, because it IS a sandwich detail:
 * creator, then the post's own words (here, the video title), then the media,
 * then a flat list of tappable rows. A call is one ROW — its timestamp, the
 * ticker and direction, and the caption it was made in — not a card: its
 * reasoning, its legs and their weights are one tap deeper.
 *
 * That tap does two things at once: the player above jumps to the moment and
 * starts playing, and the call's ASSET CARD opens over the screen — the same
 * card a leg opens on the sandwich detail screen. It replaced the Show More
 * that used to expand every call's reasoning inline at the bottom, which asked
 * the reader to match paragraphs back to rows themselves.
 *
 * Nothing here navigates — the row raises the call's sheet and the timestamp
 * seeks the player, both in place.
 *
 * There is deliberately no chart: this is a list of calls, not a position.
 */
export function PodcastSandwichDetail({
  video,
  sandwiches,
  focusSandwichId = null,
  onSelectCall,
  selectedSandwichId = null,
  onSeekRequested,
  onToggleLike,
  onComment,
  onBookmark,
  onShare,
  bookmarked = false,
}: {
  video: PodcastGroupVideo;
  sandwiches: Sandwich[];
  /**
   * The call the user arrived for — from a feed card, a share link or Saved,
   * all of which now land here rather than on a separate detail screen. Its
   * chip is highlighted and the player opens seeked to it.
   */
  focusSandwichId?: string | null;
  /**
   * Pick this call. The row also seeks the player above to the moment, so this
   * is only the selection half — the screen is what raises the action for it.
   */
  onSelectCall: (sandwich: Sandwich, replayMoment: (() => void) | null) => void;
  /** The call currently picked, which is the one the row outlines. */
  selectedSandwichId?: string | null;
  /**
   * A timestamp was tapped and the player is about to seek. The screen owns the
   * ScrollView, so it is what brings the player back into view.
   */
  onSeekRequested?: () => void;
  /**
   * Like/unlike the whole episode — every market it produced, matching the feed
   * card. Omit and the button is not rendered.
   */
  onToggleLike?: (sandwiches: Sandwich[]) => void;
  /** Open comments. Threads on the episode's first market, as the feed card does. */
  onComment?: (sandwich: Sandwich) => void;
  /**
   * Bookmark the episode. Receives the current state because a bookmark covers
   * every market — the caller flips the ones that disagree.
   */
  onBookmark?: (sandwiches: Sandwich[], bookmarked: boolean) => void;
  onShare?: (sandwich: Sandwich) => void;
  /** True only when EVERY market is saved, matching how the heart reads. */
  bookmarked?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  // Best return first, except the picked call is hoisted to the front. Tapping
  // a card also scrolls the player back into view, so the call being acted on
  // sits directly under the moment it was made in rather than wherever its
  // return happened to place it.
  // An episode can produce a dozen calls. Four is two rows of the grid — enough
  // to see what the episode was about without the list becoming the screen.
  const [allCallsShown, setAllCallsShown] = useState(false);

  const ordered = useMemo(() => {
    const byReturn = orderByReturn(groupCalls(sandwiches));
    if (!selectedSandwichId) return byReturn;
    const picked = byReturn.find((group) =>
      group.mentions.some((mention) => mention.id === selectedSandwichId),
    );
    if (!picked) return byReturn;
    return [picked, ...byReturn.filter((group) => group.key !== picked.key)];
  }, [sandwiches, selectedSandwichId]);
  // The picked call is hoisted to the front, so it is always inside the cap —
  // choosing one can never push it out of view.
  const visibleCalls = allCallsShown ? ordered : ordered.slice(0, VISIBLE_CALLS);
  const hiddenCallCount = ordered.length - visibleCalls.length;
  // The episode's byline is the BUILDER — the Bread user who pasted the video
  // and shipped these calls — matching the feed card that got you here. The
  // channel is still credited: it heads the video itself, right below. Only an
  // episode with no owning AppUser falls back to the channel handle.
  // Name and tap must name the same person. Each viewer who opens a call gets
  // their own Sandwich, so `sandwiches[0].builder` can be a stranger who merely
  // opened one (@royden shown, @bradvani opened) — the paster is `source.user`.
  const creator = sandwiches[0] ? getCreatorMeta(sandwiches[0]) : null;
  const displayHandle = creator ? `@${creator.name.replace(/^@+/, '')}` : channelHandleLabel(video);
  // The byline opens the builder's profile, the same as a sandwich detail's. An
  // unowned episode is bylined to the channel, which has no Bread profile.
  const router = useRouter();
  const creatorPrivyUserId = creator ? primaryCreatorId(sandwiches) : null;
  const openCreatorProfile = () => {
    if (!creatorPrivyUserId) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: '/user-profile', params: { id: creatorPrivyUserId } });
  };
  const publishedLabel = formatDate(video.publishedAt);
  const playerRef = useRef<YouTubeClipPlayerHandle>(null);
  // Which market is currently playing — highlights its chip. Null means nothing
  // has been tapped yet and the player is sitting on its poster.
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playerFailed, setPlayerFailed] = useState(false);
  // The episode summary sits at the bottom, collapsed — same Show More slot the
  // sandwich detail gives its thesis body.
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const heartRef = useRef<HeartToggleRef>(null);
  // Episode-level reaction state, read straight off the card. Every market
  // reports the same Post counts, so there is nothing to aggregate: the old
  // `max` undid a per-market like fan-out that no longer happens, and summing
  // comment counts would now show one thread once per market.
  const primary = sandwiches[0] ?? null;
  const { likeCount, commentCount, viewerHasLiked: liked } = cardSocial(sandwiches);
  // The focused call's window is baked into the player's first frame rather than
  // seeked afterwards, so arriving from a feed card lands ON the sentence
  // instead of at 0:00 and jumping.
  const focusWindow = useMemo(() => {
    if (!focusSandwichId) return null;
    const target = sandwiches.find((item) => item.id === focusSandwichId);
    return target ? getMomentWindow(target) : null;
  }, [focusSandwichId, sandwiches]);
  const openVideo = () => {
    void Linking.openURL(video.url).catch(() => {});
  };

  /**
   * Play the window a call was made in. `loadVideoById` + `playVideo` both
   * starts and seeks, so the first tap needs no separate "press play" step —
   * which is why the player can load paused and stay quiet until asked.
   */
  const playCall = (sandwich: Sandwich, window: { startMs: number; endMs: number | null }) => {
    if (playerFailed) {
      void Linking.openURL(youTubeWatchUrl(video.videoId, window.startMs)).catch(() => {});
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPlayingId(sandwich.id);
    playerRef.current?.seek(window.startMs, window.endMs);
    onSeekRequested?.();
  };

  /**
   * Tapping a call does BOTH things at once: the episode above jumps to the
   * moment it was made and starts playing, and its asset card opens over the
   * screen. Hearing the call and reading what it resolved to is one gesture,
   * not two — which is the whole reason this screen has an inline player.
   */
  const openCall = (sandwich: Sandwich) => {
    const momentWindow = getMomentWindow(sandwich);
    // A refused embed must NOT deep-link out to YouTube from a row tap — that
    // would throw the user out of the app on their way to an asset. The
    // timestamp chip is the explicit "play this" affordance and still does.
    if (momentWindow && !playerFailed) playCall(sandwich, momentWindow);
    // The pad the action raises has the caption in it, and the caption is a
    // play button — but the player is ours, so it gets a closure rather than
    // the ref.
    onSelectCall(sandwich, momentWindow ? () => playCall(sandwich, momentWindow) : null);
  };

  /**
   * Arriving with a call focused SELECTS it, not just the player.
   *
   * Selection is what the screen's action bar reads, so a Holdings row that
   * opened its episode used to land on a list with nothing picked — and
   * therefore no position summary and no way to close it. Deliberately silent:
   * it hands the call up without starting the video, because arriving is not
   * the same gesture as tapping a row.
   *
   * The closure is rebuilt every render and read through a ref so the effect
   * can fire once per focused id without `playCall` (a plain function) forcing
   * it to re-run on every frame.
   */
  const selectFocusedRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    selectFocusedRef.current = () => {
      const target = sandwiches.find((item) => item.id === focusSandwichId);
      if (!target) return;
      const momentWindow = getMomentWindow(target);
      onSelectCall(target, momentWindow ? () => playCall(target, momentWindow) : null);
    };
  });
  const focusSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusSandwichId || focusSelectedRef.current === focusSandwichId) return;
    if (!sandwiches.some((item) => item.id === focusSandwichId)) return;
    focusSelectedRef.current = focusSandwichId;
    selectFocusedRef.current?.();
  }, [focusSandwichId, sandwiches]);

  return (
    <View style={styles.detailRoot}>
      {/* Creator row, same shape as the sandwich detail hero: the builder is the
          author of every call below it, so an episode reads as one post rather
          than a different kind of object. */}
      <View style={styles.header}>
        <PressableScale
          accessibilityRole={creatorPrivyUserId ? 'button' : undefined}
          accessibilityLabel={creatorPrivyUserId ? `Open ${displayHandle}'s profile` : undefined}
          disabled={!creatorPrivyUserId}
          onPress={openCreatorProfile}
          style={styles.headerIdentity}
        >
        <View style={styles.avatarRing}>
          {creator?.avatarUrl ? (
            <Image source={{ uri: creator.avatarUrl }} style={styles.avatar} />
          ) : creator ? (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitials}>{creator.initials}</Text>
            </View>
          ) : video.channelAvatarUrl ? (
            <Image source={{ uri: video.channelAvatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Ionicons name="logo-youtube" size={18} color="#FF0000" />
            </View>
          )}
        </View>
        <View style={styles.headerMeta}>
          <View style={styles.handleRow}>
            <HandleText style={styles.handle} numberOfLines={1}>
              {displayHandle}
            </HandleText>
            {/* The blue check means "Bread builder" — an unowned episode showing
                the channel gets the YouTube mark instead. */}
            {creator ? (
              <VerifiedBadge size={17} />
            ) : (
              <Ionicons name="logo-youtube" size={15} color={colors.textTertiary} />
            )}
          </View>
        </View>
        </PressableScale>
        {publishedLabel ? <Text style={styles.headerTime}>{publishedLabel}</Text> : null}
      </View>

      {/* The title is this screen's thesis line — it sits directly under the
          channel and above the player, exactly where a sandwich's quote does.
          The episode summary is NOT here: it lives at the bottom behind Show
          More, the same place the sandwich detail keeps its thesis body. It is
          context for calls already read, so it must never push the video down. */}
      <Text style={styles.title}>{video.title}</Text>

      {/* The episode's player. It loads PAUSED behind its poster on purpose:
          this screen is a list of calls, and a video that starts talking the
          moment you land here is hostile. Tapping any timestamp below starts it
          at that call. */}
      <View style={styles.thumbWrap}>
        {playerFailed ? (
          <PressableScale
            accessibilityRole="link"
            accessibilityLabel={`Watch ${video.title} on YouTube`}
            onPress={openVideo}
            style={styles.thumbWrap}
          >
            <Image
              source={{ uri: `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg` }}
              style={styles.thumb}
              resizeMode="cover"
            />
            <View style={styles.playOverlay}>
              <Ionicons name="open-outline" size={24} color="#FFFFFF" />
            </View>
          </PressableScale>
        ) : (
          <YouTubeClipPlayer
            ref={playerRef}
            videoId={video.videoId}
            // Autoplay only when the user came for a specific call. Landing on
            // the episode as a whole and having it start talking is hostile;
            // arriving at a timestamp and having to press play is friction.
            autoplay={focusWindow != null}
            initialStartMs={focusWindow?.startMs ?? null}
            onError={() => setPlayerFailed(true)}
          />
        )}
      </View>

      <PressableScale
        accessibilityRole="link"
        accessibilityLabel={`Watch ${video.title} on YouTube`}
        onPress={openVideo}
        hitSlop={6}
        style={styles.watchRow}
      >
        <Ionicons name="logo-youtube" size={13} color="#FF0000" />
        <Text style={styles.watchRowText}>watch on YouTube</Text>
      </PressableScale>

      {/* Episode-level like / comment / share. One row for the whole episode,
          not per call: the viewer reacts to the episode, and it mirrors the
          feed card they tapped to get here — counts summed, heart lit only when
          every market is liked. See `PodcastGroupCard`. */}
      {onToggleLike || onComment || onBookmark || onShare ? (
        <View style={styles.actionsRow}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={liked ? 'Unlike episode' : 'Like episode'}
            disabled={!onToggleLike}
            onPress={() => {
              // Fire the heart from the tap itself rather than waiting on the
              // `liked` prop to come back through the store — same reason the
              // detail screen does it. The heart must never lag the finger.
              heartRef.current?.toggle(!liked);
              onToggleLike?.(sandwiches);
            }}
            hitSlop={8}
            style={styles.actionButton}
          >
            {/* Heart centred alone, count hanging off it out of flow — in flow,
                the first like shoves the heart sideways as the count appears. */}
            <View style={styles.actionHeart}>
              <HeartToggle ref={heartRef} liked={liked} size={26} idleColor="#5F7180" />
              {likeCount > 0 ? (
                <View pointerEvents="none" style={styles.actionCountSlot}>
                  <Text
                    numberOfLines={1}
                    style={[styles.actionCount, liked && styles.actionCountLiked]}
                  >
                    {likeCount}
                  </Text>
                </View>
              ) : null}
            </View>
          </PressableScale>

          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Comment on episode"
            disabled={!onComment}
            onPress={() => primary && onComment?.(primary)}
            hitSlop={8}
            style={styles.actionButton}
          >
            <Ionicons name="chatbubble-outline" size={24} color={colors.textSecondary} />
            {commentCount > 0 ? (
              <Text style={styles.actionCount}>{commentCount}</Text>
            ) : null}
          </PressableScale>

          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={bookmarked ? 'Remove bookmarks' : 'Bookmark episode'}
            accessibilityState={{ selected: bookmarked }}
            disabled={!onBookmark}
            onPress={() => onBookmark?.(sandwiches, bookmarked)}
            hitSlop={8}
            style={styles.actionButton}
          >
            <Ionicons
              name={bookmarked ? 'bookmark' : 'bookmark-outline'}
              size={24}
              color={bookmarked ? colors.accentBlue : colors.textSecondary}
            />
          </PressableScale>

          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Share episode"
            disabled={!onShare}
            onPress={() => primary && onShare?.(primary)}
            hitSlop={8}
            style={styles.actionButton}
          >
            <ShareIcon size={24} color={colors.textSecondary} />
          </PressableScale>
        </View>
      ) : null}

      {/* One TILE per timestamp, two up. Each holds the asset, which way the
          call goes, what was said, and how it has done — the quote stays in the
          grid rather than hiding behind a tap, because scanning an episode by
          what was actually said is the point of this screen.

          The picked tile spans the full width and opens: chart, the quote
          whole, and the reasoning. It is hoisted to the front, so it reads as a
          card at the top with the rest of the episode flowing beneath it. */}
      <View style={styles.callsGrid}>
        {visibleCalls.map((group) => {
          // The first mention leads: its entry is when the call was made, so
          // its return is the one that means "since this was called".
          const sandwich = group.lead;
          const short = sandwich.direction === 'down';
          const momentWindow = getMomentWindow(sandwich);
          const ts = momentWindow ? formatTimestamp(momentWindow.startMs) : null;
          const pct = sandwich.pnlPct;
          const basketLegs = orderedLegs(sandwich);
          const playing =
            playingId === sandwich.id || (playingId === null && sandwich.id === focusSandwichId);
          const selected = group.mentions.some(
            (mention) => mention.id === selectedSandwichId,
          );
          // Read twice per row (the line, then the expanded block) — built once.
          const quoted = `\u201C${callCaption(sandwich)}\u201D`;
          return (
            <PressableScale
              key={group.key}
              accessibilityRole="button"
              accessibilityLabel={`${short ? 'Short' : 'Long'} ${marketTicker(sandwich)}`}
              accessibilityHint="Plays this call and picks it to trade"
              accessibilityState={{ selected }}
              scaleTo={0.98}
              onPress={() => openCall(sandwich)}
              style={selected ? styles.tileWide : styles.tile}
            >
              <Animated.View
                layout={LinearTransition.springify().damping(26).stiffness(240)}
                style={[styles.call, selected && styles.callSelected]}
              >
                {/* Same construction as the holding card: a card floated on a
                    coloured shell, which shows as a rim around it and as the
                    strip beneath. There the strip is Share; here it is the
                    moment, because that is what a call is anchored to. */}
                <View style={[styles.callInner, selected && styles.callInnerSelected]}>
                  {/* When in the episode this was said, and the way back to
                      hearing it. First, because a call is a moment before it
                      is a position — and once picked, what the card is now
                      answering sits beside it. */}
                  <View style={styles.callTopRow}>
                    {/* When in the episode this was said, and the way back to
                        hearing it. First, because a call is a moment before it
                        is a position. */}
                    {ts && momentWindow ? (
                      <PressableScale
                        accessibilityRole="button"
                        accessibilityLabel={`Play this call from ${ts}`}
                        onPress={(event) => {
                          // This sits inside the tile that picks the call —
                          // without this, one tap would do both.
                          event.stopPropagation();
                          playCall(sandwich, momentWindow);
                        }}
                        style={styles.tsStrip}
                      >
                        <Ionicons
                          name={playing ? 'volume-medium' : 'play'}
                          size={selected ? 15 : 13}
                          color={colors.accentBlue}
                        />
                        <Text style={[styles.tsText, selected && styles.tsTextLarge]}>
                          {ts}
                        </Text>
                      </PressableScale>
                    ) : (
                      <View style={styles.tsStrip} />
                    )}

                    {/* Said more than once. The card is one position either
                        way — this is what stops the extra mentions reading as
                        extra opportunities. */}
                    {group.mentions.length > 1 ? (
                      <View style={styles.mentionsChip}>
                        <Text style={styles.mentionsChipText}>
                          {group.mentions.length}×
                        </Text>
                      </View>
                    ) : null}

                    {/* Picked, this line asks what the card is about to answer
                        — but only when there is one asset to ask it about. A
                        basket asks it once per leg, below. */}
                    {selected && basketLegs.length === 1 ? (
                      <Text
                        style={[styles.callWhyLabel, selected && styles.callWhyLabelLarge]}
                        numberOfLines={1}
                      >
                        Why{' '}
                        <Text style={styles.callWhyTicker}>${marketTicker(sandwich)}</Text>
                      </Text>
                    ) : null}

                    {/* Which way the call goes, stated once — beside the stamp
                        on an unpicked card, beside the ticker it qualifies on a
                        picked one, because the row it trails changes. */}
                    <Text
                      style={[
                        styles.direction,
                        selected && styles.directionLarge,
                        { color: short ? colors.negative : colors.positive },
                      ]}
                    >
                      {short ? 'SHORT' : 'LONG'}
                    </Text>
                  </View>

                  {/* Unpicked, the tile carries the episode's own words — what
                      the speaker actually said. Picked, it answers the only
                      question left once you are about to trade it: why this
                      instrument. The quote steps aside for that rather than
                      sitting above it, because you have just read it. */}
                  {selected ? (
                    <Animated.View
                      entering={FadeIn.duration(160).reduceMotion(ReduceMotion.System)}
                      style={styles.callWhyList}
                    >
                      {/* Every other time the episode made this call, in its own
                          words. The reasoning below is the first mention's; these
                          are what was said the other times. */}
                      {group.mentions.slice(1).map((mention) => {
                        const mentionWindow = getMomentWindow(mention);
                        const mentionTs = mentionWindow
                          ? formatTimestamp(mentionWindow.startMs)
                          : null;
                        return (
                          <View key={mention.id} style={styles.mentionRow}>
                            {mentionTs && mentionWindow ? (
                              <PressableScale
                                accessibilityRole="button"
                                accessibilityLabel={`Play this call from ${mentionTs}`}
                                hitSlop={8}
                                onPress={(event) => {
                                  event.stopPropagation();
                                  playCall(mention, mentionWindow);
                                }}
                                style={styles.mentionStamp}
                              >
                                <Ionicons name="play" size={11} color={colors.accentBlue} />
                                <Text style={styles.mentionStampText}>{mentionTs}</Text>
                              </PressableScale>
                            ) : null}
                            <Text style={styles.mentionQuote} numberOfLines={2}>
                              {`\u201C${callCaption(mention)}\u201D`}
                            </Text>
                          </View>
                        );
                      })}

                      {basketLegs.map((whyLeg) => {
                        const whyReasoning =
                          whyLeg.legMechanism ?? whyLeg.matchSummary ?? whyLeg.reason;
                        return (
                          <View key={whyLeg.id} style={styles.callWhyBlock}>
                            {/* One asset already asked this on the line above;
                                a basket asks it here, per leg, so no instrument
                                is explained by another one's reasoning. */}
                            {basketLegs.length > 1 ? (
                              <Text style={styles.callWhyLabelLarge} numberOfLines={1}>
                                Why{' '}
                                <Text style={styles.callWhyTicker}>
                                  ${(whyLeg.underlyingSymbol ?? whyLeg.symbol ?? whyLeg.label).toUpperCase()}
                                </Text>
                              </Text>
                            ) : null}
                            <Text style={[styles.callReasoning, styles.callReasoningLarge]}>
                              {whyReasoning ?? 'No reasoning was recorded for this leg.'}
                            </Text>
                          </View>
                        );
                      })}
                    </Animated.View>
                  ) : (
                    <Text style={styles.callQuote} numberOfLines={3}>
                      {quoted}
                    </Text>
                  )}

                  {/* One shape holds the whole identity: what the call is on and
                      how it has done. A single asset shows one face, a basket
                      shows its own — the same object either way, so the two
                      never read as different kinds of card. */}
                  <View style={styles.callHead}>
                    <View style={[styles.assetsPill, selected && styles.assetsPillLarge]}>
                      <View style={styles.assetsPillLogos}>
                        {basketLegs.slice(0, 3).map((basketLeg, index) => (
                          <View
                            key={basketLeg.id}
                            style={index > 0 ? styles.assetsPillOverlap : undefined}
                          >
                            <AssetLogo
                              uri={basketLeg.imageUrl}
                              letter={basketLeg.symbol ?? basketLeg.label}
                              size={selected ? 26 : 20}
                            />
                          </View>
                        ))}
                      </View>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.pct,
                          selected && styles.pctLarge,
                          // 0% is green, matching the leg row's `< 0` test — a
                          // flat call is not a losing one.
                          pct === null
                            ? styles.pctUnavailable
                            : { color: pct < 0 ? colors.chartNegative : colors.chartPositive },
                        ]}
                      >
                        {formatPct(pct)}
                      </Text>
                    </View>
                  </View>
                </View>
              </Animated.View>
            </PressableScale>
          );
        })}
      </View>

      {/* The rest of the episode, one tap away. Full width under the grid, with
          the logos of what is still hidden — the count says how many, the faces
          say what. */}
      {hiddenCallCount > 0 || allCallsShown ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={
            allCallsShown ? 'Show fewer calls' : `Show all ${ordered.length} calls`
          }
          onPress={() => setAllCallsShown((current) => !current)}
          style={styles.showAll}
        >
          <Text style={styles.showAllText}>
            {allCallsShown ? 'Show less' : `Show all ${ordered.length}`}
          </Text>
          {allCallsShown ? null : (
            <View style={styles.showAllLogos}>
              {ordered.slice(VISIBLE_CALLS, VISIBLE_CALLS + 3).map((hidden, index) => (
                <View key={hidden.key} style={index > 0 ? styles.showAllLogoOverlap : undefined}>
                  <AssetLogo
                    uri={orderedLegs(hidden.lead)[0]?.imageUrl ?? null}
                    letter={marketTicker(hidden.lead)}
                    size={20}
                  />
                </View>
              ))}
            </View>
          )}
        </PressableScale>
      ) : null}

      {/* The episode summary, last and collapsed — the slot the sandwich detail
          gives its thesis body. Per-call reasoning is NOT here any more: it
          belongs to one call, so it opens with that call's asset card. What is
          left is the one paragraph describing the episode as a whole. */}
      {video.summary ? (
        <>
          {summaryExpanded ? (
            <View style={styles.summaryBody}>
              <Text style={styles.summary}>{video.summary}</Text>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={summaryExpanded ? 'Show less' : 'Show more'}
            onPress={() => setSummaryExpanded((current) => !current)}
            style={({ pressed }) => [styles.showMoreButton, pressed && styles.showMoreButtonPressed]}
          >
            <Text style={styles.showMoreText}>{summaryExpanded ? 'Show Less' : 'Show More'}</Text>
            <Ionicons
              name={summaryExpanded ? 'chevron-up' : 'chevron-down'}
              size={13}
              color={colors.textSecondary}
            />
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    // The episode screen supplies its own scroll and safe-area padding, so the
    // full view is a plain column rather than a bordered card.
    detailRoot: { gap: 11 },
    pressed: { opacity: 0.75 },

    // Episode header
    // Mirrors the sandwich detail hero's creator row (36px avatar, 18/800 name,
    // muted time pushed right) so the two surfaces read as the same object.
    header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    headerIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
    avatarRing: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.surfaceAlt },
    avatarFallback: { alignItems: 'center', justifyContent: 'center' },
    avatarInitials: { fontFamily: F, fontWeight: '800', fontSize: 14, color: c.textSecondary },
    headerMeta: { flex: 1, minWidth: 0 },
    handleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    handle: {
      fontFamily: F,
      fontWeight: '800',
      fontSize: 18,
      color: c.text,
      flexShrink: 1,
    },
    headerTime: { fontFamily: F, fontWeight: '600', fontSize: 14, color: c.textTertiary },
    // Same weight and rhythm as the sandwich hero's thesis line, so an episode
    // and a sandwich read as the same kind of post.
    title: {
      fontFamily: F,
      fontWeight: '600',
      fontSize: 18,
      lineHeight: 24,
      color: c.text,
    },
    summary: {
      fontFamily: F,
      fontWeight: '400',
      fontSize: 13,
      lineHeight: 18,
      color: c.textSecondary,
    },
    thumbWrap: {
      aspectRatio: 16 / 9,
      borderRadius: 12,
      overflow: 'hidden',
      backgroundColor: '#000000',
    },
    thumb: { width: '100%', height: '100%' },
    playOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.18)',
    },

    // One timestamp = one TILE, two up. Flat cards on the screen's own ground:
    // the grid is the surface, so the tiles carry the only fill.
    callsGrid: {
      marginTop: 4,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    tile: { width: '48%' },
    // The picked call takes the full width — it is hoisted to the front, so it
    // reads as a card at the top with the episode flowing beneath it.
    tileWide: { width: '100%' },
    // The shell. The screen's own ground, not a tint: what separates a tile
    // from the page is its shadow. (A transparent background casts nothing, so
    // the fill has to be there for the shadow to exist at all.)
    call: {
      flex: 1,
      minHeight: 158,
      // Held by every tile, picked or not, so choosing one cannot nudge the
      // grid — only the border's colour changes.
      borderWidth: 1.5,
      borderColor: 'transparent',
      borderStyle: 'dashed',
      borderRadius: 20,
      // NOT `overflow: 'hidden'` — on iOS that sets masksToBounds, which clips
      // the view's own shadow away. Nothing inside paints a background of its
      // own, so there is nothing to clip to the radius anyway.
      backgroundColor: c.background,
      shadowColor: c.text,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 12,
      elevation: 3,
    },
    // Scaled up rather than just outlined: at tile size the dashed border alone
    // was too quiet to say "this is the one you are trading".
    callSelected: {
      borderColor: c.accentBlue,
      borderWidth: 2,
      minHeight: 200,
      shadowOpacity: 0.16,
      shadowRadius: 18,
      elevation: 6,
    },
    // Floated on the shell, which then reads as a rim around it.
    callInner: {
      flex: 1,
      gap: 9,
      paddingHorizontal: 14,
      paddingTop: 13,
      paddingBottom: 12,
    },
    callInnerSelected: {
      gap: 13,
      paddingHorizontal: 18,
      paddingTop: 17,
      paddingBottom: 16,
    },

    // Floored to the bottom-right: `marginTop: auto` is what pins it there, so
    // tiles in a row line up on it however long their quotes ran.
    callHead: { marginTop: 'auto', alignItems: 'flex-end', gap: 5 },
    direction: { flexShrink: 0, fontFamily: Fonts.displayOne, fontSize: 12, letterSpacing: 0.3 },
    directionLarge: { fontSize: 15, letterSpacing: 0.4 },

    // The identity, as one object: faces, name, return. Up to three faces —
    // past that the count carries it, and a fourth circle costs the pill more
    // width than the tile has.
    assetsPill: {
      alignSelf: 'flex-end',
      maxWidth: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingLeft: 4,
      paddingRight: 11,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: c.surfaceAlt,
    },
    assetsPillLarge: { gap: 10, paddingLeft: 5, paddingRight: 14, paddingVertical: 6 },
    assetsPillLogos: { flexShrink: 0, flexDirection: 'row', alignItems: 'center' },
    assetsPillOverlap: { marginLeft: -6 },
    // No name in the pill: the faces say which asset it is, and a basket says
    // how many by how many of them there are.

    callQuote: {
      flex: 1,
      minWidth: 0,
      fontFamily: Fonts.poppins,
      fontSize: 13,
      lineHeight: 19,
      color: c.textSecondary,
    },
    // Wraps: at 48% of the screen a tile has ~150pt of content width, and
    // stamp + mentions chip + direction can exceed it (06:14 · 2× · SHORT).
    // Nothing here clips (the card can't use overflow:'hidden' without
    // eating its own shadow), so without this the direction paints outside
    // the card. Items hold their own width and drop to a second line instead.
    callTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      columnGap: 8,
      rowGap: 4,
    },
    // Shrinks to its text, so the direction that follows sits beside it rather
    // than being pushed to the card's edge by an elastic label.
    callWhyLabel: {
      flexShrink: 1,
      fontFamily: F,
      fontWeight: '800',
      fontSize: 13,
      lineHeight: 17,
      color: c.textSecondary,
    },
    // The ticker carries the accent, matching the stamp it sits beside — the
    // word "Why" is scaffolding, the symbol is the subject.
    callWhyLabelLarge: {
      fontFamily: F,
      fontWeight: '800',
      fontSize: 16,
      lineHeight: 21,
      color: c.textSecondary,
    },
    callWhyList: { gap: 12 },
    // The other times this call was made. Indented behind their stamps so they
    // read as citations of the card, not as more cards.
    mentionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    mentionStamp: {
      flexShrink: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      marginTop: 1,
    },
    mentionStampText: {
      fontFamily: Fonts.displayOne,
      fontSize: 13,
      letterSpacing: 0.2,
      color: c.accentBlue,
    },
    mentionQuote: {
      flex: 1,
      minWidth: 0,
      fontFamily: Fonts.poppins,
      fontSize: 13,
      lineHeight: 19,
      color: c.textTertiary,
    },
    // How many times the episode made this call. A count, not a list: the list
    // is what the picked card gives.
    mentionsChip: {
      flexShrink: 0,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 999,
      backgroundColor: c.surfaceAlt,
    },
    mentionsChipText: {
      fontFamily: Fonts.displayOne,
      fontSize: 12,
      letterSpacing: 0.2,
      color: c.textSecondary,
    },
    callWhyBlock: { gap: 3 },
    callWhyTicker: { color: c.accentBlue },
    callReasoning: {
      fontFamily: Fonts.poppins,
      fontSize: 13,
      lineHeight: 19,
      color: c.textTertiary,
    },
    callReasoningLarge: { fontSize: 15, lineHeight: 23, color: c.textSecondary },

    // Heads the card, so it aligns with the copy under it rather than centring
    // like the footing it used to be.
    tsStrip: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 0,
      gap: 6,
    },
    tsText: {
      fontFamily: Fonts.displayOne,
      fontSize: 17,
      letterSpacing: 0.3,
      color: c.accentBlue,
    },
    tsTextLarge: { fontSize: 20 },

    // The rest of the episode, in the grid's own card language.
    showAll: {
      marginTop: 10,
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingHorizontal: 16,
      borderRadius: 20,
      backgroundColor: c.background,
      shadowColor: c.text,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 12,
      elevation: 3,
    },
    showAllText: { fontFamily: F, fontWeight: '800', fontSize: 15, color: c.textSecondary },
    showAllLogos: { flexDirection: 'row', alignItems: 'center' },
    showAllLogoOverlap: { marginLeft: -7 },

    // Rubik Bold, not Rubik One: the lighter display face is the one meant for
    // compact figures, and inside a pill the One face reads as a label rather
    // than a number.
    pct: {
      flexShrink: 0,
      fontFamily: Fonts.displayMedium,
      fontWeight: '700',
      fontSize: 15,
      lineHeight: 19,
      letterSpacing: -0.1,
      textAlign: 'right',
      fontVariant: ['tabular-nums'],
    },
    pctLarge: { fontSize: 20, lineHeight: 25 },
    pctUnavailable: { color: c.textTertiary },
    logo: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoText: { fontFamily: F, fontWeight: '800', fontSize: 15, color: c.textSecondary },
    // Episode summary, collapsed at the bottom behind Show More.
    summaryBody: {
      marginTop: 10,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: c.surfaceAlt,
    },
    showMoreButton: {
      marginTop: 10,
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 4,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 8,
      backgroundColor: c.backgroundAlt,
    },
    showMoreButtonPressed: { backgroundColor: c.surfaceAlt },
    showMoreText: {
      fontFamily: F,
      fontWeight: '800',
      fontSize: 12,
      color: c.textSecondary,
    },

    // Small deep-link under the player, replacing the thumbnail's tap-to-leave.
    watchRow: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
    watchRowText: { fontFamily: F, fontWeight: '600', fontSize: 12, color: c.textTertiary },

    // Deliberately identical to the sandwich detail hero's `detailLikeShareRow`
    // — four evenly spread 24px slots — so the two surfaces read as the same
    // object. Keep them in step if that row changes.
    actionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 8,
      marginBottom: 8,
      paddingHorizontal: 10,
    },
    actionButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      minHeight: 40,
    },
    actionHeart: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
    actionCountSlot: { position: 'absolute', left: 32, top: 0, bottom: 0, justifyContent: 'center' },
    actionCount: {
      fontFamily: F,
      fontWeight: '700',
      fontSize: 17,
      color: c.textSecondary,
      fontVariant: ['tabular-nums'],
    },
    actionCountLiked: { color: '#FF1493' },
  });

/** The Bread user who built the episode's calls — whose profile the byline opens. */
function primaryCreatorId(sandwiches: readonly Sandwich[]): string | null {
  return sandwiches[0]?.source.user?.privyUserId ?? null;
}
