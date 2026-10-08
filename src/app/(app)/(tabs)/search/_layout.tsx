import { Stack } from 'expo-router';
import React from 'react';
import { Text } from 'react-native';

import { Fonts } from '@/constants/theme';
import { useThemeStore } from '@/lib/theme-store';

/**
 * Wraps the search tab in a native Stack purely so the screen gets a native
 * navigation header — that header is what hosts the system iOS search bar
 * (`headerSearchBarOptions`), giving the genuine "search tab" behaviour where the
 * field expands from the bar on tap. The title uses the compact header's leading
 * slot so it sits closer to the safe-area edge instead of low in a large-title
 * navigation bar, with no glass capsule behind it. See `./index.tsx`.
 */
export default function SearchStackLayout() {
  const { colors } = useThemeStore();
  const title = (
    <Text
      accessibilityRole="header"
      style={{
        color: colors.text,
        fontSize: 30,
        fontFamily: Fonts.rounded,
        fontWeight: '700',
      }}>
      Search
    </Text>
  );
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerLargeTitle: false,
        headerTitle: '',
        // iOS 26 seats every left bar item on a Liquid Glass capsule; the title
        // is a title, not a button, so it opts out of that shared background.
        unstable_headerLeftItems: () => [
          { type: 'custom', element: title, hidesSharedBackground: true },
        ],
        // Android (and older iOS) have no bar items — same title, plain view.
        headerLeft: () => title,
        headerShadowVisible: false,
        headerTintColor: colors.text,
        headerStyle: { backgroundColor: colors.background },
        headerLargeStyle: { backgroundColor: colors.background },
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
