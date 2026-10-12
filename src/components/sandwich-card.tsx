import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { Image } from "expo-image";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";

import { BookmarkIcon } from "@/components/bookmark-icon";
import { AssetLogo as RemoteAssetLogo } from "@/components/asset-logo";
import { AssetPriceText } from "@/components/asset-price-text";
import { HeartToggle, type HeartToggleRef } from "@/components/heart-toggle";
import { PressableScale } from "@/components/pressable-scale";
import { RemixIcon } from "@/components/remix-icon";
import { SandwichAvatarStack } from "@/components/sandwich-avatar-stack";
import { ShareIcon } from "@/components/share-icon";
import { VerifiedBadge } from "@/components/verified-badge";
import { XPostPreview, isXPostSource } from "@/components/x-post-preview";
import type { PodcastGroupVideo } from "@/components/podcast-sandwich-group-card";
import { Fonts, type ThemeColors } from "@/constants/theme";
import { useThemedStyles } from "@/hooks/use-themed-styles";
import type { PositionTake, Sandwich, SandwichLeg, SandwichOrigin, SandwichRemixParent } from "@/lib/api";
import { cardSocial, POST_COMMENTS_ENABLED } from "@/lib/card-social";
import { withAlpha } from "@/lib/color-utils";
import { TAKE_SIGNAL_LABEL, ageLabel, visibleSizeBand } from "@/lib/position-takes";
import { formatTimestamp } from "@/lib/moment";
import {
  NATIVE_ZOOM_SOURCE_TEST_ID,
  sandwichNativeZoomSourceKey,
  useIsNativeZoomSource,
} from "@/lib/native-zoom";
import {
  PLATFORM_ICON,
  formatCardCount,
  formatCardPnl,
  formatLegPriceValue,
  formatLegSide,
  formatPnl,
  getBuilderMeta,
  getCreatorMeta,
  getBuilderTake,
  getLegPrimaryLine,
  getSourceAuthorMeta,
  getSourcePostText,
  getSourceVideo,
  pnlColor,
  type SourceVideo,
} from "@/lib/sandwich-feed";
import { bestMarketReturn } from "@/lib/sandwich-pnl";
import { useOptionalSandwichComposer } from "@/lib/sandwich-composer-store";
import { useOptionalSandwichDetail } from "@/lib/sandwich-detail-store";
import { useOptionalSavedStore, useSavedStore } from "@/lib/saved-store";
import { useThemeStore } from "@/lib/theme-store";
import { stripHiddenUrls, useTweetMedia, type TweetMedia } from "@/lib/tweet-media";
import { useToast } from "@/lib/toast-store";
import { RotatingChevron } from "@/components/rotating-chevron";

/**
 * Every Sandwich feed card, and the rows and chrome they are built from.
 *
 * These used to live in `screens/sandwich-screen.tsx` alongside the composer,
 * the detail screen, the buy overlay and the trading engine. Home, Profile,
 * Saved, the user profile and the stock detail sheet all render a card, so all
 * of them were importing that 14k-line module — and `stock-detail-sheet` and
 * `user-profile-screen` imported it while it imported them back, forming two
 * runtime import cycles. Keeping the cards in a leaf module is what breaks both.
 */

const F = Fonts.rounded;
const F_DISPLAY_MEDIUM = Fonts.displayMedium;
const F_MONO = Fonts.mono;

/** Feed cards clamp long theses to this many lines before showing "Show more". */
const THESIS_COLLAPSED_LINES = 5;

// ─── Source citation ─────────────────────────────────────────────────────────
/**
 * The source citation: one quiet line, below the fold of attention.
 *
 * The whole point of the rebuilt card is that the embedded source is no longer
 * the dominant element — it used to be rendered inline at full size, which made
 * the builder read as a re-poster and leaked attention to an account that isn't
 * even on Bread. The embed still exists; it just has to be asked for.
 *
 * Renders nothing when there are no origins. An own-thesis sandwich shows no
 * citation row at all rather than an empty state, and is otherwise visually
 * identical to a sourced one.
 */
export function SourceCitation({
  origins,
  expanded,
  onToggle,
}: {
  origins: SandwichOrigin[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  if (origins.length === 0) return null;

  const [first, ...rest] = origins;
  const handle = first.handle ?? first.name ?? "unknown";
  // "sourced from @a, @b +2" — the second handle is named, the rest counted.
  const label =
    rest.length === 0
      ? `@${handle}`
      : rest.length === 1
        ? `@${handle}, @${rest[0].handle ?? rest[0].name ?? "unknown"}`
        : `@${handle}, @${rest[0].handle ?? rest[0].name ?? "unknown"} +${rest.length - 1}`;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={expanded ? "Hide the source" : `Show the source, ${label}`}
      hitSlop={6}
      onPress={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      style={styles.citationRow}
    >
      <Ionicons
        name={PLATFORM_ICON[first.platform] ?? "link-outline"}
        size={12}
        color={colors.textTertiary}
      />
      <Text numberOfLines={1} style={styles.citationText}>
        {`sourced from ${label}`}
      </Text>
      {/* A deleted post keeps its citation — attribution is never silently
          dropped just because the original is gone. */}
      {first.unavailable ? <Text style={styles.citationUnavailable}>unavailable</Text> : null}
      <RotatingChevron up={expanded} size={12} color={colors.textTertiary} />
    </PressableScale>
  );
}

// ─── Remix citation ──────────────────────────────────────────────────────────
/**
 * "remixed from @x" — the internal half of lineage, beside the external
 * "sourced from" line and just as quiet. Tapping opens the parent, so a remix
 * always leads back to what it corrected.
 */
export function RemixCitation({ parent }: { parent: SandwichRemixParent | null }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const router = useRouter();
  if (!parent) return null;
  const who = parent.builder?.username ? `@${parent.builder.username}` : parent.name || "a sandwich";

  return (
    <PressableScale
      accessibilityRole="link"
      accessibilityLabel={`Remixed from ${who}. Open the original.`}
      hitSlop={6}
      onPress={(event) => {
        event.stopPropagation();
        router.push({ pathname: "/sandwich-detail", params: { id: parent.sandwichId } });
      }}
      style={styles.citationRow}
    >
      <Ionicons name="git-branch-outline" size={12} color={colors.textTertiary} />
      <Text numberOfLines={1} style={styles.citationText}>
        {`remixed from ${who}`}
      </Text>
      <Ionicons name="chevron-forward" size={12} color={colors.textTertiary} />
    </PressableScale>
  );
}

// ─── Source video card ───────────────────────────────────────────────────────
export function SourceVideoCard({
  video,
  compact = false,
  onPress,
}: {
  video: SourceVideo;
  compact?: boolean;
  /**
   * Replaces "open on YouTube". Feed cards pass their own open action so the
   * preview behaves like the rest of the card (opens the detail screen); the
   * detail screen omits it, where watching the source is the point.
   */
  onPress?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const open = () => {
    if (onPress) {
      onPress();
      return;
    }
    void Linking.openURL(video.url).catch(() => {});
  };
  const thumbnailUrl = `https://img.youtube.com/vi/${video.videoId}/hqdefault.jpg`;
  const channelLine = video.channelName ? `${video.channelName} · YouTube` : "Watch on YouTube";

  if (compact) {
    return (
      <PressableScale
        accessibilityRole={onPress ? "button" : "link"}
        accessibilityLabel={onPress ? `Open ${video.title}` : `Watch ${video.title} on YouTube`}
        onPress={(event) => {
          event.stopPropagation();
          open();
        }}
        style={styles.sourceVideoCompact}
      >
        <View style={styles.linkPreviewYtThumbWrap}>
          <Image source={{ uri: thumbnailUrl }} style={styles.linkPreviewYtThumb} contentFit="cover" cachePolicy="memory-disk" />
          <View style={styles.linkPreviewYtPlayBtn}>
            <Ionicons name="play" size={16} color="#FFFFFF" />
          </View>
        </View>
        <View style={styles.linkPreviewYtMeta}>
          <Text style={styles.linkPreviewYtTitle} numberOfLines={2}>
            {video.title}
          </Text>
          <View style={styles.sourceVideoChannelRow}>
            <Ionicons name="logo-youtube" size={13} color="#FF0000" />
            <Text style={styles.sourceVideoChannel} numberOfLines={1}>
              {channelLine}
            </Text>
          </View>
        </View>
      </PressableScale>
    );
  }

  return (
    <View style={styles.sourceVideoHeroShadow}>
      <PressableScale
        accessibilityRole="link"
        accessibilityLabel={`Watch ${video.title} on YouTube`}
        onPress={open}
        style={styles.sourceVideoHero}
      >
        <View style={styles.sourceVideoHeroThumbWrap}>
          <Image source={{ uri: thumbnailUrl }} style={styles.linkPreviewYtThumb} contentFit="cover" cachePolicy="memory-disk" />
          <View style={styles.sourceVideoHeroPlayWrap}>
            <View style={styles.sourceVideoHeroPlayBadge}>
              <Ionicons name="play" size={22} color="#FFFFFF" />
            </View>
          </View>
        </View>
        <View style={styles.sourceVideoHeroMeta}>
          {video.channelAvatarUrl ? (
            <Image source={{ uri: video.channelAvatarUrl }} style={styles.sourceVideoAvatar} cachePolicy="memory-disk" />
          ) : (
            <Ionicons name="logo-youtube" size={26} color="#FF0000" />
          )}
          <View style={styles.sourceVideoHeroMetaText}>
            <Text style={styles.linkPreviewYtTitle} numberOfLines={2}>
              {video.title}
            </Text>
            <Text style={styles.sourceVideoChannel} numberOfLines={1}>
              {channelLine}
            </Text>
          </View>
          <Ionicons name="open-outline" size={16} color="#FF0000" />
        </View>
      </PressableScale>
    </View>
  );
}

// ─── Leg rows and asset icons ────────────────────────────────────────────────
export function CardAssetIcons({ legs }: { legs: SandwichLeg[] }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const orderedLegs = [...legs].sort((a, b) => a.order - b.order);
  // The stack shares one row with four action buttons and the PnL, so it is
  // capped at three circles — a fourth pushed the PnL off screen. Past three,
  // the rest are simply not drawn: a "+N" badge spent one of those three slots
  // on a number, which said less than the asset it displaced.
  const visibleLegs = orderedLegs.slice(0, 3);

  if (visibleLegs.length === 0) return null;

  return (
    <View
      accessible
      accessibilityLabel={`${orderedLegs.length} ${orderedLegs.length === 1 ? "asset" : "assets"} in this sandwich`}
      style={styles.cardLegsStack}
    >
      {visibleLegs.map((leg, index) => (
        <View
          key={leg.id}
          style={index > 0 ? styles.cardLegsStackOverlap : undefined}
        >
          <RemoteAssetLogo
            uri={leg.imageUrl}
            size={20}
            borderRadius={10}
            backgroundColor={colors.surfaceAlt}
            borderWidth={2}
            borderColor={colors.surfaceAlt}
            fallback={
              <View style={styles.cardLegsStackFallback}>
                <Ionicons
                  name={
                    leg.type === "prediction_market"
                      ? "ribbon-outline"
                      : "bar-chart-outline"
                  }
                  size={11}
                  color={colors.text}
                />
              </View>
            }
          />
        </View>
      ))}
    </View>
  );
}

/** The lead asset's logo on a Home / Explore card, and the basket badges on it. */
const FEED_FACE_SIZE = 36;
const FEED_BADGE_SIZE = 16;

/** Asset logo in a leg row. */
const LEG_LOGO_SIZE = 46;

/** On-screen rect of a leg row, in window coordinates — the seed the detail
 * card grows out of and shrinks back into. */
export type LegCardOrigin = { x: number; y: number; width: number; height: number };

export function SandwichLegRow({
  leg,
  isLast,
  onPress,
  isCardOpen,
  rowVisible,
  priceScale = 1,
  onSeekToLeg,
}: {
  leg: SandwichLeg;
  isLast: boolean;
  /**
   * When set, the row opens the leg detail card. Reports its own on-screen
   * rect so the card can grow out of exactly this row. Omitted by the composer
   * preview and the feed card, which keep the original inert row.
   */
  onPress?: (leg: SandwichLeg, origin: LegCardOrigin) => void;
  /** True while this row's card is open (including while it animates shut). */
  isCardOpen?: boolean;
  /**
   * The row's own opacity, driven directly by the screen rather than derived
   * from the card's expansion progress.
   *
   * Deriving it from progress can't work: the value is symmetric but the
   * requirement isn't. Opening should hide the row promptly, while closing
   * should hand it back the instant the card starts shrinking — and a spring
   * spends most of its tail near its target, so any threshold low enough to
   * avoid a flash on open only fires in the last moments of the close. Hence
   * an explicit value the open and close paths each set their own way.
   */
  rowVisible?: SharedValue<number>;
  /** Development preview scale for the right-aligned live price only. */
  priceScale?: number;
  /**
   * Jump the source video to this leg's own moment.
   *
   * Only supplied when the sandwich's legs actually came from DIFFERENT
   * timestamps. Today `buildSandwichFromMoment` stamps one identical window
   * onto every leg, so this is normally absent and no chip renders — showing N
   * copies of the same timestamp would be noise, not information.
   */
  onSeekToLeg?: (leg: SandwichLeg) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const rowRef = useRef<View>(null);

  const rowFadeStyle = useAnimatedStyle(() => {
    if (!isCardOpen || !rowVisible) return { opacity: 1 };
    return { opacity: rowVisible.value };
  });

  const handlePress = useCallback(() => {
    if (!onPress) return;
    // measureInWindow (not onLayout) because the list scrolls: the rect has to
    // be where the row is RIGHT NOW, not where it was laid out.
    rowRef.current?.measureInWindow((x, y, width, height) => {
      onPress(leg, { x, y, width, height });
    });
  }, [leg, onPress]);
  const primaryLine = getLegPrimaryLine(leg).trim();
  const displayPrimary =
    leg.type === "tokenized_stock" ? primaryLine.toUpperCase() : primaryLine;
  const pnl = formatPnl(leg.pnlPct);
  const hasPnl = leg.pnlPct !== null;
  const weightPct = Math.round(Math.max(0, leg.weightBps) / 100);
  const weightLabel = `${weightPct}%`;
  const sideLabel = formatLegSide(leg);
  // A perp leg is a POSITION, and reads like one: the name with the direction
  // spelled out beside it, price and PnL on the right. Leverage is deliberately
  // not on the row — it belongs on the pad. Spot and prediction legs keep the
  // basket row.
  const isPerpLeg = leg.venue === "perp";

  const body = (
    <Animated.View
      ref={rowRef}
      style={[styles.legRow, !isLast && styles.legRowDivider, rowFadeStyle]}
    >
      <View style={styles.legImageWrap}>
        <RemoteAssetLogo
          uri={leg.imageUrl}
          size={LEG_LOGO_SIZE}
          borderRadius={LEG_LOGO_SIZE / 2}
          backgroundColor={colors.surfaceAlt}
          fallback={
            <View style={styles.legImageFallback}>
              <Ionicons
                name={
                  leg.type === "prediction_market"
                    ? "ribbon-outline"
                    : "bar-chart-outline"
                }
                size={20}
                color={colors.textInverse}
              />
            </View>
          }
        />
      </View>
      <View style={styles.legBody}>
        <View style={styles.legTopRow}>
          <View style={styles.legCopyColumn}>
            {isPerpLeg ? (
              <View style={styles.legPerpNameRow}>
                <Text numberOfLines={1} style={styles.legPrimaryTitle}>
                  {displayPrimary}
                </Text>
                <Text
                  style={[
                    styles.legPerpSide,
                    sideLabel === "SHORT" ? styles.legPerpSideShort : styles.legPerpSideLong,
                  ]}
                >
                  {sideLabel}
                </Text>
              </View>
            ) : (
            <Text
              numberOfLines={leg.type === "prediction_market" ? 3 : 1}
              style={styles.legPrimaryTitle}
            >
              {displayPrimary}
            </Text>
            )}
            <View style={styles.legAllocationRow}>
              <Text
                style={styles.legAllocationText}
                accessibilityLabel={`Allocation ${weightLabel}`}
              >
                {weightLabel}
              </Text>
              {onSeekToLeg && leg.startMs != null ? (
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`Play this leg's call from ${formatTimestamp(leg.startMs)}`}
                  hitSlop={8}
                  onPress={(event) => {
                    // The row itself opens the leg card; the chip must not also
                    // trigger it.
                    event.stopPropagation();
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onSeekToLeg(leg);
                  }}
                  style={styles.legTsChip}
                >
                  <Ionicons name="play" size={8} color={colors.accentBlue} />
                  <Text style={styles.legTsChipText}>{formatTimestamp(leg.startMs)}</Text>
                </PressableScale>
              ) : null}
            </View>
          </View>
          <View style={styles.legMetricCluster}>
            {/* Direction pill. Prediction legs have always shown YES/NO. Perp
                legs spell their side out under the name instead, so the pill
                would repeat it. Spot legs are always buys, so they stay bare. */}
            {leg.type === "prediction_market" ? (
              <View
                style={[
                  styles.legSidePill,
                  sideLabel === "NO" || sideLabel === "SHORT"
                    ? styles.legSidePillNo
                    : styles.legSidePillYes,
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.legSidePillText,
                    sideLabel === "NO" || sideLabel === "SHORT"
                      ? styles.legSidePillTextNo
                      : styles.legSidePillTextYes,
                  ]}
                >
                  {sideLabel}
                </Text>
              </View>
            ) : null}
            <AssetPriceText
              label={formatLegPriceValue(leg)}
              size={16 * priceScale}
              lineHeight={20 * priceScale}
              style={styles.legPrice}
            />
            {hasPnl ? (
              <Text
                numberOfLines={1}
                style={[
                  styles.legPnl,
                  leg.pnlPct! < 0
                    ? styles.legPnlNegative
                    : styles.legPnlPositive,
                ]}
              >
                {pnl}
              </Text>
            ) : (
              // No PnL means the backend couldn't resolve a live price for this
              // leg (throttled/geo-gated upstream, or an instrument no price
              // feed covers) — never that the sandwich is new: a leg with both
              // prices reads 0.00% the instant it's created. Show the same "--"
              // the price slot uses instead of claiming a state we can't know.
              <Text
                numberOfLines={1}
                style={[styles.legPnl, styles.legPnlUnavailable]}
              >
                {"--"}
              </Text>
            )}
          </View>
        </View>
      </View>
    </Animated.View>
  );

  if (!onPress) return body;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${displayPrimary}, ${weightLabel} of the basket`}
      accessibilityHint="Opens this asset's reasoning"
      scaleTo={0.98}
      onPress={handlePress}
    >
      {body}
    </PressableScale>
  );
}

// ─── Cards ───────────────────────────────────────────────────────────────────
export function CardTimestamp({ createdAt }: { createdAt: string | null }) {
  const styles = useThemedStyles(makeStyles);
  const label = useMemo(() => {
    if (!createdAt) return "";
    const diff = Date.now() - new Date(createdAt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }, [createdAt]);
  if (!label) return null;
  return <Text style={styles.cardTimestamp}>{label}</Text>;
}

/**
 * A feed card is edge-to-edge, so the press needs to read as a push-back
 * rather than a dimming: fading a full-width row washes out the whole screen.
 * Kept very shallow because the row is wide — a card-sized 0.97 would look
 * like the timeline jumped.
 */
const CARD_PRESS_SCALE = 0.985;

/**
 * Memoised: liking one card replaces only that card's sandwich object (the
 * list map keeps every other item's identity), so an un-memoised card meant
 * every row in the feed re-rendered on every tap — the other half of the like
 * lag, alongside the effect-driven heart.
 */
export type SandwichCardSavedControls = {
  canSave: boolean;
  isSaved: (type: "sandwich" | "stock", id: string) => boolean;
  toggleSave: (type: "sandwich" | "stock", id: string) => Promise<boolean>;
};

/** No store and no props: the card renders without a bookmark rather than crashing. */
const SAVED_UNAVAILABLE: SandwichCardSavedControls = {
  canSave: false,
  isSaved: () => false,
  toggleSave: async () => false,
};

/** The feed shows no links — they live on the sandwich's detail page. */
function stripLinks(text: string): string {
  return text
    .replace(/\bhttps?:\/\/\S+/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * A source tweet's photos, drawn under the take and indented past the avatar
 * like the rest of the copy.
 */
function CardTweetMedia({ media }: { media: TweetMedia }) {
  const styles = useThemedStyles(makeStyles);
  const { photos } = media;

  if (photos.length === 1) {
    const [photo] = photos;
    // Clamped so a tall screenshot can't take over the feed, nor a panorama
    // shrink to a sliver.
    const aspectRatio = Math.min(2, Math.max(0.8, photo.width / photo.height));
    return (
      <View style={[styles.tweetMedia, { aspectRatio }]}>
        <Image source={{ uri: photo.url }} style={styles.tweetMediaFill} contentFit="cover" cachePolicy="memory-disk" />
        {photo.isVideo ? <TweetPlayBadge /> : null}
      </View>
    );
  }

  if (photos.length > 1) {
    return (
      <View style={[styles.tweetMedia, styles.tweetMediaGrid]}>
        {photos.map((photo, index) => (
          <View
            key={photo.url}
            style={[
              styles.tweetMediaCell,
              // Two photos sit side by side; of three, the first spans the
              // left column — both as X lays them out.
              (photos.length === 2 || (photos.length === 3 && index === 0)) &&
                styles.tweetMediaCellTall,
            ]}
          >
            <Image source={{ uri: photo.url }} style={styles.tweetMediaFill} contentFit="cover" cachePolicy="memory-disk" />
            {photo.isVideo ? <TweetPlayBadge /> : null}
          </View>
        ))}
      </View>
    );
  }

  // Link cards stay off the feed; the sandwich's detail page shows the source.
  return null;
}

function TweetPlayBadge() {
  const styles = useThemedStyles(makeStyles);
  return (
    <View pointerEvents="none" style={styles.tweetPlayBadge}>
      <Ionicons name="play" size={18} color="#fff" />
    </View>
  );
}

export const SandwichCard = React.memo(function SandwichCard({
  sandwich,
  onPress,
  onToggleLike,
  onComment,
  onShare,
  showShare = true,
  showRemix = true,
  onRemix,
  saved,
  layout = "post",
}: {

  sandwich: Sandwich;
  onPress: (sandwich: Sandwich) => void;
  onToggleLike: (sandwich: Sandwich) => void;
  onComment?: (sandwich: Sandwich) => void;
  onShare: (sandwich: Sandwich) => void;
  showShare?: boolean;
  /** The main Sandwich feed leaves Remix to the detail screen. */
  showRemix?: boolean;
  /**
   * Remix handler from a host that can reach the composer when this card
   * cannot (a portalled sheet). Shows Remix even without the context.
   */
  onRemix?: (sandwich: Sandwich) => void;
  /**
   * Save controls, for a host that renders this card inside a portalled sheet.
   * There the saved store is out of reach and reading it directly is a render
   * error, so the host reads it on the outside and hands the pieces in.
   */
  saved?: SandwichCardSavedControls;
  /**
   * `post` is the full timeline post. `holding` draws the sandwich the way a
   * held position reads on the profile — asset face, byline and take, return
   * on the right — for the Home and Explore feeds.
   */
  layout?: "post" | "holding";
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const toast = useToast();
  // Props first, then context, then a disabled bookmark — never a throw. This
  // card is rendered inside the stock detail sheet, which gorhom portals above
  // the store's provider.
  const savedFromContext = useOptionalSavedStore();
  const { canSave, isSaved, toggleSave } =
    saved ?? savedFromContext ?? SAVED_UNAVAILABLE;
  // Same reach rule as the bookmark: inside a portalled sheet the composer is
  // out of reach, and the card drops Remix rather than crashing.
  const composer = useOptionalSandwichComposer();
  const detail = useOptionalSandwichDetail();
  const userThesisText = getBuilderTake(sandwich);
  const sourceVideo = getSourceVideo(sandwich);
  const creator = getBuilderMeta(sandwich);
  const isXPost = isXPostSource(sandwich.source);
  // An external source owns the primary byline. The Bread creator moves to the
  // quieter sub-handle directly beneath it; own-thesis cards still lead with
  // the creator because they have no origin.
  const sourceAuthor = getSourceAuthorMeta(sandwich);
  // A YouTube-sourced card is credited to the CHANNEL, with the builder moved
  // to the sub-handle beneath — same rule as the grouped episode card. Only
  // applies when the source actually names a channel; otherwise the card falls
  // through to the normal builder byline.
  const videoChannel =
    sourceVideo && (sourceVideo.channelName ?? null)
      ? { name: sourceVideo.channelName as string, avatarUrl: sourceVideo.channelAvatarUrl }
      : null;
  // X cards always lead with the source post's own words, even when a Bread
  // creator is credited beneath the source account. The generated take is only
  // a fallback for legacy rows that never stored the original tweet text.
  const sourcePostText =
    isXPost && sourceAuthor ? getSourcePostText(sandwich) : "";
  const bodyText = sourcePostText || userThesisText;
  // The card IS the post now, so a separate origin toggle and embed would
  // repeat the same avatar, handle and words a second time.
  const isPostCard = Boolean(sourceAuthor) && Boolean(sourcePostText);
  const sourceHandleAlreadyShown = Boolean(sourceAuthor) && sandwich.origins.length === 1;
  // The embed is opt-in now: the citation line is what the feed shows, and the
  // full source expands only when the reader asks for it.
  const [sourceExpanded, setSourceExpanded] = useState(false);
  const hasPnl = sandwich.pnlPct !== null;
  const bookmarked = isSaved("sandwich", sandwich.id);
  const heartRef = useRef<HeartToggleRef>(null);
  const isNativeZoomSource = useIsNativeZoomSource(
    sandwichNativeZoomSourceKey(sandwich.id),
  );
  // Measure the full thesis once, then clamp long posts in the feed. "Show
  // more" opens the sandwich detail rather than expanding the timeline card.
  const [thesisLineCount, setThesisLineCount] = useState(0);
  const thesisTruncatable = thesisLineCount > THESIS_COLLAPSED_LINES;
  // Photos and link cards from the source tweet. Only the holding layout draws
  // them; the post layout already embeds the whole tweet on demand.
  const tweetMedia = useTweetMedia(
    layout === "holding" && isXPost ? sandwich.source.sourceUrl : null,
  );

  // Shared by both layouts, so engagement behaves identically wherever the
  // card is drawn.
  const actionButtons = (
    <>
      <PressableScale
      accessibilityRole="button"
      accessibilityLabel={sandwich.viewerHasLiked ? "Unlike sandwich" : "Like sandwich"}
      onPress={() => {
        // Paint first, then let React catch up.
        heartRef.current?.toggle(!sandwich.viewerHasLiked);
        onToggleLike(sandwich);
      }}
      style={[styles.cardActionButton, !showShare && styles.cardActionButtonWide, styles.cardActionButtonCounted]}
    >
      <HeartToggle
        ref={heartRef}
        liked={sandwich.viewerHasLiked}
        size={20}
        idleColor={colors.textSecondary}
      />
      {/* The count floats out of flow, so an absent or growing number
          never changes the spacing between the action icons. */}
      <View pointerEvents="none" style={styles.likeCountSlot}>
        <Text
          numberOfLines={1}
          style={[styles.likeButtonText, sandwich.viewerHasLiked && styles.likeButtonTextActive]}
        >
          {sandwich.likeCount > 0 ? formatCardCount(sandwich.likeCount) : ""}
        </Text>
      </View>
    </PressableScale>
    {/* The feed-row layout leaves Remix to the sandwich's own screen. */}
    {showRemix && layout !== "holding" && (onRemix || composer) ? (
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Remix sandwich"
        accessibilityHint="Opens this basket in the composer to change and publish as your own"
        onPress={(event) => {
          event.stopPropagation();
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          if (onRemix) {
            onRemix(sandwich);
            return;
          }
          composer?.open({
            remixOf: sandwich,
            onCreated: (created) => {
              toast.showToast("Your remix is live", "success");
              detail?.open(created);
            },
          });
        }}
        style={[styles.cardActionButton, !showShare && styles.cardActionButtonWide]}
      >
        <RemixIcon size={20} color={colors.textSecondary} />
      </PressableScale>
    ) : null}
    {POST_COMMENTS_ENABLED ? (
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Comment on sandwich"
        onPress={(event) => {
          event.stopPropagation();
          (onComment ?? onPress)(sandwich);
        }}
        style={[styles.cardActionButton, !showShare && styles.cardActionButtonWide, styles.cardActionButtonCounted]}
      >
        <Ionicons name="chatbubble-outline" size={20} color={colors.textSecondary} />
        {sandwich.commentCount > 0 ? (
          <View pointerEvents="none" style={styles.likeCountSlot}>
            <Text numberOfLines={1} style={styles.likeButtonText}>
              {formatCardCount(sandwich.commentCount)}
            </Text>
          </View>
        ) : null}
      </PressableScale>
    ) : null}
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={bookmarked ? "Remove bookmark" : "Bookmark sandwich"}
      accessibilityState={{ selected: bookmarked }}
      onPress={(event) => {
        event.stopPropagation();
        if (!canSave) {
          toast.showToast("Sign in to save sandwiches", "info");
          return;
        }
        // The icon flips on tap and confirms itself; only a failed save (the
        // store rolled it back) needs a word.
        const wanted = !bookmarked;
        void toggleSave("sandwich", sandwich.id).then((saved) => {
          if (saved !== wanted) toast.showToast("Couldn't update your bookmark. Try again.", "error");
        });
      }}
      style={[styles.cardActionButton, !showShare && styles.cardActionButtonWide]}
    >
      <BookmarkIcon
        saved={bookmarked}
        size={20}
        color={bookmarked ? colors.accentBlue : colors.textSecondary}
      />
    </PressableScale>
    {showShare ? (
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Share sandwich"
        onPress={() => onShare(sandwich)}
        style={[styles.cardActionButton, !showShare && styles.cardActionButtonWide]}
      >
        <ShareIcon size={20} color={colors.textSecondary} />
      </PressableScale>
    ) : null}

    </>
  );

  if (layout === "holding") {
    const orderedLegs = [...sandwich.legs].sort((a, b) => a.order - b.order);
    // The leg that fronts the row: one with a stored image if any has one — the
    // same pick the profile's holding card makes.
    const faceLeg = orderedLegs.find((leg) => leg.imageUrl) ?? orderedLegs[0] ?? null;
    const restLegs = orderedLegs.filter((leg) => leg !== faceLeg);
    const faceLabel = faceLeg
      ? faceLeg.type === "tokenized_stock"
        ? getLegPrimaryLine(faceLeg).toUpperCase()
        : getLegPrimaryLine(faceLeg)
      : sandwich.name;
    // Whoever made the call is the badge on the logo — cited account first,
    // then the channel, then the builder — matching the handle beside it.
    const primaryName = sourceAuthor
      ? sourceAuthor.name
      : videoChannel
        ? videoChannel.name.replace(/^@/, "")
        : creator
          ? creator.name.replace(/^@/, "")
          : null;
    const primaryIsHandle = sourceAuthor ? sourceAuthor.isHandle : !videoChannel && Boolean(creator);
    const cornerAvatarUri =
      sourceAuthor?.avatarUrl ?? videoChannel?.avatarUrl ?? creator?.avatarUrl ?? null;
    const cornerInitial = sourceAuthor?.initials ?? primaryName?.slice(0, 1).toUpperCase() ?? null;
    const take = stripLinks(stripHiddenUrls(bodyText, tweetMedia.hiddenUrls));
    const pnl = sandwich.pnlPct;

    return (
      <View
        collapsable={false}
        testID={isNativeZoomSource ? NATIVE_ZOOM_SOURCE_TEST_ID : undefined}
      >
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Open ${sandwich.name}${hasPnl ? `, return ${formatCardPnl(pnl)}` : ""}`}
          onPress={() => onPress(sandwich)}
          scaleTo={CARD_PRESS_SCALE}
          style={styles.holdingCard}
        >
          {/* The basket's logos on the left; who called it, the take, media,
              actions and the return in the column beside them. */}
          <View style={styles.holdingMainRow}>
            <View style={styles.holdingFace}>
              <SandwichAvatarStack
                size={FEED_FACE_SIZE}
                legs={
                  faceLeg
                    ? [{
                        iconUri: faceLeg.imageUrl ?? null,
                        symbol: faceLeg.symbol ?? faceLeg.underlyingSymbol ?? null,
                        mint: faceLeg.mint ?? null,
                        initial: faceLabel.slice(0, 1).toUpperCase(),
                      }]
                    : []
                }
                legCount={faceLeg ? 1 : 0}
                creatorAvatarUri={null}
                creatorInitial={null}
              />
              {/* The rest of the basket rides the lead asset's corner. */}
              {restLegs.length > 0 ? (
                <View
                  accessible
                  accessibilityLabel={`and ${restLegs.length} more ${restLegs.length === 1 ? "asset" : "assets"}`}
                  style={styles.holdingFaceBadges}
                >
                  {/* Logos only — capped at three so the corner stays on the
                      lead asset; no "+N" count. */}
                  {restLegs.slice(0, 3).map((leg, index) => (
                    <View
                      key={leg.id}
                      style={[styles.holdingFaceBadge, index > 0 && styles.holdingFaceBadgeOverlap]}
                    >
                      <RemoteAssetLogo
                        uri={leg.imageUrl}
                        size={FEED_BADGE_SIZE}
                        borderRadius={FEED_BADGE_SIZE / 2}
                        backgroundColor={colors.surfaceAlt}
                        fallback={
                          <View style={[styles.holdingLegPillFallback, styles.holdingFaceBadgeFallback]}>
                            <Text style={styles.holdingLegPillFallbackText}>
                              {getLegPrimaryLine(leg).slice(0, 1).toUpperCase()}
                            </Text>
                          </View>
                        }
                      />
                    </View>
                  ))}
                </View>
              ) : null}
            </View>

            <View style={styles.holdingCopy}>
              <View style={styles.holdingTitleRow}>
                <Text numberOfLines={1} style={styles.holdingTitle}>
                  {primaryIsHandle ? <Text style={styles.cardHandleAt}>@</Text> : null}
                  {primaryName ?? "Unattributed"}
                </Text>
                {cornerAvatarUri || cornerInitial ? (
                  <RemoteAssetLogo
                    uri={cornerAvatarUri}
                    size={20}
                    borderRadius={10}
                    backgroundColor={colors.surfaceAlt}
                    fallback={
                      <View style={styles.holdingLegPillFallback}>
                        <Text style={styles.holdingLegPillFallbackText}>{cornerInitial ?? ""}</Text>
                      </View>
                    }
                  />
                ) : null}
                <View style={styles.cardActionSpacer} />
                <CardTimestamp createdAt={sandwich.createdAt} />
              </View>

              {take ? (
                <Text numberOfLines={3} style={styles.holdingThesis}>
                  {take}
                </Text>
              ) : null}

              <CardTweetMedia media={tweetMedia} />

              {/* Engagement spread across the row, the return closing it. */}
              <View style={styles.holdingActionsRow}>
                <View style={styles.engagementGroup}>{actionButtons}</View>
                <View style={styles.engagementReturn}>
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                    style={[styles.holdingReturn, { color: pnlColor(pnl, colors) }]}
                  >
                    {hasPnl ? `${pnl! < 0 ? "\u25BC" : "\u25B2"} ${formatCardPnl(pnl).replace(/^[+-]/, "")}` : "--"}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </PressableScale>
      </View>
    );
  }

  return (
    <View
      collapsable={false}
      testID={isNativeZoomSource ? NATIVE_ZOOM_SOURCE_TEST_ID : undefined}
    >
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`Open ${sandwich.name}`}
        onPress={() => onPress(sandwich)}
        scaleTo={CARD_PRESS_SCALE}
        style={styles.card}
      >
      <View style={styles.cardRow}>
        {/* External cards lead with the source author's avatar; the creator is
            credited in the sub-handle. An own-thesis card has no source author,
            so its creator keeps the primary avatar and byline. */}
        {sourceAuthor?.avatarUrl ?? videoChannel?.avatarUrl ? (
          <Image
            source={{ uri: (sourceAuthor?.avatarUrl ?? videoChannel?.avatarUrl) as string }}
            style={styles.cardAvatar}
            cachePolicy="memory-disk"
          />
        ) : sourceAuthor ? (
          <View style={styles.cardAvatarCircle}>
            <Text style={styles.cardSourceAvatarInitials}>{sourceAuthor.initials}</Text>
          </View>
        ) : videoChannel ? (
          <View style={styles.cardAvatarCircle}>
            <Ionicons name="logo-youtube" size={18} color="#FF0000" />
          </View>
        ) : creator?.avatarUrl ? (
          <Image source={{ uri: creator.avatarUrl }} style={styles.cardAvatar} cachePolicy="memory-disk" />
        ) : (
          <View style={styles.cardAvatarCircle}>
            <Ionicons name="person" size={18} color={colors.textTertiary} />
          </View>
        )}

        {/* Content column, indented past the avatar */}
        <View style={styles.cardContent}>
          <View style={styles.cardCreatorRow}>
            <Text
              numberOfLines={sourceAuthor?.isHandle ? undefined : 1}
              style={[
                styles.cardHandle,
                sourceAuthor?.isHandle && styles.cardHandleUnclipped,
              ]}
            >
              {sourceAuthor ? (
                <>
                  {sourceAuthor.isHandle ? (
                    <Text style={styles.cardHandleAt}>@</Text>
                  ) : null}
                  {sourceAuthor.name}
                </>
              ) : videoChannel ? (
                <>
                  {/^@?\S+$/.test(videoChannel.name) ? <Text style={styles.cardHandleAt}>@</Text> : null}
                  {videoChannel.name.replace(/^@/, "")}
                </>
              ) : creator ? (
                <>
                  <Text style={styles.cardHandleAt}>@</Text>
                  {creator.name.replace(/^@/, "")}
                </>
              ) : (
                "Unattributed"
              )}
            </Text>
            {/* The blue check means "this is a Bread builder". A cited account
                never gets one — it gets the mark that says where this came
                from. */}
            {sourceAuthor ? (
              <PressableScale
                accessibilityRole={sourceAuthor.url ? "link" : "image"}
                accessibilityLabel={
                  sourceAuthor.url ? "Open original source" : "External source"
                }
                disabled={!sourceAuthor.url}
                hitSlop={14}
                onPress={(event) => {
                  event.stopPropagation();
                  if (sourceAuthor.url) {
                    void Linking.openURL(sourceAuthor.url).catch(() => {});
                  }
                }}
              >
                <Ionicons
                  name={PLATFORM_ICON[sourceAuthor.platform] ?? "link-outline"}
                  size={13}
                  color={sourceAuthor.platform === "youtube" ? "#FF0000" : colors.textTertiary}
                />
              </PressableScale>
            ) : videoChannel ? (
              <Ionicons name="logo-youtube" size={13} color="#FF0000" />
            ) : creator ? (
              <VerifiedBadge size={15} />
            ) : null}
            <View style={styles.cardActionSpacer} />
            <CardTimestamp createdAt={sandwich.createdAt} />
          </View>

          {/* On an externally sourced card the Bread creator is the sub-handle.
              Native cards already show this identity in the primary byline. */}
          {(sourceAuthor || videoChannel) && creator ? (
            <View style={styles.cardSubHandleRow}>
              <Text numberOfLines={1} style={styles.cardSubHandle}>
                <Text style={styles.cardHandleAt}>@</Text>
                {creator.name.replace(/^@/, "")}
              </Text>
              <VerifiedBadge size={12} />
            </View>
          ) : null}

          {/* The builder's take is the headline — their words, not the
              source's. The embed moved below the composition, behind the
              citation line. */}
          <View style={styles.cardThesisWrap}>
            {/* Clamped from the first frame. Measuring the visible text and
                clamping it afterwards made every long card shrink a frame
                after it scrolled in, re-laying out the list under the finger.
                The unclamped copy is measured off-layout, then dropped. */}
            <Text style={styles.cardThesisText} numberOfLines={THESIS_COLLAPSED_LINES}>
              {bodyText}
            </Text>
            {thesisLineCount === 0 ? (
              <Text
                aria-hidden
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                pointerEvents="none"
                style={[styles.cardThesisText, styles.cardThesisMeasure]}
                onTextLayout={(e) => {
                  setThesisLineCount(Math.max(1, e.nativeEvent.lines.length));
                }}
              >
                {bodyText}
              </Text>
            ) : null}
            {thesisTruncatable ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Open ${sandwich.name} to read more`}
                hitSlop={8}
                onPress={(event) => {
                  event.stopPropagation();
                  onPress(sandwich);
                }}
                style={styles.cardShowMoreOverlay}
              >
                <Text style={styles.cardShowMore}>Show more</Text>
              </PressableScale>
            ) : null}
          </View>

          {/* Attribution, last and quiet. Absent entirely for an own thesis —
              and for a post card, where the header and body already ARE the
              attribution and the source. */}
          {isPostCard || sourceHandleAlreadyShown ? null : (
            <>
              <SourceCitation
                origins={sandwich.origins}
                expanded={sourceExpanded}
                onToggle={() => setSourceExpanded((open) => !open)}
              />
              {sourceExpanded ? (
                <View style={styles.citationEmbed}>
                  {isXPost ? (
                    <XPostPreview source={sandwich.source} compact />
                  ) : sourceVideo ? (
                    <SourceVideoCard video={sourceVideo} compact onPress={() => onPress(sandwich)} />
                  ) : null}
                </View>
              ) : null}
            </>
          )}

          <RemixCitation parent={sandwich.remixedFrom} />

          {/* Inline action row: engagement left, asset/PnL pill right. */}
          <View style={styles.cardActionsRow}>
            {actionButtons}
            {sandwich.legs.length > 0 || hasPnl ? (
              <View style={styles.cardAssetPnlPill}>
                <CardAssetIcons legs={sandwich.legs} />
                {hasPnl ? (
                  <Text
                    numberOfLines={1}
                    style={[styles.cardPnlInline, { color: pnlColor(sandwich.pnlPct, colors) }]}
                  >
                    {formatCardPnl(sandwich.pnlPct)}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>
      </View>
      </PressableScale>
    </View>
  );
});

/**
 * A holder's take, drawn as a post in a profile's Posts timeline.
 *
 * Built from the post card's own styles — same avatar, byline, timestamp, body
 * type and trailing pill — so a take reads as one more post rather than a
 * different kind of row. The pill carries the position's return at the time of
 * writing, beside the basket's assets when the host has the sandwich.
 */
export const TakePostCard = React.memo(function TakePostCard({
  take,
  sandwich,
  onPress,
}: {
  take: PositionTake;
  sandwich?: Sandwich | null;
  onPress: (take: PositionTake) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const handle = take.author.username ?? take.author.name ?? "someone";
  const position = take.stamp.closed ? "Closed" : `Holding · ${ageLabel(take.stamp.ageDays)}`;
  const meta = [
    position,
    take.signal ? TAKE_SIGNAL_LABEL[take.signal] ?? take.signal : null,
    visibleSizeBand(take.sizeBand),
  ].filter(Boolean).join(" · ");

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`Take by @${handle}${sandwich ? ` on ${sandwich.name}` : ""}`}
      onPress={() => onPress(take)}
      scaleTo={CARD_PRESS_SCALE}
      style={styles.card}
    >
      <View style={styles.cardRow}>
        {take.author.avatarUrl ? (
          <Image source={{ uri: take.author.avatarUrl }} style={styles.cardAvatar} cachePolicy="memory-disk" />
        ) : (
          <View style={styles.cardAvatarCircle}>
            <Ionicons name="person" size={18} color={colors.textTertiary} />
          </View>
        )}

        <View style={styles.cardContent}>
          <View style={styles.cardCreatorRow}>
            <Text numberOfLines={1} style={styles.cardHandle}>
              <Text style={styles.cardHandleAt}>@</Text>
              {handle.replace(/^@/, "")}
            </Text>
            <VerifiedBadge size={15} />
            <View style={styles.cardActionSpacer} />
            <CardTimestamp createdAt={take.createdAt} />
          </View>

          <View style={styles.cardSubHandleRow}>
            <Text numberOfLines={1} style={styles.cardSubHandle}>
              {meta}
            </Text>
          </View>

          <View style={styles.cardThesisWrap}>
            <Text style={styles.cardThesisText}>{take.body}</Text>
          </View>

          <View style={styles.cardActionsRow}>
            {sandwich ? (
              <Text numberOfLines={1} style={[styles.cardSubHandle, styles.takeBasketName]}>
                {sandwich.name}
              </Text>
            ) : null}
            <View style={styles.cardAssetPnlPill}>
              {sandwich && sandwich.legs.length > 0 ? <CardAssetIcons legs={sandwich.legs} /> : null}
              <Text
                numberOfLines={1}
                style={[styles.cardPnlInline, { color: pnlColor(take.stamp.pct, colors) }]}
              >
                {formatCardPnl(take.stamp.pct)}
              </Text>
            </View>
          </View>
        </View>
      </View>
    </PressableScale>
  );
});

/**
 * Feed card for a whole YouTube episode — the same card as every other post,
 * with the episode standing in for a single sandwich.
 *
 * Its social state is the episode's, aggregated across the markets it produced:
 * counts are summed, and the heart is lit only when every market is liked, so
 * "liked" on the card always means the whole episode. Acting on it acts on all
 * of them — see `onToggleLikeGroup`. The markets themselves (legs, prices, buy)
 * live on the episode screen, which is where tapping the card goes.
 */
export const PodcastGroupCard = React.memo(function PodcastGroupCard({
  video,
  sandwiches,
  onOpenGroup,
  onToggleLikeGroup,
  onComment,
  onShare,
}: {
  video: PodcastGroupVideo;
  sandwiches: Sandwich[];
  /**
   * Receives the episode rather than closing over it, so hosts can pass one
   * stable callback. An inline `() => open(video, sandwiches)` allocates a new
   * prop on every host render and defeats this component's `React.memo`,
   * re-rendering every video card in the feed for any unrelated state change.
   */
  onOpenGroup: (video: PodcastGroupVideo, sandwiches: Sandwich[]) => void;
  onToggleLikeGroup: (sandwiches: Sandwich[]) => void;
  onComment: (sandwich: Sandwich) => void;
  onShare: (sandwich: Sandwich) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const toast = useToast();
  const { canSave, isSaved, toggleSave } = useSavedStore();
  const heartRef = useRef<HeartToggleRef>(null);
  const handleOpenGroup = useCallback(
    () => onOpenGroup(video, sandwiches),
    [onOpenGroup, video, sandwiches],
  );

  const primary = sandwiches[0];
  // Likes and comments belong to the episode's CARD, so they are read, not
  // aggregated: every market carries the same Post counts. The old `max` was
  // undoing a per-market like fan-out that no longer happens, and the comment
  // `sum` would now count one thread once per market.
  const { likeCount, commentCount, viewerHasLiked: liked } = cardSocial(sandwiches);
  // The episode's BEST call, not its mean. A card exists to show that a call
  // worked, and an equal-weight mean buries that: an episode of eight where one
  // ran +80% averaged out to a few percent and read as nothing happening.
  //
  // `feedRank` ranks on the same figure, so the card's number and its position
  // in the feed agree.
  const { pnlPct, counted, total } = bestMarketReturn(sandwiches);
  const partialCoverage = counted > 0 && counted < total;
  // Every market's lead leg, so the icon strip shows what the episode holds.
  const iconLegs = sandwiches.flatMap((item) => item.legs.slice(0, 1));
  const bookmarked = sandwiches.every((item) => isSaved("sandwich", item.id));
  // A video card is credited to the CHANNEL: the episode is theirs, and that is
  // the name a reader recognises in the feed. The builder who shipped these
  // markets is not dropped — they move to the sub-handle line beneath it, so the
  // card says "this episode, worked up by this person".
  const creator = primary ? getCreatorMeta(primary) : null;
  const handle = video.channelHandle ?? video.channelName ?? creator?.name ?? "YouTube";
  const router = useRouter();
  const creatorPrivyUserId = creator ? primary?.source.user?.privyUserId ?? null : null;

  if (!primary) return null;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`Open ${video.title} — ${sandwiches.length} markets`}
      onPress={handleOpenGroup}
      scaleTo={CARD_PRESS_SCALE}
      style={styles.card}
    >
      <View style={styles.cardRow}>
        {/* Channel's picture first, for the same reason its name leads the row.
            Falls back to the builder's, then to the YouTube mark. */}
        {video.channelAvatarUrl ? (
          <Image source={{ uri: video.channelAvatarUrl }} style={styles.cardAvatar} cachePolicy="memory-disk" />
        ) : creator?.avatarUrl ? (
          <Image source={{ uri: creator.avatarUrl }} style={styles.cardAvatar} cachePolicy="memory-disk" />
        ) : (
          <View style={styles.cardAvatarCircle}>
            <Ionicons name="logo-youtube" size={18} color="#FF0000" />
          </View>
        )}

        <View style={styles.cardContent}>
          <View style={styles.cardCreatorRow}>
            <Text numberOfLines={1} style={styles.cardHandle}>
              {/^@?\S+$/.test(handle) ? <Text style={styles.cardHandleAt}>@</Text> : null}
              {handle.replace(/^@/, "")}
            </Text>
            {/* The channel leads the card, so the mark says where the episode
                came from rather than claiming a Bread builder wrote it. */}
            <Ionicons name="logo-youtube" size={13} color="#FF0000" />
            <View style={styles.cardActionSpacer} />
            <CardTimestamp createdAt={primary.createdAt} />
          </View>

          {/* The Bread builder who turned the episode into markets. Quiet, and
              under the channel — credit without taking the byline. */}
          {creator ? (
            <Pressable
              accessibilityRole={creatorPrivyUserId ? "button" : undefined}
              accessibilityLabel={`Open @${creator.name.replace(/^@/, "")}'s profile`}
              disabled={!creatorPrivyUserId}
              hitSlop={6}
              onPress={() => {
                if (!creatorPrivyUserId) return;
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push({ pathname: "/user-profile", params: { id: creatorPrivyUserId } });
              }}
              // Only the handle is the target, not the card's full width.
              style={[styles.cardSubHandleRow, styles.cardSubHandleTap]}
            >
              <Text numberOfLines={1} style={styles.cardSubHandle}>
                <Text style={styles.cardHandleAt}>@</Text>
                {creator.name.replace(/^@/, "")}
              </Text>
              <VerifiedBadge size={12} />
            </Pressable>
          ) : null}

          {/* Same embedded video preview a single YouTube-sourced card uses, so
              an episode reads as one post rather than a new kind of object. */}
          <SourceVideoCard
            video={{
              videoId: video.videoId,
              url: video.url,
              title: video.title,
              channelName: video.channelName,
              channelAvatarUrl: video.channelAvatarUrl,
            }}
            compact
            onPress={handleOpenGroup}
          />

          <View style={styles.holdingActionsRow}>
            <View style={styles.engagementGroup}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={liked ? "Unlike episode" : "Like episode"}
              onPress={(event) => {
                event.stopPropagation();
                heartRef.current?.toggle(!liked);
                onToggleLikeGroup(sandwiches);
              }}
              style={[styles.cardActionButton, styles.cardActionButtonCounted]}
            >
              <HeartToggle ref={heartRef} liked={liked} size={20} idleColor={colors.textSecondary} />
              <View pointerEvents="none" style={styles.likeCountSlot}>
                <Text
                  numberOfLines={1}
                  style={[styles.likeButtonText, liked && styles.likeButtonTextActive]}
                >
                  {likeCount > 0 ? formatCardCount(likeCount) : ""}
                </Text>
              </View>
            </PressableScale>
            {POST_COMMENTS_ENABLED ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Comment on episode"
                onPress={(event) => {
                  event.stopPropagation();
                  onComment(primary);
                }}
                style={[styles.cardActionButton, styles.cardActionButtonCounted]}
              >
                <Ionicons name="chatbubble-outline" size={20} color={colors.textSecondary} />
                {commentCount > 0 ? (
                  <View pointerEvents="none" style={styles.likeCountSlot}>
                    <Text numberOfLines={1} style={styles.likeButtonText}>
                      {formatCardCount(commentCount)}
                    </Text>
                  </View>
                ) : null}
              </PressableScale>
            ) : null}
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={bookmarked ? "Remove bookmarks" : "Bookmark episode"}
              accessibilityState={{ selected: bookmarked }}
              onPress={(event) => {
                event.stopPropagation();
                if (!canSave) {
                  toast.showToast("Sign in to save sandwiches", "info");
                  return;
                }
                // The episode is one thing to the viewer, so a bookmark covers
                // all of its markets — matching how the heart behaves.
                void Promise.all(
                  sandwiches
                    .filter((item) => isSaved("sandwich", item.id) === bookmarked)
                    .map((item) => toggleSave("sandwich", item.id)),
                ).then((results) => {
                  // The icon confirms itself; speak up only if a save rolled back.
                  if (results.some((saved) => saved === bookmarked)) {
                    toast.showToast("Couldn't update your bookmark. Try again.", "error");
                  }
                });
              }}
              style={styles.cardActionButton}
            >
              <BookmarkIcon
                saved={bookmarked}
                size={20}
                color={bookmarked ? colors.accentBlue : colors.textSecondary}
              />
            </PressableScale>
            {/* The episode is one card, so it shares as one link — the lead
                market's, which opens the episode it belongs to. */}
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Share episode"
              onPress={(event) => {
                event.stopPropagation();
                onShare(primary);
              }}
              style={styles.cardActionButton}
            >
              <ShareIcon size={20} color={colors.textSecondary} />
            </PressableScale>

            </View>

            {/* The X post row's closing return, led by the episode's assets.
                It fills what the fixed engagement group leaves, so the icons
                land at the same x on both kinds of post. */}
            <View style={styles.engagementReturn}>
              <CardAssetIcons legs={iconLegs} />
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                style={[styles.holdingReturn, { color: pnlColor(pnlPct, colors) }]}
              >
                {pnlPct != null
                  ? `${pnlPct < 0 ? "\u25BC" : "\u25B2"} ${formatCardPnl(pnlPct).replace(/^[+-]/, "")}`
                  : "--"}
                {/* Say so when part of the episode has no price at all, so
                    "best" is not read as best of everything. */}
                {pnlPct != null && partialCoverage ? (
                  <Text style={styles.cardPnlCoverage}>{` ${counted}/${total}`}</Text>
                ) : null}
              </Text>
            </View>
          </View>
        </View>
      </View>
    </PressableScale>
  );
});

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  // ── Holding layout: a market-list row, like the token lists. ──
  holdingCard: {
    paddingVertical: 12,
  },
  holdingMainRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  holdingCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  holdingTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  // A step under the take: the post is the content, the name is the byline.
  holdingTitle: {
    flexShrink: 1,
    color: c.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
    fontFamily: F,
  },
  holdingFace: {
    width: FEED_FACE_SIZE,
    height: FEED_FACE_SIZE,
  },
  // Anchored to the logo's bottom-right and growing leftwards, so the badges
  // sit over the lead asset rather than spilling into the text.
  holdingFaceBadges: {
    position: "absolute",
    right: -4,
    bottom: -4,
    flexDirection: "row",
    alignItems: "center",
  },
  // Ringed in the page colour to cut each badge out of what it overlaps.
  holdingFaceBadge: {
    borderRadius: FEED_BADGE_SIZE / 2 + 2,
    borderWidth: 2,
    borderColor: c.background,
  },
  // Tight enough that three badges stay within the lead logo's width.
  holdingFaceBadgeOverlap: {
    marginLeft: -9,
  },
  holdingLegPillFallback: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.surface,
  },
  holdingFaceBadgeFallback: {
    width: FEED_BADGE_SIZE,
    height: FEED_BADGE_SIZE,
    borderRadius: FEED_BADGE_SIZE / 2,
  },
  holdingLegPillFallbackText: {
    color: c.text,
    fontSize: 10,
    fontWeight: "700",
    fontFamily: F,
  },
  holdingThesis: {
    marginTop: 4,
    color: c.text,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: "500",
    fontFamily: F,
  },
  holdingActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  // Rubik, the app's figure face. The weight lives in the font file, so no
  // fontWeight — pairing one with a custom family can fall back to the system face.
  // Feed rows (X posts and YouTube episodes) give the engagement icons a fixed
  // share of the row, so their spacing never depends on how wide the return
  // beside them is — the icons line up exactly from post to post.
  engagementGroup: {
    width: "52%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  engagementReturn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
    marginLeft: 8,
  },
  holdingReturn: {
    fontSize: 15,
    fontFamily: F_DISPLAY_MEDIUM,
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
  tweetMediaFill: {
    width: "100%",
    height: "100%",
  },
  tweetMediaGrid: {
    aspectRatio: 16 / 9,
    flexDirection: "column",
    flexWrap: "wrap",
    gap: 2,
  },
  tweetMediaCell: {
    width: "49.7%",
    height: "49.6%",
  },
  tweetMediaCellTall: {
    height: "100%",
  },
  tweetPlayBadge: {
    position: "absolute",
    alignSelf: "center",
    top: "50%",
    marginTop: -20,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  tweetMedia: {
    marginTop: 10,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: c.surfaceAlt,
  },
  card: {
    paddingHorizontal: 2,
    // Keep a compact post-to-post rhythm without drawing separator rules.
    paddingTop: 16,
    paddingBottom: 8,
  },
  // Compact visual pitch with a full touch target. Counted actions get four
  // extra points so a short count can sit beside the icon without pushing the
  // remaining controls apart.
  cardActionButton: {
    width: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    minHeight: 40,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  cardActionButtonWide: {
    width: 44,
  },
  cardActionButtonCounted: {
    width: 44,
  },
  cardActionSpacer: {
    flex: 1,
  },
  cardActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  takeBasketName: {
    flex: 1,
    marginRight: 10,
  },
  cardAssetPnlPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 30,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    // A flat grey chip; the logo rings share its fill, so each circle cuts
    // cleanly out of the one beneath it.
    backgroundColor: c.surfaceAlt,
    flexShrink: 1,
    minWidth: 0,
  },
  cardAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: c.surfaceAlt,
  },
  cardAvatarCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    // Neutral default avatar (person glyph) — no per-user color or initials.
    backgroundColor: c.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  cardContent: {
    flex: 1,
    minWidth: 0,
  },
  cardCreatorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 3,
  },
  // Rung 1 (primary): the creator is what the card is about.
  cardHandle: {
    flexShrink: 1,
    color: c.text,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: "700",
    letterSpacing: 0,
    fontFamily: F,
  },
  cardHandleUnclipped: {
    flexShrink: 0,
  },
  // Rung 4 (quaternary): the "@" is pure decoration around the handle.
  cardHandleAt: {
    color: c.textQuaternary,
    fontSize: 13,
    fontWeight: "600",
  },
  cardLegsStack: {
    flexDirection: "row",
    alignItems: "center",
    // Last line of defence on very narrow screens: the stack gives up width
    // (clipping a circle) before the PnL is allowed to leave the screen.
    flexShrink: 1,
    minWidth: 0,
    overflow: "hidden",
  },
  cardLegsStackFallback: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: c.surfaceAlt,
    backgroundColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },
  cardLegsStackOverlap: {
    marginLeft: -8,
  },
  cardPnlCoverage: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: F_DISPLAY_MEDIUM,
    color: c.textTertiary,
  },
  cardPnlInline: {
    // Never yields width — the icon stack shrinks first.
    flexShrink: 0,
    fontSize: 13,
    fontWeight: "700",
    fontFamily: F_DISPLAY_MEDIUM,
    letterSpacing: -0.3,
    fontVariant: ["tabular-nums"],
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  cardShowMore: {
    color: c.accentBlue,
    fontSize: 14,
    lineHeight: 23,
    fontWeight: "500",
    fontFamily: F,
  },
  cardShowMoreOverlay: {
    position: "absolute",
    right: 0,
    bottom: 0,
    minHeight: 23,
    justifyContent: "center",
    paddingLeft: 6,
    backgroundColor: c.background,
  },
  cardSourceAvatarInitials: {
    color: c.textSecondary,
    fontSize: 13,
    fontWeight: "700",
    fontFamily: F,
  },
  cardSubHandle: {
    flexShrink: 1,
    color: c.textSecondary,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "600",
    fontFamily: F,
  },
  cardSubHandleTap: { alignSelf: "flex-start" },
  cardSubHandleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: -2,
    marginBottom: 4,
  },
  cardThesisText: {
    color: c.text,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: "500",
    fontFamily: F,
  },
  cardThesisMeasure: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    opacity: 0,
  },
  cardThesisWrap: {
    position: "relative",
  },
  // Rung 3 (tertiary): metadata. The token alone sets it back from the
  // thesis; stacking opacity on top pushed it to ~1.8:1 in light mode.
  cardTimestamp: {
    color: c.textTertiary,
    fontSize: 13,
    fontWeight: "500",
    fontFamily: F,
  },
  citationEmbed: {
    marginTop: 8,
  },
  citationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 8,
  },
  citationText: {
    flexShrink: 1,
    color: c.textTertiary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    fontFamily: F,
  },
  citationUnavailable: {
    color: c.textTertiary,
    backgroundColor: c.surfaceAlt,
    borderRadius: 4,
    overflow: "hidden",
    paddingHorizontal: 4,
    paddingVertical: 1,
    fontSize: 9,
    fontWeight: "700",
    fontFamily: F,
  },
  heartLayer: {
    alignItems: "center",
    justifyContent: "center",
  },
  legAllocationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legAllocationText: {
    // Allocation percentage under the leg name (replaces the old weight bar).
    marginTop: 4,
    color: c.textTertiary,
    fontSize: 12,
    fontWeight: "700",
    fontFamily: F,
  },
  legBody: {
    flex: 1,
    minWidth: 0,
  },
  legCopyColumn: {
    flex: 1,
    minWidth: 0,
  },
  legImageFallback: {
    width: LEG_LOGO_SIZE,
    height: LEG_LOGO_SIZE,
    borderRadius: LEG_LOGO_SIZE / 2,
    backgroundColor: c.text,
    alignItems: "center",
    justifyContent: "center",
  },
  legImageWrap: {
    width: 48,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  legMetricCluster: {
    flexShrink: 0,
    flexDirection: "column",
    alignItems: "flex-end",
    alignSelf: "flex-start",
    gap: 3,
  },
  legPnl: {
    color: c.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "900",
    textAlign: "right",
    fontFamily: F_DISPLAY_MEDIUM,
  },
  legPnlNegative: {
    color: c.chartNegative,
  },
  legPnlPositive: {
    color: c.chartPositive,
  },
  legPnlUnavailable: {
    color: c.textTertiary,
  },
  legPrice: {
    color: c.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "800",
    textAlign: "right",
    fontFamily: F,
    fontVariant: ["tabular-nums"],
  },
  legPerpNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  legPerpSide: {
    flexShrink: 0,
    fontSize: 14,
    lineHeight: 20,
    // Rubik One carries its own weight; a fontWeight would make iOS synthesise
    // a bolder face that doesn't exist.
    fontFamily: Fonts.displayOne,
    letterSpacing: 0.3,
  },
  legPerpSideLong: {
    color: c.positive,
  },
  legPerpSideShort: {
    color: c.negative,
  },
  legPrimaryTitle: {
    color: c.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: F,
  },
  legRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    overflow: "hidden",
    position: "relative",
  },
  legRowDivider: {
    borderBottomWidth: 0,
  },
  legSidePill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  legSidePillNo: {
    backgroundColor: withAlpha(c.actionSell, 0.14),
  },
  legSidePillText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "900",
    fontFamily: F,
  },
  legSidePillTextNo: {
    color: c.actionSell,
  },
  legSidePillTextYes: {
    color: c.positive,
  },
  legSidePillYes: {
    backgroundColor: withAlpha(c.positive, 0.16),
  },
  legTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  legTsChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.backgroundAlt,
  },
  legTsChipText: {
    fontFamily: F_MONO,
    fontWeight: "700",
    fontSize: 10,
    color: c.accentBlue,
  },
  // Rung 2 (secondary): a count is supporting copy, and must match the
  // icon it sits beside rather than fading out from under it.
  // Sits beside a 20pt outline icon with a ~1.5pt stroke, so the count is set
  // at a medium weight — a bold number next to a thin heart reads as two
  // different controls.
  likeButtonText: {
    fontVariant: ["tabular-nums"],
    color: c.textSecondary,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "500",
    fontFamily: F,
  },
  likeButtonTextActive: {
    color: "#FF1493",
  },
  likeCountSlot: {
    position: "absolute",
    left: 25,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  linkPreviewYtMeta: {
    flex: 1,
    gap: 3,
  },
  linkPreviewYtPlayBtn: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  linkPreviewYtThumb: {
    width: "100%",
    height: "100%",
  },
  linkPreviewYtThumbWrap: {
    width: 88,
    height: 60,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  linkPreviewYtTitle: {
    color: c.text,
    fontSize: 13,
    fontWeight: "600",
    fontFamily: F,
    lineHeight: 17,
  },
  sourceVideoAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: c.surfaceAlt,
  },
  sourceVideoChannel: {
    color: c.textSecondary,
    fontSize: 12,
    fontFamily: F,
    flexShrink: 1,
  },
  sourceVideoChannelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  sourceVideoCompact: {
    marginTop: 2,
    marginBottom: 4,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    borderRadius: 12,
    backgroundColor: c.surface,
    padding: 8,
    shadowColor: c.shadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 3,
  },
  sourceVideoHero: {
    borderRadius: 16,
    backgroundColor: c.surface,
    overflow: "hidden",
  },
  sourceVideoHeroMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
  },
  sourceVideoHeroMetaText: {
    flex: 1,
    gap: 2,
  },
  sourceVideoHeroPlayBadge: {
    width: 64,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#FF0000",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  sourceVideoHeroPlayWrap: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  sourceVideoHeroShadow: {
    marginTop: 12,
    borderRadius: 16,
    backgroundColor: c.surface,
    shadowColor: c.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  sourceVideoHeroThumbWrap: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#000",
  },});
