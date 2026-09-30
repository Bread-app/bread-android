import { useMemo } from 'react';

import { Colors, type ThemeColors } from '@/constants/theme';
import { useThemeStore } from '@/lib/theme-store';

type Factory<T> = (colors: ThemeColors) => T;

/**
 * Process-wide cache of built stylesheets, keyed first on the theme object and
 * then on the factory.
 *
 * Without this the memo is per component *instance*: every mounted card,
 * row and sheet rebuilds the whole sheet for its file. `sandwich-screen.tsx`
 * alone has a 679-entry sheet shared by 27 components, so a feed of 40 cards
 * (each with leg rows) allocated well over 100k style objects — paid on the
 * mount of every row that scrolls into view, on the JS thread.
 *
 * `colors` is memoized by `ThemeProvider` and only changes identity when the
 * scheme or a dev preview override changes, so a WeakMap keyed on it collapses
 * that to one sheet per (theme, factory) for the whole app and lets stale
 * themes get collected. Stylesheets are read-only, so sharing is safe.
 */
const cache = new WeakMap<ThemeColors, Map<Factory<unknown>, unknown>>();

function buildThemedStyles<T>(factory: Factory<T>, colors: ThemeColors): T {
  let byFactory = cache.get(colors);
  if (!byFactory) {
    byFactory = new Map();
    cache.set(colors, byFactory);
  }
  if (byFactory.has(factory as Factory<unknown>)) {
    return byFactory.get(factory as Factory<unknown>) as T;
  }
  const built = factory(colors);
  byFactory.set(factory as Factory<unknown>, built);
  return built;
}

/**
 * Builds a memoized StyleSheet (or any object) from the active theme colors.
 * Pass a module-level factory so it stays referentially stable:
 *
 *   const makeStyles = (c: ThemeColors) => StyleSheet.create({ ... c.surface ... });
 *   // inside the component:
 *   const styles = useThemedStyles(makeStyles);
 *
 * A factory declared inline in a component body defeats the cache (a new key
 * every render) and grows the map — always hoist it to module scope.
 */
export function useThemedStyles<T>(
  factory: Factory<T>,
  overrideScheme?: 'light' | 'dark',
): T {
  const { colors: currentColors } = useThemeStore();
  const colors = overrideScheme ? Colors[overrideScheme] : currentColors;
  return useMemo(() => buildThemedStyles(factory, colors), [colors, factory]);
}
