import Ionicons from '@expo/vector-icons/Ionicons';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { useSegments } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeStore } from '@/lib/theme-store';

const HAS_GLASS = Platform.OS === 'ios' && isGlassEffectAPIAvailable();
const SIZE = 64;
const SPRING = { damping: 18, stiffness: 260, mass: 0.7, reduceMotion: ReduceMotion.System };

/** The tabs that carry the "+" — it stays mounted while you move between them. */
type ComposeTab = 'home' | 'sandwich';
const COMPOSE_TABS: readonly string[] = ['home', 'sandwich'];

/**
 * What "+" does on each tab. The button is one instance in the tabs layout, so
 * each screen hands over its own action (the feed wants the new sandwich
 * spliced in) rather than drawing a button of its own. Read at press time —
 * nothing here needs to re-render when a screen registers.
 */
const composeActions = new Map<ComposeTab, () => void>();

/** Registers what the persistent "+" does while `tab` is the active tab. */
export function useComposeAction(tab: ComposeTab, action: () => void) {
  useEffect(() => {
    composeActions.set(tab, action);
    return () => {
      if (composeActions.get(tab) === action) composeActions.delete(tab);
    };
  }, [tab, action]);
}

/**
 * The one "+" for Home and the Sandwich feed, drawn above the tab screens.
 *
 * It used to be a button inside each screen, so switching Home ↔ Sandwich tore
 * one down and mounted another (the feed's even waited for its first load) —
 * the same button blinking out and back in at the same spot. Now it is a
 * single instance that simply stays put between those two tabs, and springs
 * away / back when you move to a tab that has no "+".
 *
 * The active tab is the one the URL last named under `(tabs)`: a route pushed
 * or zoomed over the tabs (asset detail, a Sandwich) leaves it unchanged, so
 * the button doesn't flicker behind a card that is opening on top.
 */
export function TabsComposeFab() {
  const insets = useSafeAreaInsets();
  const segments = useSegments() as string[];
  const tabsIndex = segments.indexOf('(tabs)');
  const routeTab = tabsIndex >= 0 ? (segments[tabsIndex + 1] ?? null) : null;

  const [activeTab, setActiveTab] = useState(routeTab);
  if (routeTab && routeTab !== activeTab) setActiveTab(routeTab);
  const shown = activeTab !== null && COMPOSE_TABS.includes(activeTab);

  const presence = useSharedValue(shown ? 1 : 0);
  useEffect(() => {
    presence.value = shown
      ? withSpring(1, SPRING)
      : withTiming(0, { duration: 140, reduceMotion: ReduceMotion.System });
  }, [presence, shown]);

  const presenceStyle = useAnimatedStyle(() => ({
    opacity: presence.value,
    transform: [{ scale: 0.6 + presence.value * 0.4 }],
  }));

  return (
    <Animated.View
      pointerEvents={shown ? 'box-none' : 'none'}
      style={[
        styles.anchor,
        // Just above the tab bar, where both screens used to put it.
        { bottom: 88 + Math.max(insets.bottom, 10), right: 16 + Math.max(insets.right, 0) },
        presenceStyle,
      ]}
    >
      <ComposeFab
        onPress={() => {
          const action = activeTab ? composeActions.get(activeTab as ComposeTab) : undefined;
          if (!action) return;
          Keyboard.dismiss();
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          action();
        }}
      />
    </Animated.View>
  );
}

/**
 * The floating "New sandwich" button's face. Placed by `TabsComposeFab`.
 *
 * On iOS 26 it is native Liquid Glass, tinted the app's action blue and
 * interactive (the system press-bloom). Elsewhere it falls back to the solid
 * blue circle with its soft glow.
 */
function ComposeFab({ onPress }: { onPress: () => void }) {
  const { colors, scheme } = useThemeStore();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="New sandwich"
      hitSlop={12}
      onPress={onPress}
      style={[styles.fab, !HAS_GLASS && { shadowColor: colors.actionPrimary }, !HAS_GLASS && styles.glow]}
    >
      {HAS_GLASS ? (
        <GlassView
          glassEffectStyle="regular"
          isInteractive
          tintColor={colors.actionPrimary}
          // The in-app Light/Dark toggle is independent of the OS appearance.
          colorScheme={scheme === 'dark' ? 'dark' : 'light'}
          style={styles.face}
        >
          <Ionicons name="add" size={34} color="#FFFFFF" />
        </GlassView>
      ) : (
        <View style={[styles.face, { backgroundColor: colors.actionPrimary }]}>
          <Ionicons name="add" size={36} color="#FFFFFF" />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    zIndex: 40,
  },
  fab: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
  },
  glow: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 18,
    elevation: 12,
  },
  // GlassView is a native view and won't auto-size to its children.
  face: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
