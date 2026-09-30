import { Stack } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import type { NativeSyntheticEvent, TextInputFocusEventData } from 'react-native';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeStore } from '@/lib/theme-store';
import { SearchResults } from '@/screens/search-screen';

/**
 * The search tab screen. "Search" is the native iOS large title, pinned
 * top-left; the input is the native search bar declared via
 * `headerSearchBarOptions`, which on iOS 26 the tab bar's `role="search"`
 * trigger relocates into the tab bar itself. The field's text drives
 * `SearchResults` (assets / sandwiches / people + their detail sheets).
 *
 * The large title only collapses correctly if the results ScrollView opts into
 * `contentInsetAdjustmentBehavior="automatic"` — see `SearchResults`. Without
 * it UIKit insets the content itself and the top of the list is cut off.
 */
export default function SearchIndex() {
  const { colors } = useThemeStore();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  const onChangeText = useCallback(
    (e: NativeSyntheticEvent<TextInputFocusEventData>) => setQuery(e.nativeEvent.text),
    [],
  );

  const searchBarOptions = useMemo(
    () => ({
      placeholder: 'Tokens, CAs, markets, sandwiches, people...',
      hideWhenScrolling: false,
      autoCapitalize: 'none' as const,
      tintColor: colors.icon,
      textColor: colors.text,
      onChangeText,
    }),
    [colors.icon, colors.text, onChangeText],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: 'Search',
          headerShadowVisible: false,
          headerSearchBarOptions: searchBarOptions,
        }}
      />
      <SearchResults
        query={query}
        active
        bottomPad={insets.bottom + 100}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
