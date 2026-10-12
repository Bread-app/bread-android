import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import Foundation from '@expo/vector-icons/Foundation';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaskedView from '@react-native-masked-view/masked-view';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef, useState } from 'react';
import { Image, type LayoutChangeEvent, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeStore } from '@/lib/theme-store';

/** `#rrggbb` + alpha → rgba(); anything else is returned unchanged. */
function withAlphaHex(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const n = parseInt(match[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const ICON_SIZE = 26;
const BAR_HEIGHT = 56;
const SIDE_MARGIN = 20;
/** Separates the search capsule from the main one, as the iOS 26 bar does. */
const GROUP_GAP = 8;
const SEARCH_WIDTH = 64;
const SELECTION_HEIGHT = 40;
/** Gap between the sliding lens and its tab's edges. */
const LENS_INSET = 6;

const IS_ANDROID = Platform.OS === 'android';

// iOS-feel spring for the selection lens: ~0.35s response, ~0.8 damping.
const LENS_SPRING = { stiffness: 320, damping: 29, mass: 1 };

/** Left-to-right, matching the native bar. `search` is drawn separately. */
const MAIN_TABS = ['home', 'sandwich', 'wallet', 'profile'] as const;
const SEARCH_TAB = 'search';

const walletIcon = require('../../assets/images/tabIcons/wallet.png');

function TabIcon({ name, color }: { name: string; color: string }) {
  switch (name) {
    case 'home':
      return <Foundation name="home" size={ICON_SIZE} color={color} />;
    case 'sandwich':
      return <MaterialIcons name="explore" size={ICON_SIZE} color={color} />;
    case 'wallet':
      return (
        <Image
          source={walletIcon}
          style={{ width: ICON_SIZE, height: ICON_SIZE, tintColor: color }}
          resizeMode="contain"
        />
      );
    case 'profile':
      return <MaterialIcons name="person" size={ICON_SIZE} color={color} />;
    case SEARCH_TAB:
      return <MaterialIcons name="search" size={ICON_SIZE} color={color} />;
    default:
      return null;
  }
}

/**
 * The floating tab bar for Android and pre-iOS-26.
 *
 * iOS 26 draws the bottom bar as floating Liquid Glass capsules with the search
 * tab split off to the trailing side, and `NativeTabs` gets all of that from the
 * system. Elsewhere this redraws it by hand: two capsules of real blur (Dimezis
 * on Android) with only a whisper of tint, a specular rim that catches light
 * top-left and bottom-right, a soft top sheen, and a tinted glass lens that
 * slides between tabs.
 *
 * It floats (absolutely positioned, `box-none`) exactly as the real one does,
 * so content scrolls underneath rather than being cut off above it.
 */
export function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { colors, scheme } = useThemeStore();
  const isDark = scheme === 'dark';

  const activeColor = colors.actionPrimary;
  const inactiveColor = colors.textTertiary;
  // Liquid Glass is the blur doing almost all the work: content behind stays
  // readable as soft colour. Every flat wash stacked on top turns it back into a
  // painted pill (the old bar summed to ~opaque white), so the body tint is
  // barely there and the "glass" comes from light on the edges instead.
  const capsuleTint = isDark ? 'rgba(18,18,22,0.18)' : 'rgba(255,255,255,0.10)';
  // Separation from a white page has to come from a faintly darker outer edge;
  // a white one vanishes.
  const rimColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';
  // The specular rim: light catching the curved edge — brightest top-left,
  // fading through the sides, picking up again bottom-right.
  const rimLight: [string, string, string, string] = isDark
    ? ['rgba(255,255,255,0.55)', 'rgba(255,255,255,0.06)', 'rgba(255,255,255,0.04)', 'rgba(255,255,255,0.28)']
    : ['rgba(255,255,255,1)', 'rgba(255,255,255,0.35)', 'rgba(255,255,255,0.25)', 'rgba(255,255,255,0.9)'];
  // A soft top sheen, clear through the middle, a faint lift at the bottom.
  const sheen: [string, string, string] = isDark
    ? ['rgba(255,255,255,0.10)', 'rgba(255,255,255,0)', 'rgba(255,255,255,0.03)']
    : ['rgba(255,255,255,0.42)', 'rgba(255,255,255,0)', 'rgba(255,255,255,0.16)'];
  // The selection lens is its own little piece of tinted glass.
  const selectionColor = withAlphaHex(activeColor, isDark ? 0.22 : 0.14);
  const lensRim = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.85)';

  const routeByName = new Map(state.routes.map((route) => [route.name, route]));

  // One lens for the main capsule that SLIDES between tabs (the iOS 26 bar's
  // selection), instead of a chip that blinks from tab to tab.
  const activeName = state.routes[state.index]?.name;
  const mainIndex = MAIN_TABS.indexOf(activeName as (typeof MAIN_TABS)[number]);
  const [mainWidth, setMainWidth] = useState(0);
  const tabWidth = mainWidth / MAIN_TABS.length;
  const lensX = useSharedValue(0);
  const lensOpacity = useSharedValue(mainIndex >= 0 ? 1 : 0);
  const measured = mainWidth > 0;
  // Snap (don't spring) on the first placement and when returning from the
  // search tab, so the lens never flies in from the capsule's edge.
  const lensPlaced = useRef(false);

  useEffect(() => {
    if (!measured) return;
    if (mainIndex >= 0) {
      const target = mainIndex * tabWidth + LENS_INSET;
      const snap = !lensPlaced.current || lensOpacity.value < 0.5;
      lensX.value = snap ? target : withSpring(target, LENS_SPRING);
      lensPlaced.current = true;
    }
    lensOpacity.value = withTiming(mainIndex >= 0 ? 1 : 0, { duration: 160 });
  }, [lensOpacity, lensX, mainIndex, measured, tabWidth]);

  const lensStyle = useAnimatedStyle(() => ({
    opacity: lensOpacity.value,
    transform: [{ translateX: lensX.value }],
  }));

  const onMainLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next > 0 && next !== mainWidth) setMainWidth(next);
  };

  const onPress = (routeName: string) => {
    const route = routeByName.get(routeName);
    if (!route) {
      return;
    }
    const isFocused = state.routes[state.index]?.key === route.key;
    const event = navigation.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
    });
    if (!isFocused && !event.defaultPrevented) {
      void Haptics.selectionAsync();
      navigation.navigate(route.name);
    }
  };

  const isActive = (routeName: string) =>
    state.routes[state.index]?.name === routeName;

  const renderTab = (routeName: string, style?: object, ownSelection = true) => {
    const route = routeByName.get(routeName);
    if (!route) {
      return null;
    }
    const focused = isActive(routeName);
    const { options } = descriptors[route.key] ?? { options: {} };

    return (
      <Pressable
        key={routeName}
        accessibilityRole="button"
        accessibilityState={focused ? { selected: true } : {}}
        accessibilityLabel={options.tabBarAccessibilityLabel ?? routeName}
        onPress={() => onPress(routeName)}
        style={[styles.tab, style]}>
        <View
          style={[
            styles.selection,
            ownSelection && focused && { backgroundColor: selectionColor },
          ]}>
          <TabIcon name={routeName} color={focused ? activeColor : inactiveColor} />
        </View>
      </Pressable>
    );
  };

  const capsule = (children: React.ReactNode, extraStyle?: object) => (
    // The shadow lives on an OUTER, unclipped view. On Android, `elevation` on
    // the translucent capsule itself paints its shadow through the glass as a
    // grey smear; `boxShadow` outside the clip keeps it under the edge only.
    <View style={[styles.capsuleShadow, extraStyle]}>
    <View style={styles.capsule}>
      {/* The real platform blur, not a hand-mixed grey — it is what makes the
          content behind bloom through the way Liquid Glass does. Android only
          truly blurs with the Dimezis method; without it expo-blur falls back
          to a flat translucent tint and the bar stops reading as glass. */}
      <BlurView
        intensity={IS_ANDROID ? 40 : isDark ? 60 : 70}
        tint={
          IS_ANDROID
            ? isDark
              ? 'systemUltraThinMaterialDark'
              : 'default'
            : isDark
              ? 'systemUltraThinMaterialDark'
              : 'systemUltraThinMaterialLight'
        }
        experimentalBlurMethod={IS_ANDROID ? 'dimezisBlurView' : undefined}
        // Android: radius = intensity / factor, while the white/grey overlay
        // scales with intensity alone — a low factor buys a strong blur without
        // the milky overlay that made the bar opaque.
        blurReductionFactor={IS_ANDROID ? 1.6 : undefined}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: capsuleTint }]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={sheen}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={[styles.rim, { borderColor: rimColor }]}
      />
      <MaskedView
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        maskElement={<View style={styles.rimMask} />}>
        <LinearGradient
          colors={rimLight}
          locations={[0, 0.35, 0.65, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </MaskedView>
      {children}
    </View>
    </View>
  );

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.root,
        { paddingBottom: Math.max(insets.bottom - 4, 12) },
      ]}>
      <View pointerEvents="box-none" style={styles.row}>
        {capsule(
          <View style={styles.mainTabs} onLayout={onMainLayout}>
            {measured ? (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.lens,
                  {
                    width: tabWidth - LENS_INSET * 2,
                    backgroundColor: selectionColor,
                    borderColor: lensRim,
                  },
                  lensStyle,
                ]}
              />
            ) : null}
            {MAIN_TABS.map((name) => renderTab(name, undefined, !measured))}
          </View>,
          styles.mainCapsule,
        )}
        {capsule(renderTab(SEARCH_TAB), styles.searchCapsule)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SIDE_MARGIN,
    gap: GROUP_GAP,
  },
  capsuleShadow: {
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.14,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 10 },
      },
      android: { boxShadow: '0px 10px 28px rgba(0,0,0,0.16), 0px 2px 6px rgba(0,0,0,0.06)' },
    }),
  },
  capsule: {
    flex: 1,
    borderRadius: BAR_HEIGHT / 2,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  lens: {
    position: 'absolute',
    left: 0,
    top: (BAR_HEIGHT - SELECTION_HEIGHT) / 2,
    height: SELECTION_HEIGHT,
    borderRadius: SELECTION_HEIGHT / 2,
    borderWidth: 1,
  },
  mainCapsule: {
    flex: 1,
  },
  searchCapsule: {
    width: SEARCH_WIDTH,
  },
  rim: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: BAR_HEIGHT / 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  /** Only the 1.2px band along the edge is visible through this mask. */
  rimMask: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: BAR_HEIGHT / 2,
    borderWidth: 1.2,
    borderColor: '#000',
  },
  mainTabs: {
    height: BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selection: {
    height: SELECTION_HEIGHT,
    minWidth: 56,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
});
