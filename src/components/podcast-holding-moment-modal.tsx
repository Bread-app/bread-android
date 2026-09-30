import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Linking,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  ReduceMotion,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useBottomSheetModalInternal } from '@gorhom/bottom-sheet';
import { Portal } from '@gorhom/portal';
import { usePrivy } from '@privy-io/expo';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FollowButton } from '@/components/follow-button';
import { HeldPositionActions } from '@/components/held-position-actions';
import { VerifiedBadge } from '@/components/verified-badge';
import { YouTubeClipPlayer } from '@/components/youtube-clip-player';
import { HandleText } from '@/components/handle-text';
import { Fonts, Spacing, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import {
  appUserPayloadFromPrivyUser,
  followUser,
  getUserProfile,
  unfollowUser,
  type Sandwich,
  type SandwichProvenance,
} from '@/lib/api';
import { formatTimestamp, momentCaption } from '@/lib/moment';
import { podcastHoldingClipWindow } from '@/lib/podcast-holding-moment';
import { getBuilderMeta } from '@/lib/sandwich-feed';
import { provenanceDeepLink } from '@/lib/sandwich-provenance';
import type { SandwichPosition } from '@/lib/sandwich-positions';
import { CTA, ctaBottomInset } from '@/lib/screen-corners';
import { useThemeStore } from '@/lib/theme-store';
import { useToast } from '@/lib/toast-store';
import { SandwichPositionCard } from '@/screens/sandwich-screen';
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;
const SHEET_ENTER_MS = 250;
const SHEET_EXIT_MS = 200;

export type PodcastHoldingMomentModalData = {
  sandwich: Sandwich | null;
  provenance: SandwichProvenance;
  position: SandwichPosition;
  currentValueUsd: number;
  returnPct: number | null;
};

type Props = {
  data: PodcastHoldingMomentModalData | null;
  onDismiss: () => void;
  onOpenFullPost: () => void;
  onShare: () => void;
  onBuyMore: () => void;
  onSell: () => void;
};

export function PodcastHoldingMomentModal({
  data,
  onDismiss,
  onOpenFullPost,
  onShare,
  onBuyMore,
  onSell,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const toast = useToast();
  const { user } = usePrivy();
  const appUser = useMemo(() => appUserPayloadFromPrivyUser(user), [user]);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // The host every BottomSheetModal in the app presents into. Rendering the
  // drawer there — not in a native <Modal> — is what lets the trade pad open
  // ON TOP of it: a native modal sits above every RN-rendered layer, so the
  // profile had to tear this down before the dialpad could show at all.
  const { hostName } = useBottomSheetModalInternal();
  const [renderedData, setRenderedData] = useState<PodcastHoldingMomentModalData | null>(data);
  const [modalVisible, setModalVisible] = useState(Boolean(data));
  const closingRef = useRef(false);
  const afterCloseRef = useRef<(() => void) | null>(null);
  const sheetTranslateY = useSharedValue(data ? 0 : windowHeight);
  const backdropOpacity = useSharedValue(data ? 1 : 0);
  const scrollY = useSharedValue(0);
  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);
  const activeData = data ?? renderedData;
  const clip = useMemo(
    () => (activeData ? podcastHoldingClipWindow(activeData.sandwich, activeData.provenance) : null),
    [activeData],
  );
  const caption = useMemo(() => momentCaption(activeData?.sandwich), [activeData?.sandwich]);
  const legWhys = useMemo(() => {
    const legs = activeData?.sandwich?.legs ?? [];
    return legs.flatMap((leg) => {
      const text = (leg.legMechanism ?? leg.matchSummary ?? leg.reason ?? '').trim();
      if (!text) return [];
      const symbol = (leg.symbol ?? leg.underlyingSymbol ?? '').trim();
      const ticker = symbol ? `$${symbol.toUpperCase()}` : leg.label.trim();
      return ticker ? [{ key: leg.id, ticker, text }] : [];
    });
  }, [activeData?.sandwich]);

  // The Bread user who built this sandwich — the byline above the clip, the
  // same identity the sandwich's own detail screen leads with. The follow
  // state is read fresh per sandwich, and the button holds its place until it
  // lands so the header doesn't reflow.
  const creator = activeData?.sandwich ? getBuilderMeta(activeData.sandwich) : null;
  const creatorPrivyUserId = activeData?.sandwich?.source.user?.privyUserId ?? null;
  const viewerPrivyUserId = appUser?.privyUserId ?? null;
  const canFollowCreator = Boolean(
    creator && creatorPrivyUserId && viewerPrivyUserId && creatorPrivyUserId !== viewerPrivyUserId,
  );
  const [creatorFollowing, setCreatorFollowing] = useState(false);
  const [creatorFollowReady, setCreatorFollowReady] = useState(false);
  const [creatorFollowLoading, setCreatorFollowLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCreatorFollowing(false);
    setCreatorFollowReady(false);
    setCreatorFollowLoading(false);
    if (!canFollowCreator || !creatorPrivyUserId || !viewerPrivyUserId) {
      return () => {
        cancelled = true;
      };
    }
    void getUserProfile(creatorPrivyUserId, viewerPrivyUserId)
      .then((profile) => {
        if (cancelled) return;
        setCreatorFollowing(profile?.isFollowing ?? false);
        setCreatorFollowReady(true);
      })
      .catch(() => {
        if (!cancelled) setCreatorFollowReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [canFollowCreator, creatorPrivyUserId, viewerPrivyUserId]);

  const toggleCreatorFollow = useCallback(async () => {
    if (!canFollowCreator || !creatorPrivyUserId || !appUser || creatorFollowLoading) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const wasFollowing = creatorFollowing;
    setCreatorFollowing(!wasFollowing);
    setCreatorFollowLoading(true);
    try {
      if (wasFollowing) {
        await unfollowUser(appUser, creatorPrivyUserId);
      } else {
        await followUser(appUser, creatorPrivyUserId);
      }
    } catch {
      setCreatorFollowing(wasFollowing);
      toast.showToast("Couldn't update follow. Try again.", 'error');
    } finally {
      setCreatorFollowLoading(false);
    }
  }, [appUser, canFollowCreator, creatorFollowLoading, creatorFollowing, creatorPrivyUserId, toast]);

  // Keep the last payload mounted through the exit so the drawer slides away
  // with its contents intact. Loading → ready updates replace it in place and
  // never replay the entrance.
  useEffect(() => {
    if (!data) return;
    setRenderedData(data);
    if (modalVisible) return;
    closingRef.current = false;
    scrollY.value = 0;
    sheetTranslateY.value = windowHeight;
    backdropOpacity.value = 0;
    setModalVisible(true);
  }, [backdropOpacity, data, modalVisible, scrollY, sheetTranslateY, windowHeight]);

  // Transform + opacity are the only animated properties. Reduce Motion is
  // delegated to Reanimated's system setting, which makes both timings instant.
  useEffect(() => {
    if (!modalVisible) return;
    const frame = requestAnimationFrame(() => {
      sheetTranslateY.value = withTiming(0, {
        duration: SHEET_ENTER_MS,
        easing: Easing.out(Easing.cubic),
        reduceMotion: ReduceMotion.System,
      });
      backdropOpacity.value = withTiming(1, {
        duration: SHEET_ENTER_MS,
        easing: Easing.out(Easing.cubic),
        reduceMotion: ReduceMotion.System,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [backdropOpacity, modalVisible, sheetTranslateY]);

  const finishClose = useCallback(() => {
    setModalVisible(false);
    setRenderedData(null);
    closingRef.current = false;
    const afterClose = afterCloseRef.current;
    afterCloseRef.current = null;
    afterClose?.();
  }, []);

  const closeDrawer = useCallback((afterClose: () => void) => {
    if (closingRef.current) return;
    closingRef.current = true;
    afterCloseRef.current = afterClose;
    backdropOpacity.value = withTiming(0, {
      duration: SHEET_EXIT_MS,
      easing: Easing.in(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    });
    sheetTranslateY.value = withTiming(
      windowHeight,
      {
        duration: SHEET_EXIT_MS,
        easing: Easing.in(Easing.cubic),
        reduceMotion: ReduceMotion.System,
      },
      (finished) => {
        if (finished) runOnJS(finishClose)();
      },
    );
  }, [backdropOpacity, finishClose, sheetTranslateY, windowHeight]);

  const dismissDrawer = useCallback(() => closeDrawer(onDismiss), [closeDrawer, onDismiss]);

  // The hardware back that <Modal onRequestClose> used to answer.
  useEffect(() => {
    if (!modalVisible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      dismissDrawer();
      return true;
    });
    return () => sub.remove();
  }, [dismissDrawer, modalVisible]);

  // The scroll view is registered as a native gesture so the pan can run
  // beside it instead of losing to it: without this the list claimed every
  // vertical touch and the sheet never saw the drag, wherever it started.
  const scrollGesture = useMemo(() => Gesture.Native(), []);
  const dismissPan = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .simultaneousWithExternalGesture(scrollGesture)
        .onTouchesDown((event, manager) => {
          'worklet';
          if (event.allTouches.length > 1) {
            manager.fail();
            return;
          }
          const touch = event.allTouches[0];
          if (!touch) return;
          touchStartX.value = touch.absoluteX;
          touchStartY.value = touch.absoluteY;
        })
        .onTouchesMove((event, manager) => {
          'worklet';
          if (event.allTouches.length > 1) {
            manager.fail();
            return;
          }
          const touch = event.allTouches[0];
          if (!touch) return;
          const dx = touch.absoluteX - touchStartX.value;
          const dy = touch.absoluteY - touchStartY.value;
          if (Math.abs(dx) > Math.abs(dy)) {
            if (Math.abs(dx) > 10) manager.fail();
            return;
          }
          if (dy < 0) {
            manager.fail();
            return;
          }
          if (dy > 10) {
            if (scrollY.value <= 2) manager.activate();
            else manager.fail();
          }
        })
        .onUpdate((event) => {
          'worklet';
          sheetTranslateY.value = Math.max(0, event.translationY);
        })
        .onEnd((event) => {
          'worklet';
          // A committed flick or a modest drag both close it — the sheet is
          // tall now, and 150pt from the top read as "nothing happened".
          const projected = event.translationY + Math.max(0, event.velocityY) * 0.25;
          if (projected > 80) {
            runOnJS(dismissDrawer)();
          } else {
            sheetTranslateY.value = withSpring(0, {
              velocity: event.velocityY,
              damping: 26,
              stiffness: 280,
              mass: 1,
            });
          }
        }),
    [dismissDrawer, scrollGesture, scrollY, sheetTranslateY, touchStartX, touchStartY],
  );

  const backdropStyle = useAnimatedStyle(() => ({
    opacity:
      backdropOpacity.value *
      interpolate(
        sheetTranslateY.value,
        [0, windowHeight * 0.6],
        [1, 0],
        Extrapolation.CLAMP,
      ),
  }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetTranslateY.value }],
  }));

  if (!activeData) return null;

  const videoId = activeData.sandwich?.source.videoId ?? activeData.provenance.source.videoId;
  const sourceLink = provenanceDeepLink(activeData.provenance);

  const openSourceFallback = () => {
    if (sourceLink) void Linking.openURL(sourceLink).catch(() => {});
  };

  if (!modalVisible) return null;

  return (
    <Portal hostName={hostName}>
      <View style={[StyleSheet.absoluteFill, styles.backdrop]}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.backdropTint, backdropStyle]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close Sandwich details"
          onPress={() => closeDrawer(onDismiss)}
          style={StyleSheet.absoluteFill}
        />
        <GestureDetector gesture={dismissPan}>
          <Animated.View
            accessibilityViewIsModal
            style={[styles.sheet, sheetStyle]}
          >
            <View pointerEvents="none" style={styles.dragHandle} />

            <GestureDetector gesture={scrollGesture}>
            <ScrollView
              style={styles.scroll}
              bounces={false}
              showsVerticalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={(event) => {
                scrollY.value = event.nativeEvent.contentOffset.y;
              }}
              contentContainerStyle={styles.content}
            >
            {creator ? (
              <View style={styles.creatorRow}>
                <PressableScale
                  accessibilityRole={creatorPrivyUserId ? 'button' : undefined}
                  accessibilityLabel={`Built by ${creator.name}`}
                  disabled={!creatorPrivyUserId}
                  // The drawer sits above the navigator, so it has to go first
                  // or the profile would push underneath it.
                  onPress={() => {
                    if (!creatorPrivyUserId) return;
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    closeDrawer(() => {
                      onDismiss();
                      router.push({ pathname: '/user-profile', params: { id: creatorPrivyUserId } });
                    });
                  }}
                  style={styles.creatorIdentity}
                >
                  {creator.avatarUrl ? (
                    <Image source={{ uri: creator.avatarUrl }} style={styles.creatorAvatar} />
                  ) : (
                    <View style={styles.creatorAvatarFallback}>
                      <Text style={styles.creatorAvatarInitials}>{creator.initials}</Text>
                    </View>
                  )}
                  <View style={styles.creatorNameRow}>
                    <HandleText numberOfLines={1} style={styles.creatorName}>
                      {`@${creator.name}`}
                    </HandleText>
                    <VerifiedBadge size={18} />
                  </View>
                </PressableScale>
                {canFollowCreator ? (
                  creatorFollowReady ? (
                    <FollowButton
                      size="sm"
                      shape="rounded"
                      following={creatorFollowing}
                      disabled={creatorFollowLoading}
                      onPress={() => {
                        void toggleCreatorFollow();
                      }}
                      style={styles.followButton}
                    />
                  ) : (
                    <View style={styles.followButtonPlaceholder} />
                  )
                ) : null}
              </View>
            ) : null}

            <View style={styles.playerFrame}>
              {videoId && clip ? (
                <YouTubeClipPlayer
                  videoId={videoId}
                  initialStartMs={clip.startMs}
                  initialEndMs={clip.endMs}
                  autoplay
                  renderFallback={() => (
                    <PressableScale
                      accessibilityRole={sourceLink ? 'link' : 'button'}
                      accessibilityLabel="Open this timestamp on YouTube"
                      disabled={!sourceLink}
                      onPress={openSourceFallback}
                      style={styles.playerFallback}
                    >
                      <Image
                        accessible={false}
                        source={{ uri: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` }}
                        resizeMode="cover"
                        style={StyleSheet.absoluteFill}
                      />
                      <View style={styles.playerFallbackOverlay}>
                        <Ionicons name="open-outline" size={28} color="#FFFFFF" />
                      </View>
                    </PressableScale>
                  )}
                />
              ) : (
                <View style={styles.playerUnavailable}>
                  <Ionicons name="videocam-off-outline" size={26} color={colors.iconMuted} />
                  <Text style={styles.playerUnavailableText}>Video unavailable</Text>
                </View>
              )}
            </View>

            <View style={styles.momentContext}>
              <View style={styles.timestampRow}>
                <Ionicons name="play-circle" size={17} color={colors.accentBlue} />
                <Text style={styles.timestamp}>
                  {clip ? formatTimestamp(clip.startMs) : 'Timestamp unavailable'}
                </Text>
                <PressableScale
                  accessibilityRole="link"
                  accessibilityLabel="View the full episode post"
                  hitSlop={8}
                  onPress={() => closeDrawer(onOpenFullPost)}
                  style={styles.fullPostLink}
                >
                  <Text style={styles.fullPostText}>View full post</Text>
                  <Ionicons name="arrow-forward" size={14} color={colors.accentBlue} />
                </PressableScale>
              </View>
              {caption ? (
                <Text numberOfLines={3} style={styles.momentCaption}>
                  {`\u201C${caption.text}\u201D`}
                </Text>
              ) : null}
            </View>

            {/* Why these legs, in the same words the sandwich page uses: the
                generated mechanism where a leg has one, the match summary or
                routing reason where it predates that. The quote says what was
                said; this says why it became this trade. */}
            {legWhys.length > 0 ? (
              <View style={styles.whySection}>
                {legWhys.map((why) => (
                  <View key={why.key} style={styles.whyBlock}>
                    <Text style={styles.whyTitle}>{`Why ${why.ticker}?`}</Text>
                    <Text style={styles.whyBody}>{why.text}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* The same card every held sandwich shows — pulled out to the
                clip's edges, since it carries its own 12pt margin. */}
            <View style={styles.positionCardWrap}>
              <SandwichPositionCard
                position={activeData.position}
                sandwich={activeData.sandwich}
                onShare={() => closeDrawer(onShare)}
                // Dismiss for real, not just slide away: the host still holds
                // `data`, and the visibility effect re-presents the drawer the
                // moment it sees it closed with a payload still attached.
                onAddThesis={(open) =>
                  closeDrawer(() => {
                    onDismiss();
                    open();
                  })
                }
              />
            </View>
            </ScrollView>
            </GestureDetector>
            <View
              style={[
                styles.actionDock,
                { paddingBottom: ctaBottomInset(insets.bottom) },
              ]}
            >
              <HeldPositionActions
                buyLabel="BUY"
                closeLabel="SELL"
                // Not closeDrawer: the pad presents over this sheet, and the
                // position stays in view behind it.
                onBuyMore={onBuyMore}
                onClose={onSell}
              />
            </View>
          </Animated.View>
        </GestureDetector>
      </View>
    </Portal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      alignItems: 'center',
    },
    backdropTint: { backgroundColor: c.overlay },
    sheet: {
      width: '100%',
      maxWidth: 560,
      height: '94%',
      maxHeight: '94%',
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      backgroundColor: c.surface,
      shadowColor: c.shadow,
      shadowOpacity: 0.18,
      shadowRadius: 22,
      shadowOffset: { width: 0, height: -8 },
      elevation: 24,
      overflow: 'hidden',
    },
    dragHandle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      marginTop: 10,
      marginBottom: 6,
      borderRadius: 2,
      backgroundColor: c.border,
    },
    scroll: { flex: 1 },
    content: {
      paddingHorizontal: Spacing.four,
      paddingTop: Spacing.four,
      // Clears the floating BUY / SELL row plus its inset.
      paddingBottom: CTA.height + CTA.inset + Spacing.five,
      gap: Spacing.four,
    },
    playerFrame: {
      width: '100%',
      aspectRatio: 16 / 9,
      overflow: 'hidden',
      borderRadius: 18,
      backgroundColor: '#000000',
    },
    playerFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    playerFallbackOverlay: {
      width: 54,
      height: 54,
      borderRadius: 27,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.62)',
    },
    playerUnavailable: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
    playerUnavailableText: { color: c.textTertiary, fontFamily: F, fontSize: 13, fontWeight: '700' },
    momentContext: {
      gap: Spacing.two,
    },
    momentCaption: {
      color: c.text,
      fontFamily: F,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '700',
    },
    whySection: {
      // The scroll content already carries the sheet gutter.
      paddingTop: 14,
      gap: 12,
    },
    whyBlock: { gap: 3 },
    whyTitle: {
      color: c.text,
      fontFamily: F,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '900',
    },
    whyBody: {
      color: c.textSecondary,
      fontFamily: F,
      fontSize: 13.5,
      lineHeight: 19,
      fontWeight: '600',
    },
    timestampRow: {
      minHeight: 28,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    timestamp: {
      color: c.accentBlue,
      fontFamily: Fonts.displayOne,
      fontSize: 17,
      letterSpacing: 0.3,
      fontVariant: ['tabular-nums'],
    },
    fullPostLink: {
      marginLeft: 'auto',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    fullPostText: { color: c.accentBlue, fontFamily: F, fontSize: 13, fontWeight: '900' },
    // Byline above the clip — the same avatar + @name + Follow row a sandwich's
    // detail screen leads with, so the holding reads as that creator's call.
    creatorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.three,
    },
    creatorIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
    creatorAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.surfaceAlt },
    creatorAvatarFallback: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surfaceAlt,
    },
    creatorAvatarInitials: { color: c.textSecondary, fontFamily: F, fontSize: 13, fontWeight: '800' },
    creatorNameRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4 },
    creatorName: { flexShrink: 1, color: c.text, fontFamily: F, fontSize: 18, fontWeight: '800' },
    followButton: { minHeight: 40 },
    followButtonPlaceholder: { width: 96, height: 40, borderRadius: 12, backgroundColor: c.surfaceAlt },
    // The shared card carries its own 12pt side margin; pull it back out so it
    // sits flush with the clip above it.
    positionCardWrap: { marginHorizontal: -12 },
    // The buttons float over the content: no plate, no rule. The scroll
    // content pads its own bottom so the last row can clear them.
    actionDock: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: CTA.inset,
      paddingTop: Spacing.three,
    },
  });
}
