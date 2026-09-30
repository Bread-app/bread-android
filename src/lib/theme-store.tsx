import * as SecureStore from 'expo-secure-store';
import { usePathname } from 'expo-router';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Appearance, useColorScheme as useRNColorScheme } from 'react-native';

import { Colors, type ThemeColor, type ThemeColors } from '@/constants/theme';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ColorScheme = 'light' | 'dark';

// SecureStore key allows alphanumerics plus ".", "-", "_".
const STORAGE_KEY = 'bread.theme.mode';

type ThemeStoreValue = {
  /** The user's chosen preference. */
  mode: ThemeMode;
  /** The effective scheme after resolving `system` against the OS. */
  scheme: ColorScheme;
  /** Resolved color tokens for the effective scheme. */
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => void;
};

/**
 * The developer colour-preview controls, deliberately a SEPARATE context.
 *
 * These are all derived from the current route, so folding them into
 * `ThemeStoreValue` gave that value a new identity on every navigation — and
 * with 87 files reading `useThemeStore` / `useThemedStyles`, every route change
 * re-rendered essentially the whole app for a feature only `dev-color-editor`
 * uses. Split out, the theme value now changes identity only when the theme
 * actually changes.
 */
type ThemePreviewValue = {
  /** Normalized route receiving developer preview overrides. */
  previewRouteKey: string;
  previewOverrides: Partial<ThemeColors>;
  setPreviewColor: (token: ThemeColor, color: string) => void;
  resetCurrentPreview: () => void;
  resetAllPreviews: () => void;
};

const ThemeStoreContext = createContext<ThemeStoreValue | null>(null);
const ThemePreviewContext = createContext<ThemePreviewValue | null>(null);

type PreviewOverrides = Record<string, Partial<ThemeColors>>;
const EMPTY_PREVIEW: Partial<ThemeColors> = {};

/** Groups dynamic route instances (IDs, wallet addresses) into one screen key. */
export function normalizePreviewRoute(pathname: string): string {
  const normalized = pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      if (/^\d+$/.test(segment)) return ':id';
      if (/^[0-9a-f-]{16,}$/i.test(segment)) return ':id';
      if (/^[1-9A-HJ-NP-Za-km-z]{24,}$/.test(segment)) return ':id';
      return segment;
    })
    .join('/');
  return normalized ? `/${normalized}` : '/';
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const osScheme = useRNColorScheme();
  const pathname = usePathname();
  // Light unless the user picks otherwise in Settings: a dark device no longer
  // opens the app in dark.
  const [mode, setModeState] = useState<ThemeMode>('light');
  const [previewByRoute, setPreviewByRoute] = useState<PreviewOverrides>({});

  // Hydrate the persisted preference once. Until it resolves we paint light,
  // the default; only someone who chose Dark/System sees a switch.
  useEffect(() => {
    let active = true;
    SecureStore.getItemAsync(STORAGE_KEY)
      .then((stored) => {
        if (active && isThemeMode(stored)) setModeState(stored);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    SecureStore.setItemAsync(STORAGE_KEY, next).catch(() => {});
  }, []);

  // Keep native UIKit chrome (the native tab bar's glass material, the native
  // search header, system alerts) in sync with the in-app toggle. Without this
  // those native views follow the *device* appearance, so picking Light while
  // the phone is in Dark left a dark tab bar under a light JS UI. `null` hands
  // control back to the OS for `system`.
  useEffect(() => {
    Appearance.setColorScheme(mode === 'system' ? null : mode);
  }, [mode]);

  const scheme: ColorScheme =
    mode === 'system' ? (osScheme === 'dark' ? 'dark' : 'light') : mode;

  const previewRouteKey = normalizePreviewRoute(pathname ?? '/');
  const previewStorageKey = `${scheme}:${previewRouteKey}`;
  const previewOverrides = previewByRoute[previewStorageKey] ?? EMPTY_PREVIEW;

  const setPreviewColor = useCallback(
    (token: ThemeColor, color: string) => {
      if (!__DEV__) return;
      setPreviewByRoute((current) => {
        const routeOverrides = { ...(current[previewStorageKey] ?? {}), [token]: color };
        // Keep the two compatibility aliases visually synchronized.
        if (token === 'surfaceAlt') routeOverrides.backgroundElement = color;
        if (token === 'backgroundElement') routeOverrides.surfaceAlt = color;
        if (token === 'surfaceSelected') routeOverrides.backgroundSelected = color;
        if (token === 'backgroundSelected') routeOverrides.surfaceSelected = color;
        if (token === 'actionPrimary') routeOverrides.accentBlue = color;
        if (token === 'actionPrimaryText') routeOverrides.textInverse = color;
        if (token === 'actionBuy') routeOverrides.accent = color;
        if (token === 'actionSell') routeOverrides.negative = color;
        return { ...current, [previewStorageKey]: routeOverrides };
      });
    },
    [previewStorageKey],
  );

  const resetCurrentPreview = useCallback(() => {
    setPreviewByRoute((current) => {
      if (!(previewStorageKey in current)) return current;
      const next = { ...current };
      delete next[previewStorageKey];
      return next;
    });
  }, [previewStorageKey]);

  const resetAllPreviews = useCallback(() => setPreviewByRoute({}), []);

  const colors = useMemo<ThemeColors>(
    () => ({ ...Colors[scheme], ...previewOverrides }),
    [previewOverrides, scheme],
  );

  const value = useMemo<ThemeStoreValue>(
    () => ({ mode, scheme, colors, setMode }),
    [colors, mode, scheme, setMode],
  );

  const previewValue = useMemo<ThemePreviewValue>(
    () => ({
      previewRouteKey,
      previewOverrides,
      setPreviewColor,
      resetCurrentPreview,
      resetAllPreviews,
    }),
    [
      previewOverrides,
      previewRouteKey,
      resetAllPreviews,
      resetCurrentPreview,
      setPreviewColor,
    ],
  );

  return (
    <ThemeStoreContext.Provider value={value}>
      <ThemePreviewContext.Provider value={previewValue}>
        {children}
      </ThemePreviewContext.Provider>
    </ThemeStoreContext.Provider>
  );
}

export function useThemeStore(): ThemeStoreValue {
  const ctx = useContext(ThemeStoreContext);
  if (!ctx) {
    // Safety net for usage outside the provider (e.g. isolated tests). The
    // provider is mounted at the app root, so this should not happen in app.
    return {
      mode: 'light',
      scheme: 'light',
      colors: Colors.light,
      setMode: () => {},
    };
  }
  return ctx;
}

/** The developer colour-preview controls. Only `dev-color-editor` needs these. */
export function useThemePreview(): ThemePreviewValue {
  const ctx = useContext(ThemePreviewContext);
  if (!ctx) {
    return {
      previewRouteKey: '/',
      previewOverrides: {},
      setPreviewColor: () => {},
      resetCurrentPreview: () => {},
      resetAllPreviews: () => {},
    };
  }
  return ctx;
}

/** Effective scheme only — backs the `use-color-scheme` hook. */
export function useResolvedScheme(): ColorScheme {
  return useThemeStore().scheme;
}
