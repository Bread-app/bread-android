import { useEmbeddedSolanaWallet, usePrivy } from '@privy-io/expo';
import { useIsFocused } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SkeletonRows } from '@/components/skeleton-rows';
import type { CardSocial, Sandwich, SandwichLeg } from '@/lib/api';
import {
  appUserPayloadFromPrivyUser,
  buildAllMomentSandwiches,
  getSandwichesBySource,
  setCardLike,
} from '@/lib/api';
import { cardSocial, toggledCardSocial, withCardSocial } from '@/lib/card-social';
import { getAnonymousSocialId } from '@/lib/social-identity';
import {
  SandwichShareSheet,
  type SandwichShareSheetRef,
} from '@/components/sandwich-share-sheet';
import { listPhoenixMarkets, type PhoenixMarket } from '@/lib/phoenix-api';
import { PodcastSandwichDetail } from '@/components/podcast-sandwich-group-card';
import { AssetLogo } from '@/components/asset-logo';
import { HeldPositionActions } from '@/components/held-position-actions';
import { PodcastCallCaption, PodcastCallSheet } from '@/components/podcast-call-sheet';
import { PodcastCallDrawer } from '@/components/podcast-call-drawer';
import { PressableScale } from '@/components/pressable-scale';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { resolveLegVenue } from '@/lib/sandwich-leg-venue';
import {
  SandwichCommentsSheet,
  type SandwichCommentsSheetRef,
} from '@/components/sandwich-comments-sheet';
import { buildFeedItems, getSourceVideo } from '@/lib/sandwich-feed';
import { SandwichPositionCard } from '@/components/sandwich-position-card';
import { SandwichSellPad } from '@/screens/sandwich-screen';
import { CTA, ctaBottomInset } from '@/lib/screen-corners';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { PositionTakesSection } from '@/components/position-takes-section';
import { formatTimestamp, getMomentWindow } from '@/lib/moment';
import { callCaption } from '@/lib/podcast-call-format';
import { usePodcastGroup } from '@/lib/podcast-group-store';
import { useSavedStore } from '@/lib/saved-store';
import {
  getStoredSandwichPositions,
  type SandwichPosition,
} from '@/lib/sandwich-positions';
import { useTradeFx } from '@/lib/trade-fx';
import { useToast } from '@/lib/toast-store';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { useThemeStore } from '@/lib/theme-store';
import { withAlpha } from '@/lib/color-utils';

const F = Fonts.rounded;

// iOS 26 Liquid Glass, the same gate the sandwich detail's BUY uses. Older iOS
// and Android take the solid tinted fill below — the glass layer is an
// enhancement, never the thing that makes the button visible.
const HAS_GLASS = isGlassEffectAPIAvailable();
const ACTION_TINT_ALPHA = 0.78;
const SELECT_TINT_ALPHA = 0.42;
const SELECT_FALLBACK_ALPHA = 0.86;

/**
 * The call's assets on the action button. Overlapped like the card's pill, and
 * ringed so they stay legible on a saturated tint.
 */
function ActionAssetFaces({
  legs,
  styles,
}: {
  legs: SandwichLeg[];
  styles: ReturnType<typeof makeStyles>;
}) {
  if (legs.length === 0) return null;
  return (
    <View style={styles.actionButtonFaces}>
      {legs.map((leg, index) => (
        <View
          key={leg.id}
          style={[styles.actionButtonFace, index > 0 && styles.actionButtonFaceOverlap]}
        >
          <AssetLogo
            uri={leg.imageUrl}
            size={30}
            fallback={
              <View style={styles.actionButtonFaceFallback}>
                <Text style={styles.actionButtonFaceFallbackText}>
                  {(leg.underlyingSymbol ?? leg.symbol ?? leg.label).slice(0, 1).toUpperCase()}
                </Text>
              </View>
            }
          />
        </View>
      ))}
    </View>
  );
}

/** `mm:ss` for a call's moment, or null when it carries no window. */
function momentTimestampLabel(sandwich: Sandwich): string | null {
  const window = getMomentWindow(sandwich);
  return window ? formatTimestamp(window.startMs) : null;
}

/** The instrument a call leads with — the one its trade sheet opens on. */
function primaryLeg(sandwich: Sandwich): SandwichLeg | null {
  return sandwich.legs[0] ?? null;
}

/**
 * The ONLY screen a YouTube-sourced call has: the channel, the video, then every
 * timestamped market it produced.
 *
 * Nothing here pushes another route. A market raises the asset drawer in place —
 * the spot sheet for a long, the Phoenix perp sheet already on Short for a
 * short — so the episode stays on screen behind it and the next call is one
 * dismissal away. Tapping a timestamp seeks the player to the moment.
 *
 * Markets are normally handed over in memory by `podcast-group-store` (the feed
 * already loaded them); `sourceId` on the route is the cold-entry fallback.
 */
export function PodcastSandwichScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const insets = useSafeAreaInsets();
  const { group, hydrate, applyUpdate } = usePodcastGroup();
  const toast = useToast();
  const scrollRef = useRef<ScrollView>(null);
  const commentsSheetRef = useRef<SandwichCommentsSheetRef>(null);
  /**
   * The call the viewer has picked. One at a time: the list outlines it and the
   * action bar below carries its trade. It holds the replay closure the list
   * handed up, because the caption inside the pad is a play button and the
   * player belongs to the list.
   */
  const [selectedCall, setSelectedCall] = useState<{
    sandwich: Sandwich;
    leg: SandwichLeg;
    replayMoment: (() => void) | null;
  } | null>(null);
  /**
   * The side the action bar was tapped with — non-null while the pad is up.
   * `close` is the exit: it raises the Sandwich sell pad instead of the call
   * sheet, over the same drawer.
   */
  const [padSide, setPadSide] = useState<'buy' | 'long' | 'short' | 'close' | null>(null);
  /**
   * Live perp markets, loaded once for the episode. The sheet resolves each
   * leg's venue against these; an empty list simply reads as "no perp market
   * yet" and corrects itself when they land.
   */
  const [markets, setMarkets] = useState<PhoenixMarket[]>([]);
  const shareSheetRef = useRef<SandwichShareSheetRef>(null);
  // Likes are attributed to the viewer's social identity, resolved once here.
  // Null until it lands, which is what gates the like button.
  const [anonymousId, setAnonymousId] = useState<string | null>(null);
  const { user } = usePrivy();
  const appUser = useMemo(() => appUserPayloadFromPrivyUser(user), [user]);
  const tradeFx = useTradeFx();
  const isFocused = useIsFocused();
  const solanaWallet = useEmbeddedSolanaWallet();
  const walletAddress = solanaWallet.wallets?.[0]?.address ?? null;
  /**
   * What the viewer already holds, keyed by sandwich id.
   *
   * A YouTube call has no detail route — `sandwich-detail-store` sends every
   * one of them here — so this screen is the only place a held call can be seen
   * and closed from. Positions are local to the wallet (SecureStore), which is
   * the same source the Holdings list reads, so the two never disagree.
   */
  const [positions, setPositions] = useState<Record<string, SandwichPosition>>({});
  /**
   * Height of the pinned action block, measured, so the list can scroll clear
   * of it. Seeded at the lone button's height so the first frame is not short.
   */
  const [actionBlockHeight, setActionBlockHeight] = useState(108);
  /**
   * The position the close drawer is operating on, pinned at open time.
   *
   * A full close removes the row from `positions` the instant the sell lands,
   * which would empty the drawer mid-dismissal if it read from there. Holding
   * the copy until the drawer is actually gone is what lets the pad finish its
   * own exit; a partial sell writes the scaled position back here, so the pad
   * re-renders on the remainder.
   */
  const [closingPosition, setClosingPosition] = useState<SandwichPosition | null>(null);
  const { canSave, isSaved, toggleSave } = useSavedStore();
  const commentsOpenedRef = useRef<string | null>(null);
  const {
    sourceId,
    focus,
    comments: commentsFor,
  } = useLocalSearchParams<{ sourceId?: string; focus?: string; comments?: string }>();
  const [recoveryFailed, setRecoveryFailed] = useState(false);

  // `viewerHasLiked` is per-identity, so clear it before resolving the next one
  // — otherwise account A's lit heart flashes for account B.
  useEffect(() => {
    let cancelled = false;
    setAnonymousId(null);
    void getAnonymousSocialId(appUser?.privyUserId).then((value) => {
      if (!cancelled) setAnonymousId(value);
    });
    return () => {
      cancelled = true;
    };
  }, [appUser?.privyUserId]);

  /**
   * Read the wallet's stored Sandwich positions.
   *
   * Also the write-back after a sell: the pad hands up the scaled position (or
   * null on a full close), and re-reading is what keeps this map in step with
   * what SecureStore now holds rather than with what it held on arrival.
   */
  const loadPositions = useCallback(async () => {
    if (!walletAddress) {
      setPositions({});
      return;
    }
    const stored = await getStoredSandwichPositions(walletAddress).catch(() => []);
    setPositions(
      Object.fromEntries(stored.map((position) => [position.sandwichId, position])),
    );
  }, [walletAddress]);

  // Also on re-focus: a buy or a sell made anywhere else in the app writes to
  // the same store, and coming back to a stale summary is worse than a spare
  // read of SecureStore.
  useEffect(() => {
    if (!isFocused) return;
    void loadPositions();
  }, [isFocused, loadPositions]);

  useEffect(() => {
    let cancelled = false;
    void listPhoenixMarkets()
      .then((next) => {
        if (!cancelled) setMarkets(next);
      })
      // A miss only costs perp routing, and the sheet says so in place. It must
      // never keep the episode from opening.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Entered cold — a share link, or the in-memory group was lost. Every market
  // of an episode shares a `sourceId`, so one call rebuilds the whole screen.
  // `buildFeedItems` is reused rather than re-deriving the video here, so the
  // episode header is assembled exactly the way the feed assembles it.
  useEffect(() => {
    if (group || !sourceId) return;
    let cancelled = false;
    const recover = async () => {
      const item = (sandwiches: Sandwich[]) =>
        buildFeedItems(sandwiches).find((entry) => entry.kind === 'video');

      let found = item(await getSandwichesBySource(sourceId));
      if (cancelled) return;

      // Nothing on the server yet does NOT mean nothing exists. An episode's
      // markets are normally built client-side, by the composer, when the user
      // comes back to it — so arriving here first (a share link, or a push
      // tapped from a cold start) finds an analyzed source with no Sandwich
      // rows behind it. Build them, then look again. Without this the most
      // common way to reach this screen lands on "no longer loaded".
      if (!found) {
        await buildAllMomentSandwiches(sourceId, appUser).catch(() => {});
        if (cancelled) return;
        found = item(await getSandwichesBySource(sourceId));
        if (cancelled) return;
      }

      if (found && found.kind === 'video') hydrate({ video: found.video, sandwiches: found.sandwiches });
      else setRecoveryFailed(true);
    };
    void recover().catch(() => {
      if (!cancelled) setRecoveryFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [appUser, group, hydrate, sourceId]);

  // The feed's comment button targets one market, and now lands here instead of
  // a detail screen — so the drawer has to open on arrival or that button would
  // silently do nothing. Once per id, so a re-render never reopens it.
  useEffect(() => {
    if (!commentsFor || !group) return;
    if (commentsOpenedRef.current === commentsFor) return;
    const target = group.sandwiches.find((item) => item.id === commentsFor);
    if (!target) return;
    commentsOpenedRef.current = commentsFor;
    const frame = requestAnimationFrame(() => {
      // The thread is the CARD's; the market only anchors what gets written.
      commentsSheetRef.current?.open(target, target.commentCount);
    });
    return () => cancelAnimationFrame(frame);
  }, [commentsFor, group]);

  // The player lives at the top of the card, so a timestamp tapped on a market
  // far down the list has to bring it back into view — otherwise the video
  // starts playing somewhere off-screen. `y: 0` is exact because the player is
  // the card's first child; no measureLayout needed.
  const scrollToPlayer = useCallback(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

  /**
   * Like/unlike the EPISODE, optimistically. One request, whatever the episode
   * holds — the markets on this screen are one card.
   *
   * The group store is the only copy of these rows on this screen, so both the
   * optimistic write and the roll-back go through it, and they cover every
   * market: the heart reads off the card's state, so leaving one row behind
   * would make the heart flicker as the list re-renders.
   */
  const toggleLikeEpisode = useCallback(
    async (episode: Sandwich[]) => {
      const [card] = episode;
      if (!anonymousId || !card) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const before = cardSocial(episode);
      const optimistic = toggledCardSocial(before);
      const write = (social: CardSocial) => {
        for (const item of episode) applyUpdate(withCardSocial(item, social));
      };

      write(optimistic);
      try {
        write(await setCardLike(card, optimistic.viewerHasLiked, anonymousId));
      } catch {
        write(before);
        toast.showToast('Could not update that like.', 'error');
      }
    },
    [anonymousId, applyUpdate, toast],
  );

  const openComments = useCallback((sandwich: Sandwich) => {
    commentsSheetRef.current?.open(sandwich, sandwich.commentCount);
  }, []);

  /**
   * The group store is the only copy of these rows on this screen, so a comment
   * posted in the drawer has to be written back here or the row's count stays
   * at whatever it was when the episode loaded.
   *
   * The count is the CARD's, so it is written to every market of it — the
   * episode header and each call row read the same number.
   */
  const handleCommentCountChange = useCallback(
    (threadKey: string, count: number) => {
      for (const item of group?.sandwiches ?? []) {
        const key = item.postId ?? item.id;
        if (key === threadKey && item.commentCount !== count) {
          applyUpdate({ ...item, commentCount: count });
        }
      }
    },
    [applyUpdate, group],
  );

  // `present()` has to run synchronously from the tap, so this stays sync.
  const openShare = useCallback((sandwich: Sandwich) => {
    shareSheetRef.current?.open(sandwich);
  }, []);

  /**
   * Bookmark the episode. Like the heart, it covers every market — so a
   * partially-saved episode saves the remainder rather than clearing anything.
   */
  const toggleBookmarkEpisode = useCallback(
    (episode: Sandwich[], isBookmarked: boolean) => {
      if (!canSave) {
        toast.showToast('Sign in to save sandwiches', 'info');
        return;
      }
      void Promise.all(
        episode
          .filter((item) => isSaved('sandwich', item.id) === isBookmarked)
          .map((item) => toggleSave('sandwich', item.id)),
      ).then((results) => {
        // The icon confirms itself; speak up only if a save rolled back.
        if (results.some((saved) => saved === isBookmarked)) {
          toast.showToast("Couldn't update your bookmark. Try again.", 'error');
        }
      });
    },
    [canSave, isSaved, toast, toggleSave],
  );

  /** The drawer has animated away — only now is it safe to drop what it showed. */
  const handlePadClosed = useCallback(() => {
    setPadSide(null);
    setClosingPosition(null);
  }, []);

  /**
   * Pick a call. Selection is what the row outlines and what the action bar
   * reads; nothing opens until that action is tapped. Only ever one, so this
   * replaces rather than adds.
   */
  const selectCall = useCallback(
    (sandwich: Sandwich, replayMoment: (() => void) | null) => {
      const leg = primaryLeg(sandwich);
      if (!leg) {
        toast.showToast('This call has no tradable instrument.', 'error');
        return;
      }
      setSelectedCall({ sandwich, leg, replayMoment });
    },
    [toast],
  );

  /**
   * Raise the pad for the picked call, on the side the action named. It opens
   * on the instrument the call leads with; a basket switches between its legs
   * inside the pad, which is where the row's `+N` was pointing all along.
   */
  const openPad = useCallback(
    (side: 'buy' | 'long' | 'short') => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setPadSide(side);
    },
    [],
  );

  /**
   * Raise the exit for the picked call, in the same drawer the buy uses. The
   * pad itself is the sandwich screen's own — the sell path is one path, and a
   * second copy of it living here is the last thing an exit should have.
   */
  const openClosePad = useCallback(
    (position: SandwichPosition) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setClosingPosition(position);
      setPadSide('close');
    },
    [],
  );

  /**
   * What the picked call can be traded as: its venue, and the side it was
   * called on. Derived, so a market list that lands late upgrades the action
   * from a spot Buy to the perp side on its own.
   */
  const selectedTarget = useMemo(() => {
    if (!selectedCall) return null;
    const { sandwich } = selectedCall;
    // Venue is a property of the SANDWICH — a basket is homogeneous, and the
    // action buys the whole call, so it must be resolved off the basket rather
    // than off whichever leg the row happened to lead with.
    const legs = [...sandwich.legs].sort((a, b) => a.order - b.order);
    const lead = legs[0] ?? selectedCall.leg;
    const target = resolveLegVenue({ leg: lead, sandwichVenue: sandwich.venue, markets });
    if (sandwich.venue === 'perp') {
      if (!target.market) return null;
      return { side: target.side, label: target.side === 'short' ? 'Short' : 'Long' } as const;
    }
    const buyableLegs = legs.filter(
      (candidate) => candidate.type === 'tokenized_stock' && Boolean(candidate.mint),
    ).length;
    if (buyableLegs === 0) return null;
    // Just "BUY" — the faces beside it already say how many, and they say it
    // better than a count does. What changed is what the word now means: it
    // used to stand over a pad that bought exactly one of them.
    return { side: 'buy', label: 'Buy' } as const;
  }, [markets, selectedCall]);

  /**
   * The position behind the picked call, if the viewer holds it. This is what
   * turns the action bar from a lone BUY into the held pair — the position
   * summary, BUY MORE and CLOSE — matching what a non-YouTube sandwich shows on
   * its detail screen.
   */
  const selectedPosition = selectedCall ? positions[selectedCall.sandwich.id] ?? null : null;

  /**
   * Write a sell's result back.
   *
   * A partial sell hands up a scaled position and a full close hands up null;
   * either way the map is re-read from storage rather than patched, so this
   * screen and the Holdings list are reading the same rows.
   */
  const handlePositionUpdated = useCallback(
    (next: SandwichPosition | null) => {
      const sandwichId = next?.sandwichId ?? selectedCall?.sandwich.id ?? null;
      if (sandwichId) {
        setPositions((current) => {
          const draft = { ...current };
          if (next) draft[sandwichId] = next;
          else delete draft[sandwichId];
          return draft;
        });
      }
      // Only a partial sell is written back to the open drawer. A full close
      // leaves the pinned copy alone so the pad keeps its numbers while it
      // animates away — `closePad` clears it once it is gone.
      if (next) setClosingPosition(next);
      void loadPositions();
    },
    [loadPositions, selectedCall],
  );

  /** Share the picked call — the same sheet its row and the position card use. */
  const shareSelected = useCallback(() => {
    if (selectedCall) shareSheetRef.current?.open(selectedCall.sandwich);
  }, [selectedCall]);

  const selectedTicker = selectedCall
    ? selectedCall.leg.underlyingSymbol ?? selectedCall.leg.symbol ?? selectedCall.leg.label
    : '';
  /**
   * The call's assets, for the action's faces. A basket shows up to three — the
   * same shape its card carries, so the button reads as that card's action
   * rather than a generic one.
   */
  const selectedLegs = useMemo(
    () =>
      selectedCall
        ? [...selectedCall.sandwich.legs].sort((a, b) => a.order - b.order).slice(0, 3)
        : [],
    [selectedCall],
  );

  const episodeBookmarked =
    (group?.sandwiches.length ?? 0) > 0 &&
    (group?.sandwiches ?? []).every((item) => isSaved('sandwich', item.id));

  if (!group) {
    return (
      <View style={styles.empty}>
        <Stack.Screen options={{ headerTitle: '', headerShown: padSide === null }} />
        {/* A refetch is in flight whenever the route carries a sourceId and
            hasn't failed — don't declare the episode gone mid-load. */}
        {sourceId && !recoveryFailed ? (
          <SkeletonRows count={3} variant="card" accessibilityLabel="Loading episode" style={styles.loadingCards} />
        ) : (
          <Text style={styles.emptyText}>This episode is no longer loaded.</Text>
        )}
      </View>
    );
  }

  return (
    // The buy pad is absolutely positioned, so it has to be a SIBLING of the
    // ScrollView — inside it, the sheet would scroll away with the content.
    <View style={styles.root}>
      <ScrollView
        ref={scrollRef}
        style={styles.root}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + 52,
            // The action block grows when the picked call is held (it gains a
            // position summary), so the list clears whatever it actually is
            // rather than a constant that only fits the lone button. The
            // measured height already carries `ctaBottomInset`, so the safe
            // area is not added a second time here.
            paddingBottom: actionBlockHeight + 24,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Stack.Screen options={{ headerTitle: '', headerShown: padSide === null }} />
        <PodcastSandwichDetail
          video={group.video}
          sandwiches={group.sandwiches}
          focusSandwichId={focus ?? null}
          // A row plays its moment in the player above AND picks it, which is
          // what raises the action bar pinned below.
          onSelectCall={selectCall}
          selectedSandwichId={selectedCall?.sandwich.id ?? null}
          onSeekRequested={scrollToPlayer}
          // Withheld until the social identity resolves, so a tap can't be
          // attributed to nobody.
          onToggleLike={anonymousId ? toggleLikeEpisode : undefined}
          onComment={openComments}
          onBookmark={toggleBookmarkEpisode}
          bookmarked={episodeBookmarked}
          onShare={openShare}
        />
        {/* Takes on the PICKED call. An episode is a list of calls, so the
            theses belong to whichever one is selected rather than to the
            screen — the same rule the action bar below follows. */}
        {selectedCall ? <PositionTakesSection sandwichId={selectedCall.sandwich.id} /> : null}
        <SandwichCommentsSheet
          ref={commentsSheetRef}
          onCountChange={handleCommentCountChange}
        />
        <SandwichShareSheet ref={shareSheetRef} />
      </ScrollView>
      {/* The action for the picked call, in the slot a sandwich's BUY holds —
          the episode is a list of calls, so the button belongs to whichever one
          is picked rather than to the screen. When the viewer already holds the
          picked call, the block carries its position too: the same summary,
          Share and CLOSE a non-YouTube sandwich gets on its detail screen, which
          is the only place those lived before this. */}
      {padSide ? null : (
        <View
          pointerEvents="box-none"
          onLayout={(event) => {
            const next = Math.round(event.nativeEvent.layout.height);
            setActionBlockHeight((current) => (current === next ? current : next));
          }}
          style={[styles.actionWrap, { paddingBottom: ctaBottomInset(insets.bottom) }]}
        >
          {selectedPosition ? (
            // Pulled back out to the wrap's padding box: the card carries its
            // own 12pt margin, and letting the two stack made it read as inset
            // from the button below it rather than aligned with it.
            <View style={styles.actionPosition}>
              <SandwichPositionCard
                position={selectedPosition}
                sandwich={selectedCall?.sandwich ?? null}
                onShare={shareSelected}
              />
            </View>
          ) : null}
          {!selectedCall || (!selectedTarget && !selectedPosition) ? (
            // Nothing picked yet. The action holds its place rather than
            // appearing out of nowhere on the first tap — the bar is where the
            // screen acts from, and an empty gap there says less than a button
            // saying what to do next.
            <View
              accessible
              accessibilityRole="button"
              accessibilityLabel="Select a call to trade"
              accessibilityState={{ disabled: true }}
              style={styles.actionButtonWrap}
            >
              {HAS_GLASS ? (
                <GlassView
                  glassEffectStyle="clear"
                  tintColor={withAlpha(colors.accentBlue, SELECT_TINT_ALPHA)}
                  style={[styles.actionButton, styles.actionButtonIdle]}
                >
                  <Text style={styles.actionButtonText}>SELECT</Text>
                </GlassView>
              ) : (
                <View
                  style={[
                    styles.actionButton,
                    styles.actionButtonIdle,
                    { backgroundColor: withAlpha(colors.accentBlue, SELECT_FALLBACK_ALPHA) },
                  ]}
                >
                  <Text style={styles.actionButtonText}>SELECT</Text>
                </View>
              )}
            </View>
          ) : selectedPosition ? (
            <HeldPositionActions
              buyLabel={selectedTarget ? `${selectedTarget.label} more` : 'Buy more'}
              onBuyMore={selectedTarget ? () => openPad(selectedTarget.side) : undefined}
              onClose={() => openClosePad(selectedPosition)}
            />
          ) : selectedTarget ? (
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`${selectedTarget.label} ${selectedTicker}`}
                  onPress={() => openPad(selectedTarget.side)}
                  scaleTo={0.97}
                  style={styles.actionButtonWrap}
                >
                  {HAS_GLASS ? (
                    <GlassView
                      glassEffectStyle="regular"
                      isInteractive
                      tintColor={withAlpha(
                        selectedTarget.side === 'short' ? colors.actionSell : colors.actionBuy,
                        ACTION_TINT_ALPHA,
                      )}
                      style={styles.actionButton}
                    >
                      <View style={styles.actionButtonRow}>
                        <Text
                          style={styles.actionButtonText}
                        >
                          {selectedTarget.label.toUpperCase()}
                        </Text>
                        <ActionAssetFaces legs={selectedLegs} styles={styles} />
                      </View>
                    </GlassView>
                  ) : (
                    <View
                      style={[
                        styles.actionButton,
                        {
                          backgroundColor:
                            withAlpha(
                              selectedTarget.side === 'short' ? colors.actionSell : colors.actionBuy,
                              ACTION_TINT_ALPHA,
                            ),
                        },
                      ]}
                    >
                      <View style={styles.actionButtonRow}>
                        <Text
                          style={styles.actionButtonText}
                        >
                          {selectedTarget.label.toUpperCase()}
                        </Text>
                        <ActionAssetFaces legs={selectedLegs} styles={styles} />
                      </View>
                    </View>
                  )}
                </PressableScale>
          ) : null}
        </View>
      )}

      {/* The pad, over the episode. The backdrop blurs and darkens the episode
          behind it, so the pad is unmistakably the thing in front and the list
          under it stops competing for the eye while an amount is being typed.

          A sibling of the ScrollView, so it cannot scroll away with the list,
          and anchored low: the moment that produced the call stays on screen
          above it while the trade is sized. */}
      {selectedCall && padSide ? (
        <PodcastCallDrawer
          // A close takes the buy's height: it is the same keypad with the same
          // terms panel, and none of the perp risk band.
          tall={padSide === 'long' || padSide === 'short'}
          onClosed={handlePadClosed}
        >
          {(closePad) =>
            padSide === 'close' ? (
              closingPosition ? (
                // The drag handle is the call sheet's, repeated here rather
                // than pulled into a wrapper: it belongs to the drawer, and the
                // sell pad is a pad, not a sheet.
                <View style={styles.closeSheet}>
                  <View style={styles.closeHandle} />
                  <SandwichSellPad
                    position={closingPosition}
                    sandwich={selectedCall.sandwich}
                    // The call's own words, exactly as the buy pad shows them.
                    // The pad's default is the post itself — which here is the
                    // episode's YouTube card, redrawn inches under the player
                    // already playing it.
                    thesisContent={
                      <View style={styles.closeContext}>
                        <PodcastCallCaption
                          caption={callCaption(selectedCall.sandwich)}
                          timestampLabel={momentTimestampLabel(selectedCall.sandwich)}
                          avatarUrl={getSourceVideo(selectedCall.sandwich)?.channelAvatarUrl ?? null}
                        />
                      </View>
                    }
                    onClose={closePad}
                    onToast={(next, duration) => {
                      if (!next) {
                        toast.dismissToast();
                        return;
                      }
                      toast.showToast(next.text, next.tone, duration);
                    }}
                    onCelebrate={tradeFx.playSandwich}
                    onPositionUpdated={handlePositionUpdated}
                  />
                </View>
              ) : null
            ) : (
              <PodcastCallSheet
                sandwich={selectedCall.sandwich}
                initialLeg={selectedCall.leg}
                markets={markets}
                initialSide={padSide}
                caption={callCaption(selectedCall.sandwich)}
                timestampLabel={momentTimestampLabel(selectedCall.sandwich)}
                onReplayMoment={selectedCall.replayMoment}
                onPositionUpdated={handlePositionUpdated}
                onClose={closePad}
              />
            )
          }
        </PodcastCallDrawer>
      ) : null}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.background },
    content: { paddingHorizontal: 14 },
    loadingCards: { alignSelf: 'stretch' },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.background,
      paddingHorizontal: 32,
    },
    emptyText: {
      fontFamily: F,
      fontWeight: '600',
      fontSize: 14,
      color: c.textTertiary,
      textAlign: 'center',
    },

    // Pinned where a sandwich's BUY sits, so the two screens put their action
    // in the same place. Below the pad's zIndex so raising it covers the bar.
    actionWrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 11,
      // Matches the bottom padding set at the call site, so the button's
      // corners nest inside the display's rather than crossing them.
      paddingHorizontal: CTA.inset,
      paddingTop: 14,
    },
    // The radius lives on BOTH the wrapper and the glass layer: the wrapper's
    // `overflow: hidden` is what clips the native glass to the shape, and the
    // layer's own radius is what the solid fallback rounds by.
    actionButtonWrap: { borderRadius: CTA.radius, overflow: 'hidden' },
    // The position summary spans the wrap's padding box. Its own 12pt margin is
    // pulled back out so it lines up with the buttons rather than sitting
    // inside them.
    actionPosition: { marginHorizontal: -12, marginBottom: 2 },
    // BUY MORE and CLOSE share the row when the call is held — the same pair,
    // in the same order, a sandwich's detail screen pins.
    actionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    actionRowItem: { flex: 1 },
    // Held back rather than faded out: it is the same button in a state it
    // cannot be used in yet, and at 0.4 it read as broken rather than as
    // waiting. The label carries the difference instead.
    actionButtonIdle: { opacity: 0.85 },
    actionButtonRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    actionButtonFaces: { flexDirection: 'row', alignItems: 'center' },
    actionButtonFaceOverlap: { marginLeft: -8 },
    // Ringed in the button's own white so overlapping faces stay separable
    // against a tint that is already saturated.
    actionButtonFace: {
      borderWidth: 2,
      borderColor: '#FFFFFF',
      borderRadius: 17,
    },
    actionButtonFaceFallback: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.24)',
    },
    actionButtonFaceFallbackText: {
      fontFamily: F,
      fontSize: 12,
      fontWeight: '800',
      color: '#FFFFFF',
    },
    actionButton: {
      minHeight: CTA.height,
      borderRadius: CTA.radius,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 18,
    },
    actionButtonText: {
      fontFamily: Fonts.displayOne,
      fontSize: 24,
      lineHeight: 30,
      letterSpacing: 0.7,
      color: '#FFFFFF',
    },
    // Two buttons on one row: "BUY MORE" at 24pt wrapped on the narrower half.
    actionButtonTextPaired: { fontSize: 19, lineHeight: 24 },

    // The sell pad fills the drawer the way the call sheet does, so the close
    // and the buy are the same object opened on different sides.
    // Same inset as the call sheet's own `sheet` container, because the pad
    // draws no horizontal padding of its own — it takes it from whatever hosts
    // it. Without this the close pad ran edge to edge while the buy pad on the
    // identical drawer sat at 18: the preset row, the balance line and the
    // slide-to-confirm all touched the screen's sides.
    closeSheet: { flex: 1, paddingHorizontal: 18, paddingTop: 8, gap: 14 },
    // Matches the buy pad's own caption slot, so the two sides of a call put
    // their context in the same place at the same size.
    closeContext: { alignSelf: 'stretch', paddingHorizontal: 16, paddingTop: 4 },
    // Same handle the call sheet draws, so the drawer reads as one object
    // whichever side it opened on.
    closeHandle: {
      alignSelf: 'center',
      width: 36,
      height: 5,
      borderRadius: 999,
      backgroundColor: c.border,
    },

  });
