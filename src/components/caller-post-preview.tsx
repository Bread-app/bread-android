import { usePrivy } from '@privy-io/expo';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, Share, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from 'react-native-reanimated';
import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ChartPinAnchor } from '@/components/chart-caller-pins';
import { SandwichCard, type SandwichCardSavedControls } from '@/components/sandwich-card';
import { getSandwichShareUrl, setCardLike, type Sandwich } from '@/lib/api';
import { getAnonymousSocialId } from '@/lib/social-identity';
import { useThemeStore } from '@/lib/theme-store';

/**
 * A tapped chart pin's post, as a preview: the feed card floating over the
 * chart it came from, everything behind it blurred. Tap the card for the full post, tap
 * anywhere else to go back to the chart.
 *
 * A Modal, so it rises above the gorhom sheet the chart lives in.
 */
export function CallerPostPreview({
  sandwich,
  anchor,
  onClose,
  onOpen,
  onRemix,
  saved,
}: {
  sandwich: Sandwich | null;
  /** The tapped pin's chart on screen. The card is centred over it. */
  anchor?: ChartPinAnchor | null;
  onClose: () => void;
  /** Opens the full post. The preview has already closed when this runs. */
  onOpen: (sandwich: Sandwich, options?: { showComments?: boolean }) => void;
  /** Remix, from a host that can reach the composer. The preview closes first. */
  onRemix?: (sandwich: Sandwich) => void;
  saved?: SandwichCardSavedControls;
}) {
  const { scheme } = useThemeStore();
  const isDark = scheme === 'dark';
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(0);
  const { user } = usePrivy();
  const [anonymousId, setAnonymousId] = useState<string | null>(null);
  const [liked, setLiked] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getAnonymousSocialId(user?.id).then((value) => {
      if (!cancelled) setAnonymousId(value);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // A fresh pin starts from the post's own like state.
  useEffect(() => {
    setLiked(null);
    setCardHeight(0);
    if (sandwich) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [sandwich]);

  const toggleLike = useCallback(
    async (s: Sandwich) => {
      if (!anonymousId) return;
      const was = liked ?? s.viewerHasLiked;
      setLiked(!was);
      try {
        await setCardLike(s, !was, anonymousId);
      } catch {
        setLiked(was);
      }
    },
    [anonymousId, liked],
  );

  const share = useCallback(async (s: Sandwich) => {
    await Share.share({ url: getSandwichShareUrl(s.id), message: s.name });
  }, []);

  const open = useCallback(
    (s: Sandwich, options?: { showComments?: boolean }) => {
      onClose();
      onOpen(s, options);
    },
    [onClose, onOpen],
  );

  // Centred over the chart the pin sits on, kept on screen. The Modal does not
  // see the app's safe-area provider, so the launch metrics stand in for it.
  const safeTop = Math.max(insets.top, initialWindowMetrics?.insets.top ?? 0);
  const safeBottom = Math.max(insets.bottom, initialWindowMetrics?.insets.bottom ?? 0);
  const minTop = safeTop + 8;
  const maxTop = height - safeBottom - 8 - cardHeight;
  const chartMid = anchor ? anchor.top + anchor.height / 2 : height / 2;
  const top = Math.max(minTop, Math.min(chartMid - cardHeight / 2, maxTop));

  return (
    <Modal visible={sandwich !== null} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      {sandwich ? (
        <View style={StyleSheet.absoluteFill}>
          <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill}>
            <BlurView
              intensity={isDark ? 40 : 30}
              tint={isDark ? 'dark' : 'light'}
              experimentalBlurMethod="dimezisBlurView"
              style={StyleSheet.absoluteFill}
            />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(0,0,0,0.35)' : 'rgba(15,23,42,0.18)' }]} />
            <Pressable accessibilityRole="button" accessibilityLabel="Close preview" style={StyleSheet.absoluteFill} onPress={onClose} />
          </Animated.View>

          <View style={[styles.anchored, { top, opacity: cardHeight ? 1 : 0 }]} pointerEvents="box-none">
            <Animated.View
              onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)}
              entering={ZoomIn.springify().damping(18).stiffness(220).mass(0.8)}
              exiting={ZoomOut.duration(140)}
              style={[styles.card, { width: Math.min(width - 32, 420), backgroundColor: isDark ? '#0c0f0d' : '#ffffff' }]}
            >
              <SandwichCard
                sandwich={{ ...sandwich, viewerHasLiked: liked ?? sandwich.viewerHasLiked }}
                onPress={(s) => open(s)}
                onToggleLike={toggleLike}
                onComment={(s) => open(s, { showComments: true })}
                onShare={share}
                onRemix={
                  onRemix
                    ? (s) => {
                        onClose();
                        onRemix(s);
                      }
                    : undefined
                }
                saved={saved}
              />
            </Animated.View>
          </View>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  anchored: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 16 },
  card: {
    borderRadius: 24,
    overflow: 'hidden',
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 14 },
    elevation: 16,
  },
});
