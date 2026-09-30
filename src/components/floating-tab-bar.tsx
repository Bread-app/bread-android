import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import Foundation from '@expo/vector-icons/Foundation';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Image, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeStore } from '@/lib/theme-store';

const ICON_SIZE = 26;
const BAR_HEIGHT = 56;
const SIDE_MARGIN = 20;
/** Separates the search capsule from the main one, as the iOS 26 bar does. */
const GROUP_GAP = 8;
const SEARCH_WIDTH = 64;

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
 * The pre-iOS-26 tab bar.
 *
 * iOS 26 draws the bottom bar as floating Liquid Glass capsules with the search
 * tab split off to the trailing side, and `NativeTabs` gets all of that from the
 * system. Older iOS has no such bar — it draws the flat, edge-to-edge chrome
 * bar instead — so this redraws the same shape by hand: two rounded capsules
 * over a blur, a soft selection chip behind the active tab, and the same icon
 * set. Not glass, but the same silhouette, so the app reads as one design
 * across both.
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
  // Glass is mostly the blur underneath — the flat wash on top is only there to
  // give the material body and keep the icons legible over busy content. Too
  // much of it and the capsule stops being glass and becomes a painted pill.
  const capsuleTint = isDark ? 'rgba(28,28,30,0.34)' : 'rgba(255,255,255,0.34)';
  // Separation from a white page has to come from a faintly darker outer edge;
  // a white one vanishes. The bright edge goes *inside* it instead, where it
  // reads as the thickness of the material rather than as a border.
  const rimColor = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)';
  const innerEdgeColor = isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.75)';
  // The specular sheen: brightest along the top, dimmest through the middle,
  // with a slight lift again at the bottom where real glass catches the ground.
  const sheen: [string, string, string] = isDark
    ? ['rgba(255,255,255,0.16)', 'rgba(255,255,255,0.02)', 'rgba(255,255,255,0.07)']
    : ['rgba(255,255,255,0.70)', 'rgba(255,255,255,0.14)', 'rgba(255,255,255,0.40)'];
  const selectionColor = isDark ? 'rgba(120,120,128,0.34)' : 'rgba(120,120,128,0.20)';

  const routeByName = new Map(state.routes.map((route) => [route.name, route]));

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
      navigation.navigate(route.name);
    }
  };

  const isActive = (routeName: string) =>
    state.routes[state.index]?.name === routeName;

  const renderTab = (routeName: string, style?: object) => {
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
            focused && { backgroundColor: selectionColor },
          ]}>
          <TabIcon name={routeName} color={focused ? activeColor : inactiveColor} />
        </View>
      </Pressable>
    );
  };

  const capsule = (children: React.ReactNode, extraStyle?: object) => (
    <View style={[styles.capsule, extraStyle]}>
      {/* The real UIKit material, not a hand-mixed grey — it is what makes the
          content behind bloom through the way Liquid Glass does. */}
      <BlurView
        intensity={isDark ? 70 : 90}
        tint={isDark ? 'systemThinMaterialDark' : 'systemThinMaterialLight'}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: capsuleTint }]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={sheen}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={[styles.rim, { borderColor: rimColor }]}
      />
      <View
        pointerEvents="none"
        style={[styles.innerEdge, { borderColor: innerEdgeColor }]}
      />
      {children}
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
          <View style={styles.mainTabs}>
            {MAIN_TABS.map((name) => renderTab(name))}
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
  capsule: {
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    overflow: 'hidden',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.10,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 6 },
    }),
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
  innerEdge: {
    position: 'absolute',
    top: 1,
    left: 1,
    right: 1,
    bottom: 1,
    borderRadius: BAR_HEIGHT / 2 - 1,
    borderWidth: StyleSheet.hairlineWidth,
  },
  mainTabs: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selection: {
    height: 40,
    minWidth: 56,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
});
