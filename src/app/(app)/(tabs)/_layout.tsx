import { Tabs } from 'expo-router';
import {
  Icon,
  Label,
  NativeTabs,
  VectorIcon,
} from 'expo-router/unstable-native-tabs';
import Foundation from '@expo/vector-icons/Foundation';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React from 'react';
import { Image, Platform } from 'react-native';
import { FloatingTabBar } from '@/components/floating-tab-bar';
import { HAS_LIQUID_GLASS } from '@/lib/liquid-glass';
import { useThemeStore } from '@/lib/theme-store';
import { withAlpha } from '@/lib/color-utils';

const TAB_ICON_SIZE = 26;

/**
 * iOS 26 ignores NativeTabs' inactive icon tint on the Liquid Glass bar, so the
 * unselected icons have to carry their own softness in the source mask. Android
 * honours the tint, so it keeps a full-strength mask.
 */
const MUTED_ICON_MASK = Platform.OS === 'ios'
  ? 'rgba(255, 255, 255, 0.36)'
  : '#FFFFFF';

/**
 * Everything except iOS 26 draws the floating glass bar by hand. Android has
 * no Liquid Glass, and its native Material bar is flat edge-to-edge chrome,
 * so Bread for Android uses the same floating capsules as older iOS to keep
 * one design across platforms.
 */
const USE_FLOATING_TAB_BAR = Platform.OS === 'android' || !HAS_LIQUID_GLASS;

const MutedFoundation = {
  getImageSource: (
    name: Parameters<typeof Foundation.getImageSource>[0],
  ) => Foundation.getImageSource(name, TAB_ICON_SIZE, MUTED_ICON_MASK),
};

const FoundationTabIcon = {
  getImageSource: (
    name: Parameters<typeof Foundation.getImageSource>[0],
  ) => Foundation.getImageSource(name, TAB_ICON_SIZE, '#FFFFFF'),
};

const MutedMaterialIcons = {
  getImageSource: (
    name: Parameters<typeof MaterialIcons.getImageSource>[0],
  ) => MaterialIcons.getImageSource(name, TAB_ICON_SIZE, MUTED_ICON_MASK),
};

const MaterialTabIcon = {
  getImageSource: (
    name: Parameters<typeof MaterialIcons.getImageSource>[0],
  ) => MaterialIcons.getImageSource(name, TAB_ICON_SIZE, '#FFFFFF'),
};

const atTabIconSize = (source: number) => ({
  ...Image.resolveAssetSource(source),
  width: TAB_ICON_SIZE,
  height: TAB_ICON_SIZE,
});

const walletMutedIcon = atTabIconSize(
  require('../../../../assets/images/tabIcons/wallet-muted.png'),
);
const walletSelectedIcon = atTabIconSize(
  require('../../../../assets/images/tabIcons/wallet.png'),
);

/**
 * Bottom navigation, in two bodies behind one route tree.
 *
 * On iOS 26 this is Expo Router's native tabs, so the bar is the real platform
 * tab bar: Liquid Glass, the trailing split-off search tab (`role="search"`),
 * scroll-edge effects and the shrink-on-scroll `minimizeBehavior`, all from the
 * system.
 *
 * Older iOS has no Liquid Glass and no floating bar — the same component tree
 * renders as flat, edge-to-edge chrome that looks nothing like the design. So
 * below 26 this swaps to the JS tabs navigator and draws the iOS 26 silhouette
 * by hand (see `FloatingTabBar`). The routes, their order and their names are
 * identical on both paths; only the bar differs.
 *
 * This tabs navigator is nested inside the `(app)` Stack (see `../_layout.tsx`),
 * which lets full-screen routes such as `sandwich-detail` push *over* the tab bar
 * while still living inside the app-wide wallet/toast/saved providers.
 */
export default function TabsLayout() {
  const { colors, scheme } = useThemeStore();
  const activeTint = colors.actionPrimary;

  if (USE_FLOATING_TAB_BAR) {
    return (
      <Tabs
        tabBar={(props) => <FloatingTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          // Hidden tabs stay mounted; freezing them stops wallet/price polling
          // from re-rendering screens nobody can see — the main source of
          // dropped frames on mid-range Android.
          freezeOnBlur: Platform.OS === 'android',
        }}>
        <Tabs.Screen name="home" />
        <Tabs.Screen name="sandwich" />
        <Tabs.Screen name="wallet" />
        <Tabs.Screen name="profile" />
        <Tabs.Screen name="search" />
        {/* Reached from the profile menu / dev only, not the tab bar. */}
        <Tabs.Screen name="like-to-buy" options={{ href: null }} />
        <Tabs.Screen name="saved" options={{ href: null }} />
      </Tabs>
    );
  }

  return (
    <NativeTabs
      tintColor={activeTint}
      iconColor={{ default: colors.textTertiary, selected: activeTint }}
      backgroundColor={withAlpha(colors.background, 0.96)}
      blurEffect={
        scheme === 'dark'
          ? 'systemChromeMaterialDark'
          : 'systemChromeMaterialLight'
      }
      shadowColor={withAlpha(colors.border, 0.7)}
      disableTransparentOnScrollEdge
      minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="home">
        <Label hidden />
        <Icon
          src={{
            default: <VectorIcon family={MutedFoundation} name="home" />,
            selected: <VectorIcon family={FoundationTabIcon} name="home" />,
          }}
          selectedColor={activeTint}
        />
      </NativeTabs.Trigger>

      {/* Social feed of sandwiches — sits in slot 2. */}
      <NativeTabs.Trigger name="sandwich">
        <Label hidden />
        <Icon
          src={{
            default: <VectorIcon family={MutedMaterialIcons} name="explore" />,
            selected: <VectorIcon family={MaterialTabIcon} name="explore" />,
          }}
          selectedColor={activeTint}
        />
      </NativeTabs.Trigger>

      {/* Wallet sits in slot 3 (Like-to-Buy is hidden for now — still reachable
          from the profile menu via the `/auto-buy` route). */}
      <NativeTabs.Trigger name="wallet">
        <Label hidden />
        <Icon
          src={{
            default: walletMutedIcon,
            selected: walletSelectedIcon,
          }}
          selectedColor={activeTint}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile">
        <Label hidden />
        <Icon
          src={{
            default: <VectorIcon family={MutedMaterialIcons} name="person" />,
            selected: <VectorIcon family={MaterialTabIcon} name="person" />,
          }}
          selectedColor={activeTint}
        />
      </NativeTabs.Trigger>

      {/* iOS 26 renders this as the system search tab (trailing, magnify icon);
          the route hosts our custom search field + results. */}
      <NativeTabs.Trigger name="search" role="search">
        <Label hidden />
        <Icon
          src={{
            default: <VectorIcon family={MutedMaterialIcons} name="search" />,
            selected: <VectorIcon family={MaterialTabIcon} name="search" />,
          }}
          selectedColor={activeTint}
        />
      </NativeTabs.Trigger>

      {/* Reached from the profile menu / dev only, not the tab bar. */}
      <NativeTabs.Trigger name="like-to-buy" hidden />
      <NativeTabs.Trigger name="saved" hidden />
    </NativeTabs>
  );
}
