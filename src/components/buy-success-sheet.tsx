import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import React, { useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Pressable,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { AddThesisButton } from '@/components/add-thesis-button';
import { AssetLogo } from '@/components/asset-logo';
import { PressableScale } from '@/components/pressable-scale';
import { isXPostSource, sourcePostText } from '@/components/x-post-preview';
import { sourceYouTubeVideoId, type SandwichSource } from '@/lib/api';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import RNShare, { Social } from 'react-native-share';
import { captureRef } from 'react-native-view-shot';
import Svg, { Path, Circle } from 'react-native-svg';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { CTA, ctaBottomInset } from '@/lib/screen-corners';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { useThemeStore } from '@/lib/theme-store';
import { useToast } from '@/lib/toast-store';

const F = Fonts.rounded;
/** Rubik One — the display face the app's compact figures wear. */
const F_ONE = Fonts.displayOne;

/** iOS 26 liquid glass, where the OS has it. Everything else keeps the pill. */
const HAS_GLASS = isGlassEffectAPIAvailable();

/**
 * The pill under the glass. Translucent, not the old opaque slate-100: an
 * opaque fill *plus* an opaque tint is what made the glass read as a flat grey
 * button. This is faint enough that the material does the work and solid
 * enough that the pill never disappears against the white screen — the failure
 * the old opaque fill was guarding against.
 */
const CLOSE_BUTTON_FILL = 'rgba(15, 23, 42, 0.06)';
/** The tint carried *by* the glass — clear enough to still refract. */
const CLOSE_BUTTON_GLASS_TINT = 'rgba(15, 23, 42, 0.04)';

/** Stories sharing needs a registered Facebook App ID; without it we say so. */
const INSTAGRAM_APP_ID = process.env.EXPO_PUBLIC_INSTAGRAM_APP_ID ?? '';
/** Instagram's brand gradient, used to tint the share row's glyph. */
const INSTAGRAM_GRADIENT = ['#FEDA75', '#FA7E1E', '#D62976', '#962FBF'] as const;
/** Story background behind the shared sticker — Bread's off-white. */
const STORY_BG_TOP = '#F8FAFC';
const STORY_BG_BOTTOM = '#E2E8F0';

/** The share card's icon diameter — the styles and the logo renderer must
 *  agree on it, or the artwork sits inside a larger disc. */
const SHARE_CARD_ICON = 72;

const BRAND_GREEN = '#35F046';
/** The app's green for text and status — `positive` in the theme. */
const APP_GREEN = '#02ED45';
/** The same green as type rather than as a badge — #35F046 on white is
 *  unreadable at 15px, so numbers get the ink version of it. */
const BRAND_GREEN_INK = '#16A34A';
const BRAND_RED = '#D2042D';

/**
 * How much of the bottom edge the share + close block occupies, above the
 * safe-area inset it adds itself.
 *
 * Read off the same numbers that block's styles use rather than measured: it
 * mounts only on success, so an `onLayout` reserve would be zero for the whole
 * loading state — and the entire point of reserving it is that the receipt does
 * not move when the trade lands.
 */
const ACTIONS_BLOCK_HEIGHT = 18 + 16 + 44 + 24 + CTA.height;
/** Ground under the asset/PnL pill, and the ring that separates its circles. */
const IDENTITY_PILL_FILL = '#F1F5F9';

/**
 * PnL as the feed card prints it: big moves lose precision rather than letting
 * the pill grow wide enough to shove itself off the line.
 */
function formatPillPnl(value: number) {
  const sign = value >= 0 ? '+' : '-';
  const magnitude = Math.abs(value);
  if (magnitude >= 1000) return `${sign}${(magnitude / 1000).toFixed(1)}k%`;
  if (magnitude >= 100) return `${sign}${Math.round(magnitude)}%`;
  return `${sign}${magnitude.toFixed(2)}%`;
}

/**
 * Price display for a perp fill.
 *
 * Perps span TSLA at ~$250 and a token at $0.00004, so a fixed 2dp would print
 * "$0.00" for half the book. Small numbers get the precision they need.
 */
function formatPrice(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  if (value >= 1000) return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toPrecision(3)}`;
}

function formatSignedUsd(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '--';
  const sign = value >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

/**
 * The perps overlay of the receipt.
 *
 * A perp is still a trade, so it gets this same screen rather than a private
 * celebration of its own — but "You bought $50 of TSLA" is the wrong sentence
 * for it. This carries the three facts a stock buy has no slot for: which way
 * you went, at what leverage, and the price you got filled at.
 */
export type PerpReceipt = {
  side: 'long' | 'short';
  /** Entry leverage. Stamped next to the direction; omitted when unknown. */
  leverage?: number | null;
  /** Fill price on the way in, or the position's entry on the way out. */
  entryPrice?: number | null;
  /** Mark the exit filled at. Closing only — the other half of entry→exit. */
  exitPrice?: number | null;
  /** Collateral behind the position. */
  marginUsd?: number | null;
  /**
   * What the close pays out — collateral freed plus PnL booked. On a close
   * this is the hero figure, so the screen answers "what did I walk away
   * with" rather than "what did I put up".
   */
  exitValueUsd?: number | null;
  /** A close reads as an exit: different verb, and PnL is the headline. */
  closing?: boolean;
};

type BuySuccessSheetProps = {
  visible: boolean;
  loading: boolean;
  amount: string;
  assetName: string;
  assetSymbol: string;
  assetIcon?: string | null;
  /**
   * Artwork to fall back to when `assetIcon` misses or cannot be drawn.
   * Perps arrive with the venue's SVG mark, which a bare `<Image>` renders as
   * nothing — the receipt walks this list until something loads.
   */
  assetIconFallbacks?: (string | null | undefined)[] | null;
  /**
   * A basket's leg logos, in stack order. When present the hero becomes a fanned
   * cluster of these and the burst cycles through them, so a Sandwich gets the
   * same screen as a single asset without pretending it is one.
   */
  assetIcons?: (string | null | undefined)[];
  side?: 'buy' | 'sell';
  realizedPnlUsd?: number | null;
  realizedPnlPct?: number | null;
  /** Small line under the asset row for a fact the hero can't carry — e.g. the
   *  slice of a position a partial sell closed. */
  noteLabel?: string | null;
  /**
   * Say who the trade was in with the feed card's asset/PnL pill instead of the
   * name row.
   *
   * A Sandwich already has its name on the post quoted under the amount, so
   * spelling "Salesforce rebuild" out again above that card was the same
   * sentence twice. The pill says the part the title doesn't: which assets, and
   * what they did.
   */
  identityPill?: boolean;
  /**
   * How the idea itself has done since it was created — the figure the feed
   * card carries. Shown inside the pill, so the receipt closes on the same
   * number the card that started the trade was showing.
   */
  sincePnlPct?: number | null;
  /** Present when this receipt is for a perp rather than a spot trade. */
  perp?: PerpReceipt | null;
  /**
   * The X post this trade's thesis came from. Rendered as a card under the
   * amount, so the receipt says what you bought into and not just how much.
   */
  sourcePost?: SandwichSource | null;
  /** What was said at the moment this sandwich came from. */
  sourceCaption?: string | null;
  onShare?: () => void;
  onClose: () => void;
  /**
   * Opens the thesis composer for the position this receipt just created.
   * Present on a buy / open only — a take is written while holding, and the
   * receipt is the first moment the holder is one.
   */
  onAddThesis?: () => void;
  /** Hide the success foreground (verb/amount/PnL + actions) while an overlay
   *  like the share sheet is presented on top, so they don't bleed through. */
  contentHidden?: boolean;
  children?: React.ReactNode;
};

type Burst = {
  key: string;
  xPct: number;       // percentage of screen width (0 to 1)
  yPct: number;       // percentage of screen height (0 to 1)
  sizePct: number;    // size as percentage of screen width (e.g. 0.16)
  rotate: number;     // final rotation in degrees
  blurRadius: number; // blur radius for depth of field
  delay: number;      // animation delay in ms
};

const BURST_LAYOUT: Burst[] = [
  {
    key: 'coin-top-left-high',
    xPct: 0.18,
    yPct: 0.13,
    sizePct: 0.15,
    rotate: -25,
    blurRadius: 4,
    delay: 40,
  },
  {
    key: 'coin-top-right-high',
    xPct: 0.88,
    yPct: 0.18,
    sizePct: 0.17,
    rotate: 22,
    blurRadius: 4.5,
    delay: 120,
  },
  {
    key: 'coin-mid-left',
    xPct: 0.08,
    yPct: 0.36,
    sizePct: 0.14,
    rotate: -35,
    blurRadius: 3,
    delay: 0,
  },
  {
    key: 'coin-mid-right',
    xPct: 0.84,
    yPct: 0.42,
    sizePct: 0.18,
    rotate: 15,
    blurRadius: 0, // Crisp!
    delay: 80,
  },
  {
    key: 'coin-bottom-left',
    xPct: -0.04, // partially cut off on the left
    yPct: 0.65,
    sizePct: 0.22,
    rotate: -12,
    blurRadius: 5,
    delay: 160,
  },
  {
    key: 'coin-bottom-right',
    xPct: 0.94, // partially cut off on the right
    yPct: 0.72,
    sizePct: 0.20,
    rotate: 28,
    blurRadius: 5.5,
    delay: 200,
  },
];

function BurstPiece({
  piece,
  burstKey,
  centerX,
  centerY,
  width,
  height,
  assetIcon,
  assetIconFallbacks,
  fallbackLabel,
}: {
  piece: Burst;
  burstKey: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  assetIcon?: string | null;
  assetIconFallbacks?: (string | null | undefined)[] | null;
  fallbackLabel: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const progress = useSharedValue(0);

  const size = piece.sizePct * width;
  const left = piece.xPct * width - size / 2;
  const top = piece.yPct * height - size / 2;

  const startTranslateX = useMemo(
    () => centerX - (left + size / 2),
    [centerX, left, size],
  );
  const startTranslateY = useMemo(
    () => centerY - (top + size / 2),
    [centerY, top, size],
  );

  useEffect(() => {
    progress.value = 0;
    progress.value = withDelay(
      piece.delay,
      withSpring(1, {
        damping: 10,
        stiffness: 110,
        mass: 0.8,
      })
    );
  }, [burstKey, piece.delay, progress]);

  const animStyle = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: Math.min(1, p * 1.5),
      transform: [
        { translateX: startTranslateX * (1 - p) },
        { translateY: startTranslateY * (1 - p) },
        { scale: 0.1 + 0.9 * p },
        { rotate: `${piece.rotate * p}deg` },
      ],
    };
  });

  const burstStyle = [
    styles.burstIcon,
    {
      position: 'absolute' as const,
      left,
      top,
      width: size,
      height: size,
      borderRadius: size / 2,
      zIndex: 0,
    },
    animStyle,
  ];

  const letter = (
    <View style={[styles.burstFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.burstInitial, { fontSize: size * 0.46 }]}>
        {fallbackLabel}
      </Text>
    </View>
  );

  // Same reason the hero uses `AssetLogo`: a bare `<Image>` handed an SVG
  // draws an empty disc, so a perp's burst was six blank circles flying out.
  return (
    <Animated.View style={[burstStyle, styles.heroClip]}>
      <AssetLogo
        uri={assetIcon}
        fallbackUris={assetIconFallbacks ?? []}
        size={size}
        borderRadius={size / 2}
        backgroundColor={colors.surfaceAlt}
        blurRadius={piece.blurRadius}
        fallback={letter}
      />
    </Animated.View>
  );
}

// The large center token — the asset that was just bought/sold. It "pops out"
// of the transaction (springs up from small + slightly rotated to full size)
// while the smaller BurstPieces radiate around it, so the whole screen reads as
// the tokens flying out and settling into their final positions.
function HeroToken({
  assetIcon,
  assetIconFallbacks,
  fallbackLabel,
  size,
  animKey,
}: {
  assetIcon?: string | null;
  assetIconFallbacks?: (string | null | undefined)[] | null;
  fallbackLabel: string;
  size: number;
  animKey: number;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withSpring(1, {
      damping: 9,
      stiffness: 130,
      mass: 0.7,
    });
  }, [animKey, progress]);

  const animStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const scale = 0.3 + 0.7 * p;
    const translateY = 50 * (1 - p);
    const rotate = `${-15 + 33 * p}deg`; // starts at -15, springs to 18 degrees
    return {
      opacity: Math.min(1, p * 1.6),
      transform: [
        { scale },
        { translateY },
        { rotate },
      ],
    };
  });

  const base = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };

  const letter = (
    <View style={[styles.heroIcon, styles.heroFallback, base]}>
      <Text style={[styles.heroInitial, { fontSize: size * 0.4 }]}>{fallbackLabel}</Text>
    </View>
  );

  // `AssetLogo`, not a bare `<Image>`: half the artwork this screen is handed
  // is an SVG (Phoenix's own mark is), and `<Image>` draws an SVG as an empty
  // circle rather than falling through to the letter — which is exactly how a
  // perp receipt ended up with no icon on it at all.
  return (
    <Animated.View style={[styles.heroIcon, base, styles.heroClip, animStyle]}>
      <AssetLogo
        uri={assetIcon}
        fallbackUris={assetIconFallbacks ?? []}
        size={size}
        borderRadius={size / 2}
        backgroundColor={colors.surfaceAlt}
        fallback={letter}
      />
    </Animated.View>
  );
}

/**
 * Basket hero — the same pop-in as `HeroToken`, but the single token is a fan of
 * the basket's legs. Each leg springs in on its own short delay so the group
 * assembles rather than appearing whole, and the fan is centered on the same
 * point the burst radiates from.
 */
function HeroBasket({
  icons,
  size,
  animKey,
}: {
  icons: string[];
  size: number;
  animKey: number;
}) {
  const styles = useThemedStyles(makeStyles);
  // Past four the coins are too small to read; the rest are represented by the
  // burst that radiates behind them anyway.
  const shown = icons.slice(0, 4);
  // Overlap so the fan is roughly hero-width no matter how many legs it holds.
  const coin = size * (shown.length > 3 ? 0.5 : 0.58);
  const step = coin * 0.62;
  const spread = step * (shown.length - 1);

  return (
    <View style={[styles.heroBasket, { width: size, height: size }]}>
      {shown.map((uri, index) => (
        <HeroBasketCoin
          key={`${uri}:${index}`}
          uri={uri}
          size={coin}
          animKey={animKey}
          index={index}
          // Fanned around center, each one tipped a little further over.
          offsetX={index * step - spread / 2}
          offsetY={index % 2 === 0 ? -coin * 0.06 : coin * 0.06}
          rotate={-12 + index * (shown.length > 1 ? 24 / (shown.length - 1) : 0)}
        />
      ))}
    </View>
  );
}

function HeroBasketCoin({
  uri,
  size,
  animKey,
  index,
  offsetX,
  offsetY,
  rotate,
}: {
  uri: string;
  size: number;
  animKey: number;
  index: number;
  offsetX: number;
  offsetY: number;
  rotate: number;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withDelay(
      index * 70,
      withSpring(1, { damping: 9, stiffness: 130, mass: 0.7 }),
    );
  }, [animKey, index, progress]);

  const animStyle = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: Math.min(1, p * 1.6),
      transform: [
        { translateX: offsetX * p },
        { translateY: offsetY * p + 44 * (1 - p) },
        { scale: 0.3 + 0.7 * p },
        { rotate: `${rotate * p}deg` },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.heroBasketCoin,
        styles.heroClip,
        { width: size, height: size, borderRadius: size / 2, zIndex: index },
        animStyle,
      ]}>
      <AssetLogo
        uri={uri}
        size={size - 6}
        borderRadius={(size - 6) / 2}
        backgroundColor={colors.surfaceAlt}
        fallback={<View style={styles.heroBasketCoinBlank} />}
      />
    </Animated.View>
  );
}

function VerbSwap({
  loading,
  loadingNode,
  successNode,
}: {
  loading: boolean;
  loadingNode: React.ReactNode;
  successNode: React.ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  const successOpacity = useSharedValue(loading ? 0 : 1);
  const loadingOpacity = useSharedValue(loading ? 1 : 0);

  useEffect(() => {
    successOpacity.value = withDelay(
      loading ? 0 : 60,
      withTiming(loading ? 0 : 1, { duration: loading ? 120 : 280 }),
    );
    loadingOpacity.value = withTiming(loading ? 1 : 0, {
      duration: loading ? 200 : 140,
    });
  }, [loading, loadingOpacity, successOpacity]);

  const successStyle = useAnimatedStyle(() => ({ opacity: successOpacity.value }));
  const loadingStyle = useAnimatedStyle(() => ({ opacity: loadingOpacity.value }));

  return (
    <View style={styles.verbSlot}>
      <Animated.View style={[styles.verbLayer, loadingStyle]} pointerEvents="none">
        {loadingNode}
      </Animated.View>
      <Animated.View style={[styles.verbLayer, successStyle]} pointerEvents="none">
        {successNode}
      </Animated.View>
    </View>
  );
}

/**
 * The episode moment, as a single line on the receipt.
 *
 * Timestamp, channel, take — nothing else. A podcast source already gets the
 * full treatment (still, title, play button, seek) on the card the user bought
 * from; repeating that chrome here would rebuild the browse surface on top of a
 * confirmation. What the receipt is for is remembering WHICH moment this was,
 * and the channel mark carries that in a fraction of the height a still did.
 *
 * Fixed-light like `SourcePostReceipt`, and for the same reason: this screen is
 * white regardless of the app theme.
 */
function SourceEpisodeReceipt({
  source,
  caption,
  fallbackTitle,
  pill,
}: {
  source: SandwichSource;
  caption: string | null;
  /** Shown when the moment carries no line — this is the only title on the
   *  receipt now, so it must never render empty. */
  fallbackTitle: string;
  /** The asset/PnL pill, anchored inside the receipt at bottom-right. */
  pill?: React.ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const title = caption?.trim() || fallbackTitle.trim();

  return (
    <View style={styles.episodeCard}>
      <View style={styles.episodeCardContent}>
        <AssetLogo
          uri={source.authorAvatarUrl}
          size={20}
          borderRadius={10}
          backgroundColor={colors.surfaceAlt}
          fallback={
            <View style={styles.episodeChannelFallback}>
              <Svg width={11} height={11} viewBox="0 0 24 24">
                <Path d="M8 5v14l11-7z" fill="#ffffff" />
              </Svg>
            </View>
          }
        />
        {/* Uncapped: the take is the one thing on this screen that says WHY the
            trade happened, and an ellipsis in the middle of it defeated the
            point. It wraps rather than truncating. */}
        <Text style={styles.episodeCaption}>&ldquo;{title}&rdquo;</Text>
      </View>
      {pill ? <View style={styles.episodeCardFooter}>{pill}</View> : null}
    </View>
  );
}

/**
 * The cited X post, as a card on the receipt.
 *
 * Deliberately NOT `XPostPreview`: this screen is fixed-light — white ground,
 * near-black type — regardless of the app theme, and a themed embed dropped
 * onto it renders light-on-white the moment the user is in dark mode.
 */
function SourcePostReceipt({
  source,
  pill,
}: {
  source: SandwichSource;
  /**
   * The asset/PnL pill, parked in the card's bottom-right corner. It belongs to
   * the post rather than floating under it: what was bought and what the post
   * said are one object on the receipt.
   */
  pill?: React.ReactNode;
}) {
  const { colors } = useThemeStore();
  const styles = useThemedStyles(makeStyles);
  const text = useMemo(() => sourcePostText(source), [source]);
  const handle = source.authorHandle?.replace(/^@+/, '') ?? '';
  const displayName = source.authorName?.trim() || handle || 'X user';
  const initials =
    displayName
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'X';

  return (
    <PressableScale
      accessibilityRole={source.sourceUrl ? 'link' : 'summary'}
      accessibilityLabel={
        source.sourceUrl
          ? `Open ${displayName}'s post on X`
          : `Post by ${displayName}`
      }
      disabled={!source.sourceUrl}
      onPress={() => {
        if (!source.sourceUrl) return;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        void Linking.openURL(source.sourceUrl).catch(() => {});
      }}
      style={styles.postCard}>
      <View style={styles.postCardHeader}>
        {source.authorAvatarUrl ? (
          <Image source={{ uri: source.authorAvatarUrl }} style={styles.postCardAvatar} />
        ) : (
          <View style={[styles.postCardAvatar, styles.postCardAvatarFallback]}>
            <Text style={styles.postCardInitials}>{initials}</Text>
          </View>
        )}
        <View style={styles.postCardIdentity}>
          <Text numberOfLines={1} style={styles.postCardName}>
            {displayName}
          </Text>
          {handle ? (
            <Text numberOfLines={1} style={styles.postCardHandle}>
              @{handle}
            </Text>
          ) : null}
        </View>
        <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
          <Path
            d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
            fill={colors.text}
          />
        </Svg>
      </View>
      {text ? (
        <Text numberOfLines={3} style={styles.postCardBody}>
          {text}
        </Text>
      ) : null}
      {pill ? <View style={styles.postCardFooter}>{pill}</View> : null}
    </PressableScale>
  );
}

/**
 * The feed card's asset/PnL pill, on the receipt.
 *
 * Deliberately the same object a Sandwich wears in the feed — a stack of the
 * leg logos and what the position did — so the screen that ends the trade and
 * the card that started it say who this was in the same way. Capped at three
 * circles for the same reason the card caps: past three they stop reading as
 * assets and start reading as texture.
 */
function AssetPnlPill({
  icons,
  iconFallbacks,
  fallbackLabel,
  pnlPct,
}: {
  icons: string[];
  iconFallbacks?: (string | null | undefined)[] | null;
  fallbackLabel: string;
  /** The idea's return since it was created, not what this trade realized. */
  pnlPct?: number | null;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const visible = icons.slice(0, 3);
  const hasPnl = pnlPct != null && Number.isFinite(pnlPct);
  if (visible.length === 0 && !hasPnl) return null;

  return (
    <View style={styles.identityPill}>
      {visible.map((uri, index) => (
        <View key={`${uri}-${index}`} style={index > 0 ? styles.identityPillOverlap : undefined}>
          <AssetLogo
            uri={uri}
            // Only a single asset has a fallback list of its own; a basket's
            // circles each belong to a different leg.
            fallbackUris={visible.length === 1 ? (iconFallbacks ?? []) : []}
            size={22}
            borderRadius={11}
            backgroundColor={colors.surfaceAlt}
            borderWidth={2}
            borderColor={colors.surfaceAlt}
            fallback={
              <View style={styles.identityPillIconFallback}>
                <Text style={styles.identityPillIconInitial}>{fallbackLabel}</Text>
              </View>
            }
          />
        </View>
      ))}
      {hasPnl ? (
        <Text
          numberOfLines={1}
          style={[
            styles.identityPillPnl,
            pnlPct === 0
              ? null
              : { color: (pnlPct as number) > 0 ? APP_GREEN : BRAND_RED },
          ]}>
          {formatPillPnl(pnlPct as number)}
        </Text>
      ) : null}
    </View>
  );
}

function ActionsFade({
  children,
  stretch = false,
}: {
  children: React.ReactNode;
  /**
   * Fill the centered stack's width instead of shrink-wrapping the child.
   *
   * Without it this wrapper is sized by its content, so a child laid out as a
   * row resolves any `flex: 1` inside it against an undefined width — which
   * collapses that child to zero. Set it whenever the content is a row that
   * needs to divide the line up.
   */
  stretch?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(12);

  useEffect(() => {
    opacity.value = withDelay(220, withTiming(1, { duration: 320 }));
    translateY.value = withDelay(
      220,
      withTiming(0, { duration: 320 } as any),
    );
  }, [opacity, translateY]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[style, stretch && styles.fadeStretch]}>
      {children}
    </Animated.View>
  );
}

/**
 * The image that actually gets shared — a still, self-contained receipt.
 *
 * Not a capture of the live screen: that one is a white full-bleed page whose
 * bottom half is the share row and the Close button, and whose hero is
 * mid-spring at any given moment. This is a fixed 320-wide card that reads as
 * a shareable object on someone's story, sized once so the capture is
 * deterministic no matter which device took it.
 */
const InstagramGlyph = React.memo(function InstagramGlyph({
  size = 24,
}: {
  size?: number;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <MaskedView
      style={{ width: size, height: size }}
      maskElement={
        <View style={styles.igMask}>
          <Ionicons name="logo-instagram" size={size} color="#000000" />
        </View>
      }>
      <LinearGradient
        colors={INSTAGRAM_GRADIENT as unknown as readonly [string, string, ...string[]]}
        start={{ x: 0, y: 1 }}
        end={{ x: 1, y: 0 }}
        style={styles.igGradient}
      />
    </MaskedView>
  );
});

function ShareCard({
  icons,
  iconFallbacks,
  fallbackLabel,
  verb,
  amountDisplay,
  assetName,
  assetSymbol,
  perp,
  accent,
  realizedPnlUsd,
  realizedPnlPct,
}: {
  icons: string[];
  iconFallbacks?: (string | null | undefined)[] | null;
  fallbackLabel: string;
  verb: string;
  amountDisplay: string;
  assetName: string;
  assetSymbol: string;
  perp?: PerpReceipt | null;
  accent?: string | null;
  realizedPnlUsd: number | null;
  realizedPnlPct: number | null;
}) {
  const styles = useThemedStyles(makeStyles);
  const shown = icons.slice(0, 4);
  const closing = perp?.closing === true;
  const hasPnl = realizedPnlUsd != null && Number.isFinite(realizedPnlUsd);
  const pnlPositive = (realizedPnlUsd ?? 0) >= 0;
  const ink = closing ? (pnlPositive ? BRAND_GREEN_INK : BRAND_RED) : (accent ?? BRAND_GREEN);

  const iconStack =
    shown.length > 0 ? (
      shown.map((uri, index) => (
        <View
          key={`${uri}:${index}`}
          style={[
            styles.shareCardIcon,
            // Overlapped into a stack so a four-leg basket still reads as
            // one object rather than a row of unrelated coins.
            index > 0 && styles.shareCardIconOverlap,
            styles.heroClip,
          ]}>
          {/* `AssetLogo`, not `<Image>`: the shared PNG is the artifact people
              actually see, and an SVG logo captured through a bare `<Image>`
              lands in it as an empty grey disc. */}
          <AssetLogo
            uri={uri}
            fallbackUris={index === 0 ? (iconFallbacks ?? []) : []}
            size={SHARE_CARD_ICON}
            borderRadius={SHARE_CARD_ICON / 2}
            backgroundColor="#e8eef5"
            // The ring goes on the artwork, not the wrapper: an inset border
            // keeps the logo the same size instead of cropping it.
            borderWidth={index > 0 ? 3 : undefined}
            borderColor={index > 0 ? '#ffffff' : undefined}
            fallback={
              <View style={[styles.shareCardIcon, styles.shareCardIconFallback]}>
                <Text style={styles.shareCardIconInitial}>{fallbackLabel}</Text>
              </View>
            }
          />
        </View>
      ))
    ) : (
      <View style={[styles.shareCardIcon, styles.shareCardIconFallback]}>
        <Text style={styles.shareCardIconInitial}>{fallbackLabel}</Text>
      </View>
    );

  return (
    <View style={styles.shareCard}>
      <View style={styles.shareCardIcons}>{iconStack}</View>

      {perp ? (
        <View
          style={[
            styles.shareCardPerpBadge,
            { borderColor: ink, backgroundColor: `${ink}14` },
          ]}>
          <Text style={[styles.shareCardPerpBadgeText, { color: ink }]}>
            {perp.side === 'long' ? 'LONG' : 'SHORT'}
            {perp.leverage != null && Number.isFinite(perp.leverage) && perp.leverage > 0
              ? `  ${Math.round(perp.leverage)}×`
              : ''}
          </Text>
        </View>
      ) : null}

      <Text style={styles.shareCardVerb}>{verb}</Text>
      <Text
        style={styles.shareCardAmount}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.5}>
        {amountDisplay}
      </Text>
      <Text style={styles.shareCardAsset} numberOfLines={1}>
        {assetName}
        {assetSymbol ? ` (${assetSymbol})` : ''}
      </Text>

      {closing ? (
        // Entry → exit → PnL, the same ledger the live screen shows, so the
        // shared image is the receipt and not a teaser for it.
        <View style={styles.shareCardLedger}>
          <View style={styles.shareCardLedgerRow}>
            <Text style={styles.shareCardLedgerLabel}>ENTRY</Text>
            <Text style={styles.shareCardLedgerValue}>
              {formatPrice(perp?.entryPrice) ?? '--'}
            </Text>
          </View>
          <View style={styles.shareCardLedgerRow}>
            <Text style={styles.shareCardLedgerLabel}>EXIT</Text>
            <Text style={styles.shareCardLedgerValue}>
              {formatPrice(perp?.exitPrice) ?? '--'}
            </Text>
          </View>
          <View style={styles.shareCardLedgerRow}>
            <Text style={styles.shareCardLedgerLabel}>P&amp;L</Text>
            <Text style={[styles.shareCardLedgerValue, { color: ink }]}>
              {hasPnl ? formatSignedUsd(realizedPnlUsd) : '--'}
              {hasPnl && realizedPnlPct != null && Number.isFinite(realizedPnlPct)
                ? ` (${realizedPnlPct >= 0 ? '+' : ''}${realizedPnlPct.toFixed(2)}%)`
                : ''}
            </Text>
          </View>
        </View>
      ) : hasPnl ? (
        <Text
          style={[
            styles.shareCardPnl,
            pnlPositive ? styles.shareCardPnlUp : styles.shareCardPnlDown,
          ]}>
          {formatSignedUsd(realizedPnlUsd)}
          {realizedPnlPct != null && Number.isFinite(realizedPnlPct)
            ? ` (${realizedPnlPct >= 0 ? '+' : ''}${realizedPnlPct.toFixed(2)}%)`
            : ''}
        </Text>
      ) : null}

      <View style={styles.shareCardDivider} />
      <Text style={styles.shareCardBrand}>🍞 Bread</Text>
    </View>
  );
}

type SocialButtonProps = {
  label: string;
  /** Overrides the default "Share to <label>" — "Share to More" reads wrong. */
  a11yLabel?: string;
  onPress: () => void;
  children: React.ReactNode;
};

function SocialButton({ label, a11yLabel, onPress, children }: SocialButtonProps) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yLabel ?? `Share to ${label}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.socialBtn,
        pressed && styles.socialBtnPressed,
      ]}
    >
      {children}
    </Pressable>
  );
}

/** The completed round-trip details shown after closing a perp position. */
function PerpReceiptDetail({
  perp,
  realizedPnlUsd,
  realizedPnlPct,
}: {
  perp: PerpReceipt;
  realizedPnlUsd?: number | null;
  realizedPnlPct?: number | null;
}) {
  const styles = useThemedStyles(makeStyles);
  if (!perp.closing) return null;

  const entry = formatPrice(perp.entryPrice);
  const exit = formatPrice(perp.exitPrice);
  const margin =
    perp.marginUsd != null && Number.isFinite(perp.marginUsd) && perp.marginUsd > 0
      ? `$${perp.marginUsd.toFixed(2)}`
      : null;
  const hasPnl = realizedPnlUsd != null && Number.isFinite(realizedPnlUsd);
  const pnlPositive = (realizedPnlUsd ?? 0) >= 0;

  // ── The exit ledger ──────────────────────────────────────────────────────
  // A close is a completed round trip, so it gets the whole story on one card:
  // the price it was opened at, the price it was shut at, and the dollars that
  // fell out of the difference. The hero above is the payout; this is the
  // arithmetic behind it, which is the part someone screenshots.
  return (
    <View style={styles.perpDetail}>
      <View style={styles.exitCard}>
          <View style={styles.exitPriceRow}>
            <View style={styles.exitPriceCell}>
              <Text style={styles.exitLabel}>ENTRY</Text>
              <Text style={styles.exitValue} numberOfLines={1}>
                {entry ?? '--'}
              </Text>
            </View>
            <View style={styles.exitArrow}>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M5 12h13m0 0-5-5m5 5-5 5"
                  stroke="#CBD5E1"
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </View>
            <View style={[styles.exitPriceCell, styles.exitPriceCellEnd]}>
              <Text style={styles.exitLabel}>EXIT</Text>
              <Text style={styles.exitValue} numberOfLines={1}>
                {exit ?? '--'}
              </Text>
            </View>
          </View>

          <View style={styles.exitDivider} />

          <View style={styles.exitPnlRow}>
            <Text style={styles.exitLabel}>PROFIT / LOSS</Text>
            <View style={styles.exitPnlValueWrap}>
              <Text
                style={[
                  styles.exitPnlValue,
                  { color: hasPnl ? (pnlPositive ? BRAND_GREEN_INK : BRAND_RED) : '#0B1622' },
                ]}
                numberOfLines={1}>
                {hasPnl ? formatSignedUsd(realizedPnlUsd) : '--'}
              </Text>
              {hasPnl && realizedPnlPct != null && Number.isFinite(realizedPnlPct) ? (
                <View
                  style={[
                    styles.exitPnlPill,
                    {
                      backgroundColor: pnlPositive
                        ? 'rgba(22, 163, 74, 0.10)'
                        : 'rgba(255, 26, 184, 0.10)',
                    },
                  ]}>
                  <Text
                    style={[
                      styles.exitPnlPct,
                      { color: pnlPositive ? BRAND_GREEN_INK : BRAND_RED },
                    ]}>
                    {realizedPnlPct >= 0 ? '+' : ''}
                    {realizedPnlPct.toFixed(2)}%
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {margin ? (
            <>
              <View style={styles.exitDivider} />
              <View style={styles.exitPnlRow}>
                <Text style={styles.exitLabel}>COLLATERAL RETURNED</Text>
                <Text style={styles.exitSecondaryValue}>{margin}</Text>
              </View>
            </>
          ) : null}
      </View>
    </View>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function BuySuccessSheet({
  visible,
  loading,
  amount,
  assetName,
  assetSymbol,
  assetIcon,
  assetIconFallbacks,
  assetIcons,
  side = 'buy',
  realizedPnlUsd = null,
  realizedPnlPct = null,
  noteLabel = null,
  identityPill = false,
  sincePnlPct = null,
  perp = null,
  sourcePost = null,
  sourceCaption = null,
  onShare,
  onClose,
  onAddThesis,
  contentHidden = false,
  children,
}: BuySuccessSheetProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const hasHapticFiredRef = useRef(false);
  /** The off-screen receipt, captured on every share tap. */
  const shareCardRef = useRef<View>(null);
  const toast = useToast();

  const burstKey = useMemo(() => {
    void visible;
    void loading;
    return Math.floor(Math.random() * 1e6);
  }, [visible, loading]);

  const burst = useMemo(
    () => (visible && !loading ? BURST_LAYOUT : []),
    [visible, loading],
  );

  useEffect(() => {
    if (!visible || loading) {
      if (!visible) hasHapticFiredRef.current = false;
      return;
    }
    if (hasHapticFiredRef.current) return;
    hasHapticFiredRef.current = true;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setTimeout(() => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }, 120);
    setTimeout(() => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }, 340);
  }, [visible, loading]);

  const isSell = side === 'sell';
  // A perp names the direction it went instead of "bought"/"sold" — going short
  // is not selling anything you owned, and closing 10x is not a sale either.
  const perpClosing = perp?.closing === true;
  const perpLeverageLabel =
    perp?.leverage != null && Number.isFinite(perp.leverage) && perp.leverage > 0
      ? `${Math.round(perp.leverage)}× `
      : '';
  const verbPast = perp
    ? perpClosing
      ? // The hero under this verb is the payout, so the sentence has to lead
        // into it: "You closed / $412.80" reads as the size of the position.
        'You exited with'
      : perp.side === 'long'
        ? `You ${perpLeverageLabel}longed`
        : `You ${perpLeverageLabel}shorted`
    : isSell
      ? 'You sold'
      : 'You bought';
  const verbProgressive = perp
    ? perpClosing
      ? 'closing'
      : perp.side === 'long'
        ? 'going long'
        : 'going short'
    : isSell
      ? 'selling'
      : 'buying';
  // Direction owns the accent on the way in; on the way out the *result* does,
  // because a short closed at a profit is a green moment even though shorts are
  // pink going in.
  const perpAccent = perp
    ? perpClosing
      ? (realizedPnlUsd ?? 0) >= 0
        ? BRAND_GREEN
        : BRAND_RED
      : perp.side === 'long'
        ? BRAND_GREEN
        : BRAND_RED
    : null;
  const trimmedAmount = amount.trim();
  const amountDisplay = trimmedAmount.startsWith('$')
    ? trimmedAmount
    : `$${trimmedAmount || '0'}`;
  // Only an actual X post earns the card. A YouTube or article source has no
  // post to quote, and framing one as a tweet would misdescribe it.
  const xPost = sourcePost && isXPostSource(sourcePost) ? sourcePost : null;
  // An episode gets its own, quieter line: the timestamp, the channel, the take.
  const episodeSource = sourcePost && sourceYouTubeVideoId(sourcePost) ? sourcePost : null;
  const centerX = width / 2;
  const centerY = height / 2;
  // The post card claims real vertical space between the amount and the share
  // row, so the hero gives some back rather than letting the two collide on a
  // short screen.
  // The exit ledger claims as much vertical space as a source-post card, so a
  // close gives the hero back the same amount rather than pushing the numbers
  // under the share row on a small screen.
  const heroSize =
    xPost || perpClosing
      ? Math.min(width * 0.42, 172)
      : Math.min(width * 0.52, 220);
  const pnlPositive = (realizedPnlUsd ?? 0) >= 0;
  // An entry in flight is progress, not a receipt yet. Keep the large asset
  // reveal for the success transition instead of showing the payout before the
  // transaction has landed. Exits retain their hero because it is the position
  // being closed, not an unconfirmed result.
  const showHero = !loading || isSell || perpClosing;

  // Every icon this screen has to work with. A single asset gives one; a basket
  // gives its legs. Legs with no logo are dropped rather than rendered as a row
  // of identical initials.
  const iconSet = useMemo(() => {
    const legs = (assetIcons ?? []).filter(
      (uri): uri is string => typeof uri === 'string' && uri.length > 0,
    );
    if (legs.length > 0) return legs;
    return assetIcon ? [assetIcon] : [];
  }, [assetIcon, assetIcons]);
  const isBasket = iconSet.length > 1;

  const fallbackAssetInitial = (assetSymbol || assetName || '?').slice(0, 1).toUpperCase();

  const shareMessage = useMemo(() => {
    const perpVerb = perp
      ? perp.closing
        ? 'closed my'
        : perp.side === 'long'
          ? 'longed'
          : 'shorted'
      : null;
    const perpLeverage =
      perp?.leverage != null && Number.isFinite(perp.leverage) && perp.leverage > 0
        ? ` at ${Math.round(perp.leverage)}x`
        : '';
    let msg = perpVerb
      ? `I just ${perpVerb} ${assetSymbol || assetName}${perpLeverage}`
      : `I just ${isSell ? 'sold' : 'bought'} ${amountDisplay} of ${assetName} (${assetSymbol})`;
    if ((isSell || perp?.closing) && realizedPnlUsd != null) {
      const direction = realizedPnlUsd >= 0 ? 'profit' : 'loss';
      msg += ` with a ${direction} of ${formatSignedUsd(realizedPnlUsd)}`;
      if (realizedPnlPct != null) {
        msg += ` (${realizedPnlPct >= 0 ? '+' : ''}${realizedPnlPct.toFixed(2)}%)`;
      }
    }
    msg += ' on Bread 🍞';
    return msg;
  }, [isSell, perp, amountDisplay, assetName, assetSymbol, realizedPnlUsd, realizedPnlPct]);

  /**
   * Renders the off-screen receipt to a PNG. Returns base64 (no data-URI
   * prefix) so each caller can wrap it the way its target wants.
   */
  const captureShareImage = async (): Promise<string | null> => {
    const node = shareCardRef.current;
    if (!node) return null;
    try {
      return await captureRef(node, {
        format: 'png',
        quality: 1,
        result: 'base64',
      });
    } catch {
      return null;
    }
  };

  /** `shareSingle` rejects on a user-cancelled share; that is not an error. */
  const isCancellation = (err: unknown) =>
    /did not share|cancel/i.test(err instanceof Error ? err.message : '');

  /**
   * X, with the receipt actually attached.
   *
   * Every URL scheme into X's composer carries text only — `twitter://post`
   * and the web intent both, and react-native-share's own Twitter target is
   * the same scheme — so deep-linking can never attach an image. The system
   * share sheet can: X registers a share extension that takes a PNG and opens
   * the composer with it already in the post. So the button opens the sheet
   * with the image and the words, and the user taps X once.
   *
   * The old behaviour (image on the clipboard, composer open, paste it
   * yourself) stays as the fallback for when the sheet can't be presented.
   */
  const handleShareToX = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const base64 = await captureShareImage();

    if (base64) {
      try {
        await RNShare.open({
          url: `data:image/png;base64,${base64}`,
          type: 'image/png',
          filename: 'bread-receipt',
          message: shareMessage,
          failOnCancel: false,
        });
        return;
      } catch (err) {
        if (isCancellation(err)) return;
        // fall through to the clipboard + composer route
      }
    }

    let copied = false;
    if (base64) {
      try {
        await Clipboard.setImageAsync(base64);
        copied = true;
      } catch {
        copied = false;
      }
    }
    const encoded = encodeURIComponent(shareMessage);
    try {
      try {
        await Linking.openURL(`twitter://post?message=${encoded}`);
      } catch {
        await Linking.openURL(`https://x.com/intent/tweet?text=${encoded}`);
      }
      if (copied) {
        toast.showToast('Image copied — paste it into your post', 'success');
      }
    } catch {
      toast.showToast("Couldn't open X", 'error');
    }
  };

  /**
   * The real Stories composer: the receipt goes in as a sticker over a Bread
   * background, so the user lands in Instagram with the post already made
   * rather than with a line of text to decorate themselves.
   */
  const handleShareToInstagram = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const base64 = await captureShareImage();
    if (!base64) {
      toast.showToast("Couldn't build the image", 'error');
      return;
    }

    // Stories is gated behind a registered Facebook App ID. Without one the
    // share silently no-ops, so fall back to the clipboard + the app rather
    // than pretending it worked.
    if (!INSTAGRAM_APP_ID) {
      try {
        await Clipboard.setImageAsync(base64);
        await Linking.openURL('instagram://story-camera').catch(() =>
          Linking.openURL('https://instagram.com'),
        );
        toast.showToast('Image copied — paste it into your story', 'success');
      } catch {
        toast.showToast("Couldn't open Instagram", 'error');
      }
      return;
    }

    try {
      await RNShare.shareSingle({
        social: Social.InstagramStories,
        appId: INSTAGRAM_APP_ID,
        stickerImage: `data:image/png;base64,${base64}`,
        backgroundTopColor: STORY_BG_TOP,
        backgroundBottomColor: STORY_BG_BOTTOM,
      });
    } catch (err) {
      if (!isCancellation(err)) {
        toast.showToast("Couldn't share to Instagram", 'error');
      }
    }
  };

  /**
   * The rest of the ways to share. Prefers the app's own share card when the
   * host provides one, and otherwise hands off to the system sheet — which is
   * where "more" leads everywhere else on the platform. Copying the message is
   * the last resort, not the headline behaviour it used to be.
   */
  const handleShowMore = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (onShare) {
      onShare();
      return;
    }
    // Same receipt as the two named targets — "More" is a different
    // destination, not a downgrade to a line of text.
    const base64 = await captureShareImage();
    if (base64) {
      try {
        await RNShare.open({
          url: `data:image/png;base64,${base64}`,
          type: 'image/png',
          filename: 'bread-receipt',
          message: shareMessage,
          failOnCancel: false,
        });
        return;
      } catch (err) {
        if (isCancellation(err)) return;
        // fall through to the text share below
      }
    }
    try {
      await Share.share({ message: shareMessage });
    } catch {
      try {
        await Clipboard.setStringAsync(shareMessage);
        toast.showToast('Copied to clipboard', 'success');
      } catch {
        toast.showToast("Couldn't share", 'error');
      }
    }
  };

  const assetIdentityRow = (
    <View style={styles.assetRow}>
      <AssetLogo
        uri={iconSet[0] ?? assetIcon}
        fallbackUris={assetIconFallbacks ?? []}
        size={26}
        borderRadius={13}
        backgroundColor={colors.surfaceAlt}
        fallback={
          <View style={[styles.assetIcon, styles.assetIconFallback]}>
            <Text style={styles.assetIconInitial}>
              {fallbackAssetInitial}
            </Text>
          </View>
        }
      />
      <Text style={styles.assetLabel} numberOfLines={1}>
        {assetName}
        {assetSymbol ? ` (${assetSymbol})` : ''}
      </Text>
    </View>
  );

  const identityPillNode =
    identityPill && !loading ? (
      <AssetPnlPill
        icons={iconSet}
        iconFallbacks={assetIconFallbacks}
        fallbackLabel={fallbackAssetInitial}
        pnlPct={sincePnlPct}
      />
    ) : null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      statusBarTranslucent
      onRequestClose={onClose}>
      <StatusBar barStyle="dark-content" />
      <BottomSheetModalProvider>
      <View style={styles.container}>
        {/* Burst layer — asset icons radiate out from center on success,
            for BOTH buy and sell. */}
        {!loading && !contentHidden
          ? burst.map((piece, index) => (
              <BurstPiece
                key={piece.key}
                piece={piece}
                burstKey={burstKey}
                centerX={centerX}
                centerY={centerY}
                width={width}
                height={height}
                assetIcon={iconSet.length ? iconSet[index % iconSet.length] : assetIcon}
                // A basket's coins each belong to a different leg, so the
                // single asset's fallback list only applies when there is one.
                assetIconFallbacks={isBasket ? null : assetIconFallbacks}
                fallbackLabel={fallbackAssetInitial}
              />
            ))
          : null}

        {/* Shared centered stack for BOTH buy and sell — amount + asset stay
            put across loading→success, the verb cross-fades above, and (sell
            only) the realized PnL fades in below. */}
        {/* `box-none`, not `none`: the stack itself must never intercept the
            burst behind it, but the source-post card inside it is a link. */}
        <View
          style={[
            styles.centerStack,
            // Always reserved, whether or not the actions are on screen yet:
            // the receipt must not slide up while they fade in.
            { paddingBottom: ACTIONS_BLOCK_HEIGHT + ctaBottomInset(insets.bottom) },
            contentHidden && styles.hiddenLayer,
          ]}
          pointerEvents="box-none">
          {showHero ? (
            <View style={styles.heroWrap}>
              {isBasket ? (
                <HeroBasket
                  icons={iconSet}
                  size={heroSize}
                  animKey={burstKey}
                />
              ) : (
                <HeroToken
                  assetIcon={iconSet[0] ?? assetIcon}
                  assetIconFallbacks={assetIconFallbacks}
                  fallbackLabel={fallbackAssetInitial}
                  size={heroSize}
                  animKey={burstKey}
                />
              )}
            </View>
          ) : (
            // The reveal is withheld until the trade lands (see `showHero`),
            // but its box is not: without this the verb and the amount jump
            // down the screen the moment the icon appears.
            <View style={[styles.heroWrap, { width: heroSize, height: heroSize }]} />
          )}
          <VerbSwap
            loading={loading}
            loadingNode={
              <View style={styles.verbRow}>
                <View style={styles.spinnerSpacer} />
                <Text style={[styles.verb, styles.verbLoading]}>{verbProgressive}</Text>
                <ActivityIndicator
                  size="small"
                  color={colors.textTertiary}
                  style={styles.verbSpinner}
                />
              </View>
            }
            successNode={<Text style={[styles.verb, styles.verbSuccess]}>{verbPast}</Text>}
          />
          {trimmedAmount ? (
            <Text
              style={styles.amount}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.5}>
              {amountDisplay}
            </Text>
          ) : null}
          {/* The episode line names what was bought, so the asset row under the
              amount would be a second, blander title for the same thing — and
              a Sandwich carries its name on the pill/post below instead. */}
          {episodeSource || identityPill ? null : assetIdentityRow}
          {perp && !loading && perpClosing ? (
            // The exit ledger is a full-width card, so the fade wrapper has to
            // stretch — a shrink-wrapped parent collapses it to its content.
            <ActionsFade stretch>
              <PerpReceiptDetail
                perp={perp}
                realizedPnlUsd={realizedPnlUsd}
                realizedPnlPct={realizedPnlPct}
              />
            </ActionsFade>
          ) : null}
          {xPost && !loading ? (
            <ActionsFade stretch>
              <SourcePostReceipt source={xPost} pill={identityPillNode} />
            </ActionsFade>
          ) : null}
          {episodeSource && !loading ? (
            <ActionsFade stretch>
              <SourceEpisodeReceipt
                source={episodeSource}
                caption={sourceCaption}
                fallbackTitle={assetName}
                pill={identityPillNode}
              />
            </ActionsFade>
          ) : null}
          {/* Only when there is no source card to sit inside — otherwise the
              pill is already in its bottom-right corner. */}
          {identityPillNode && !xPost && !episodeSource ? (
            <ActionsFade>{identityPillNode}</ActionsFade>
          ) : null}
          {noteLabel && !loading ? (
            <Text style={styles.noteLabel} numberOfLines={1}>
              {noteLabel}
            </Text>
          ) : null}
          {isSell && !perpClosing && !loading && realizedPnlUsd != null ? (
            <ActionsFade>
              <View style={styles.pnlRow}>
                <Text
                  style={[
                    styles.pnlValue,
                    pnlPositive ? styles.pnlPositive : styles.pnlNegative,
                  ]}>
                  {formatSignedUsd(realizedPnlUsd)}
                </Text>
              </View>
            </ActionsFade>
          ) : null}
        </View>

        {/* The thing that gets shared. Parked off-screen rather than hidden
            with `opacity: 0` — a zero-opacity subtree captures blank on
            Android, where an off-screen one renders normally. */}
        {!loading && !contentHidden ? (
          <View style={styles.shareCardHost} pointerEvents="none" collapsable={false}>
            <View ref={shareCardRef} collapsable={false}>
              <ShareCard
                icons={iconSet}
                iconFallbacks={assetIconFallbacks}
                fallbackLabel={fallbackAssetInitial}
                verb={verbPast}
                amountDisplay={amountDisplay}
                assetName={assetName}
                assetSymbol={assetSymbol}
                perp={perp ?? null}
                accent={perpAccent}
                realizedPnlUsd={isSell ? realizedPnlUsd : null}
                realizedPnlPct={isSell ? realizedPnlPct : null}
              />
            </View>
          </View>
        ) : null}

        {!loading && !contentHidden ? (
          <View
            style={[
              styles.actions,
              { paddingBottom: ctaBottomInset(insets.bottom) },
            ]}>
            <ActionsFade>
              {/* Share section */}
              <Text style={styles.shareHeader}>Share</Text>

              {/* Social icons row */}
              <View style={styles.socialRow}>
                <SocialButton label="X" onPress={handleShareToX}>
                  <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                    <Path
                      d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
                      fill={colors.text}
                    />
                  </Svg>
                </SocialButton>

                <SocialButton
                  label="Instagram"
                  a11yLabel="Share to your Instagram story"
                  onPress={handleShareToInstagram}>
                  <InstagramGlyph size={26} />
                </SocialButton>

<SocialButton
                  label="More"
                  a11yLabel="More share options"
                  onPress={handleShowMore}>
                  <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                    <Circle cx={5} cy={12} r={2} fill={colors.text} />
                    <Circle cx={12} cy={12} r={2} fill={colors.text} />
                    <Circle cx={19} cy={12} r={2} fill={colors.text} />
                  </Svg>
                </SocialButton>
              </View>

              {onAddThesis ? (
                <AddThesisButton
                  style={styles.addThesis}
                  onPress={() => {
                    // The receipt is a modal over the app; it has to go before
                    // the composer can be pushed underneath it.
                    onClose();
                    onAddThesis();
                  }}
                />
              ) : (
                <View style={{ height: 24 }} />
              )}

              {/* Close Button — the app's liquid-glass treatment (see the
                  trade actions bar): a `clear` interactive material over a
                  faint pill, not a `regular` one flooded with an opaque tint.
                  Press is a push-back rather than a fade, because dimming
                  glass just makes it look switched off. */}
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  onClose();
                }}
                scaleTo={0.97}
                style={styles.closeButtonShell}>
                {HAS_GLASS ? (
                  <GlassView
                    glassEffectStyle="clear"
                    isInteractive
                    tintColor={CLOSE_BUTTON_GLASS_TINT}
                    // This screen is fixed-light whatever the app theme is, so
                    // the scheme is stated rather than inherited.
                    colorScheme="light"
                    style={styles.closeButtonSurface}>
                    <Text style={styles.closeButtonText}>Close</Text>
                  </GlassView>
                ) : (
                  <View style={styles.closeButtonSurface}>
                    <Text style={styles.closeButtonText}>Close</Text>
                  </View>
                )}
              </PressableScale>
            </ActionsFade>
          </View>
        ) : null}
        {children}
      </View>
      </BottomSheetModalProvider>
    </Modal>
  );
}

// ─── Shared styles (buy + loading) ──────────────────────────────────────────

/**
 * Themed, except the `shareCard*` keys: that card is rendered off-screen and
 * captured as the image that goes to X / Instagram, so it keeps its light
 * design regardless of what the app is showing.
 */
const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.surface,
  },
  hiddenLayer: {
    opacity: 0,
  },
  noteLabel: {
    marginTop: 8,
    fontFamily: F,
    fontSize: 14,
    color: c.textSecondary,
  },
  heroBasket: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBasketCoinBlank: {
    flex: 1,
    alignSelf: 'stretch',
    backgroundColor: c.surfaceAlt,
  },
  heroBasketCoin: {
    position: 'absolute',
    backgroundColor: c.surfaceAlt,
    borderWidth: 3,
    borderColor: c.surface,
  },
  verbSlot: {
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verbLayer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  verbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  verb: {
    fontSize: 22,
    fontWeight: '600',
    fontFamily: F,
    color: c.textSecondary, // Slate gray matching the mockup text
    textAlign: 'center',
  },
  verbLoading: {
    color: c.text,
  },
  verbSuccess: {
    color: c.textSecondary, // Slate gray matching "You sold"
  },
  spinnerSpacer: {
    width: 22,
  },
  verbSpinner: {
    transform: [{ scale: 1.2 }],
  },
  centerStack: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    // Centred in what's left once the share row and Close have their band at
    // the bottom — `top: '14%'` centred it in nothing, which is why the
    // receipt sat in the upper third with a screen's worth of white under it.
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 24,
    zIndex: 1,
  },
  heroWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  heroIcon: {
    backgroundColor: c.surfaceAlt,
  },
  /** Keeps an SVG logo inside the hero's circle. */
  heroClip: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#5B5BF5',
  },
  heroInitial: {
    color: '#ffffff',
    fontWeight: '900',
    fontFamily: F,
  },
  amount: {
    color: c.text,
    fontSize: 54, // Large bold amount
    fontFamily: F,
    fontWeight: '900',
    letterSpacing: -2,
  },
  identityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: c.surfaceAlt,
  },
  identityPillOverlap: {
    marginLeft: -10,
  },
  identityPillIconFallback: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: c.surfaceAlt,
    backgroundColor: '#5B5BF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityPillIconInitial: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
    fontFamily: F,
  },
  identityPillPnl: {
    // Never yields width — the icon stack shrinks first, exactly as on the card.
    flexShrink: 0,
    paddingRight: 3,
    fontFamily: F_ONE,
    fontSize: 15,
    letterSpacing: -0.2,
    color: c.text,
    fontVariant: ['tabular-nums'],
  },
  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  assetIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: c.surfaceAlt,
  },
  assetIconFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#5B5BF5',
  },
  assetIconInitial: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
    fontFamily: F,
  },
  assetLabel: {
    color: c.text,
    fontSize: 18,
    fontWeight: '900',
    fontFamily: F,
  },
  perpDetail: {
    alignItems: 'center',
    marginTop: 12,
    gap: 12,
  },
  // ── Exit ledger (perp close) ─────────────────────────────────────────────
  // A raised white card on the white page: separated by a hairline and a very
  // soft shadow rather than a fill, so it reads as an object sitting on the
  // receipt without introducing a second background colour.
  exitCard: {
    alignSelf: 'stretch',
    marginTop: 2,
    backgroundColor: c.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: 18,
    paddingVertical: 14,
    shadowColor: c.shadow,
    shadowOpacity: 0.07,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  exitPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  exitPriceCell: {
    flex: 1,
    gap: 4,
  },
  exitPriceCellEnd: {
    alignItems: 'flex-end',
  },
  exitArrow: {
    paddingHorizontal: 10,
  },
  exitLabel: {
    fontFamily: F,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
    color: c.textTertiary,
  },
  exitValue: {
    fontFamily: F,
    fontSize: 19,
    fontWeight: '900',
    letterSpacing: -0.6,
    color: c.text,
  },
  exitDivider: {
    height: 1,
    backgroundColor: c.border,
    marginVertical: 12,
  },
  exitPnlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  exitPnlValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  exitPnlValue: {
    fontFamily: F,
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.6,
  },
  exitPnlPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  exitPnlPct: {
    fontFamily: F,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  exitSecondaryValue: {
    fontFamily: F,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: c.textSecondary,
  },
  pnlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  pnlValue: {
    fontSize: 38,
    fontWeight: '900',
    fontFamily: F,
    letterSpacing: -0.5,
  },
  pnlPositive: {
    color: '#02ED45', // Crisp green
  },
  pnlNegative: {
    color: BRAND_RED,
  },
  actions: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: CTA.inset,
    zIndex: 1,
  },
  addThesis: { alignSelf: 'center', marginTop: 22, marginBottom: 18 },
  shareHeader: {
    color: c.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: F,
    textAlign: 'center',
    marginBottom: 16,
    letterSpacing: 0.5,
  },
  socialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 36,
  },
  socialBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialBtnPressed: {
    opacity: 0.6,
    transform: [{ scale: 0.95 }],
  },
  // A fill underneath, always. A GlassView is a native layer that paints
  // nothing when the system judges its material invisible against the host
  // background — and this screen is pure white, exactly the case that left the
  // buy pad with a correctly-sized, silently blank confirm button. The fill is
  // translucent now, plus a hairline edge: enough that the pill is never
  // invisible, faint enough that the glass above it still reads as glass.
  closeButtonShell: {
    backgroundColor: CLOSE_BUTTON_FILL,
    borderRadius: CTA.radius,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    // No extra margin: the panel already holds the shared CTA inset, and the
    // button's corners are cut to match it.
    overflow: 'hidden',
  },
  closeButtonSurface: {
    width: '100%',
    // Explicit height: GlassView is a native view and will not auto-size to its
    // text child, so padding alone collapses it to nothing.
    minHeight: CTA.height,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ── Instagram glyph ───────────────────────────────────────────────────────
  igMask: {
    // The mask is alpha-only; its colour is thrown away. It just needs a
    // transparent ground so the gradient shows through the glyph and nowhere
    // else.
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  igGradient: {
    flex: 1,
  },
  // ── Off-screen share card ─────────────────────────────────────────────────
  // Parked well outside the viewport: still laid out and rendered (so
  // `captureRef` gets real pixels) but never drawn over the receipt.
  shareCardHost: {
    position: 'absolute',
    left: -10000,
    top: 0,
  },
  shareCard: {
    width: 320,
    paddingHorizontal: 28,
    paddingTop: 34,
    paddingBottom: 24,
    borderRadius: 32,
    backgroundColor: '#ffffff',
    alignItems: 'center',
  },
  shareCardIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  shareCardIcon: {
    width: SHARE_CARD_ICON,
    height: SHARE_CARD_ICON,
    borderRadius: SHARE_CARD_ICON / 2,
    backgroundColor: '#e8eef5',
  },
  /** Overlap only — the separating ring is drawn by `AssetLogo` itself so the
   *  artwork keeps its full diameter. */
  shareCardIconOverlap: {
    marginLeft: -22,
  },
  shareCardIconFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#5B5BF5',
  },
  shareCardIconInitial: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '900',
    fontFamily: F,
  },
  shareCardVerb: {
    color: '#64748B',
    fontSize: 17,
    fontWeight: '700',
    fontFamily: F,
  },
  shareCardAmount: {
    marginTop: 4,
    color: '#0F172A',
    fontSize: 46,
    fontWeight: '900',
    fontFamily: F,
  },
  shareCardAsset: {
    marginTop: 6,
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: F,
  },
  shareCardPerpBadge: {
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 2,
  },
  shareCardPerpBadgeText: {
    fontFamily: F,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  shareCardLedger: {
    alignSelf: 'stretch',
    marginTop: 14,
    gap: 8,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(15, 23, 42, 0.08)',
  },
  shareCardLedgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  shareCardLedgerLabel: {
    fontFamily: F,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    color: '#94A3B8',
  },
  shareCardLedgerValue: {
    fontFamily: F,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -0.3,
    color: '#0B1622',
  },
  shareCardPnl: {
    marginTop: 10,
    fontSize: 18,
    fontWeight: '800',
    fontFamily: F,
  },
  shareCardPnlUp: {
    color: '#16A34A',
  },
  shareCardPnlDown: {
    color: BRAND_RED,
  },
  shareCardDivider: {
    alignSelf: 'stretch',
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(15, 23, 42, 0.12)',
    marginTop: 22,
    marginBottom: 14,
  },
  shareCardBrand: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
    fontFamily: F,
  },
  closeButtonText: {
    color: c.text,
    fontSize: 18,
    fontWeight: '700',
    fontFamily: F,
  },
  fadeStretch: {
    alignSelf: 'stretch',
  },
  // One line under the amount: the episode is a footnote to the trade, not a
  // second subject, and a card made it compete with the hero.
  episodeCard: {
    // Hugs its line rather than the screen: a short quote in a full-width card
    // is mostly empty card. The stretched wrapper above still supplies the
    // width to wrap against, so a long quote breaks at `maxWidth` and the block
    // stays centered under the amount either way.
    alignSelf: 'center',
    maxWidth: 248,
    marginTop: 10,
    // Lifted off the white screen by shadow alone — the same treatment the post
    // card gets, and for the same reason: a tint or a border would fence the
    // line in, where this reads as it sitting on the receipt. The fill stays
    // white (not transparent) because a view with no opaque ground casts no
    // shadow on either platform.
    backgroundColor: c.surface,
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 11,
    shadowColor: c.shadow,
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  episodeCardContent: {
    flexDirection: 'row',
    // Top, not center: once the take wraps, a vertically centered stamp and
    // channel mark float beside the middle of the paragraph instead of sitting
    // on the line they belong to. Identical for a one-line take.
    alignItems: 'flex-start',
    gap: 7,
  },
  episodeCardFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 10,
  },
  // The channel, when it has no avatar of its own: the play mark, so the line
  // still reads as a video rather than as a missing image.
  episodeChannelFallback: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FF0000',
  },
  episodeCaption: {
    flexShrink: 1,
    color: c.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    fontFamily: F,
  },
  // Lifted off a white screen by shadow alone — a border would fence the post
  // in, and this reads as the post sitting on the receipt.
  postCard: {
    alignSelf: 'stretch',
    maxWidth: 420,
    marginTop: 6,
    backgroundColor: c.surface,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: c.shadow,
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  postCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  postCardAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: c.surfaceAlt,
  },
  postCardAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  postCardInitials: {
    color: c.text,
    fontSize: 12,
    fontWeight: '800',
    fontFamily: F,
  },
  postCardIdentity: {
    flex: 1,
    minWidth: 0,
  },
  postCardName: {
    color: c.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    fontFamily: F,
  },
  postCardHandle: {
    color: c.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    fontFamily: F,
  },
  postCardFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    // Clear of the post's last line, and the card's own bottom padding carries
    // the rest — the pill must never look glued to the corner radius.
    marginTop: 12,
    marginBottom: 2,
  },
  postCardBody: {
    marginTop: 8,
    color: c.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    fontFamily: F,
  },
  burstIcon: {
    backgroundColor: c.surfaceAlt,
  },
  burstFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#5B5BF5',
  },
  burstInitial: {
    color: '#ffffff',
    fontWeight: '900',
    fontFamily: F,
  },
});
