import { useRouter } from 'expo-router';
import { Platform } from 'react-native';
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

import type { AssetMarketMode } from '@/components/asset-market-toggle';
import type { Sandwich, Stock } from '@/lib/api';
import { NATIVE_ZOOM_SPIKE, openWithNativeZoom } from '@/lib/native-zoom';
import type { PhoenixMarket, PhoenixTradeSide } from '@/lib/phoenix-api';
import type { ZoomSourceRect } from '@/lib/zoom-transition';

export type StockDetailOpenOptions = {
  /**
   * The pressed row's measured rect. The detail screen grows out of it; without
   * one it presents from the bottom edge instead.
   */
  source?: ZoomSourceRect | null;
  /**
   * Identity of the exact native source view. Useful when the same stock is
   * rendered more than once on screen (for example, the looping ticker tape).
   */
  nativeSourceKey?: string;
  /** A known Phoenix market, so the venue toggle is live from the first frame. */
  perpMarket?: PhoenixMarket | null;
  /** Venue to land on. `perp` needs {@link perpMarket}. */
  venue?: AssetMarketMode;
  /** Side a perp ticket opens on — a short leg opens on Short. */
  side?: PhoenixTradeSide;
  /**
   * Withhold the spot BUY. A perp leg with no live Phoenix market falls back to
   * the spot page, and for a short leg a spot BUY is the opposite of the thesis.
   */
  hideActions?: boolean;
  /**
   * The call this asset was opened from, then other calls on it the caller
   * already holds. Their creators are pinned on the chart.
   */
  calls?: Sandwich[];
  /**
   * Push as an ordinary full screen — slide in, edge-swipe back — instead of
   * zooming out of the tapped row. For sources too small or too mobile to grow
   * a page out of (the ticker tape), where the zoom reads as a pull-down drawer.
   */
  asScreen?: boolean;
};

type StockDetailState = {
  stock: Stock | null;
  options: StockDetailOpenOptions;
};

type StockDetailContextValue = StockDetailState & {
  /** Push the zooming full-screen asset route for `stock`. */
  open: (stock: Stock, options?: StockDetailOpenOptions) => void;
  /** Pop it. */
  close: () => void;
  /**
   * Swap in canonical metadata after the route is already up. Callers open on a
   * locally-built preview so the zoom starts on the same frame as the tap, and
   * hydrate through here when the real record lands.
   */
  update: (stock: Stock) => void;
  /** Refine the venue after the Phoenix board resolves, likewise. */
  updateOptions: (options: StockDetailOpenOptions) => void;
};

const StockDetailContext = createContext<StockDetailContextValue | null>(null);

/**
 * Owns the single, app-wide asset detail *screen* (the route at
 * `(app)/stock-detail`) — the zoom destination that replaced the bottom sheet
 * for rows that can measure themselves.
 *
 * Mounted in `(app)/_layout` inside the wallet/toast providers and above the
 * router Stack, exactly like {@link SandwichDetailProvider}, so both the tab
 * screens that open it and the route itself read the same context. The stock
 * travels through here rather than through route params: it is a whole record,
 * and the zoom must start on the tap frame, with no serialization in between.
 */
export function StockDetailProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<StockDetailState>({
    stock: null,
    options: {},
  });

  const open = useCallback(
    (stock: Stock, options?: StockDetailOpenOptions) => {
      setState({ stock, options: options ?? {} });
      // UIKit's zoom needs a real source row in the native hierarchy. A direct
      // open (for example, pasting a token CA) has no row, so use the portable
      // full-screen modal instead. Besides producing the intended bottom-edge
      // entrance, this keeps the trade pad out of a nested bottom sheet where
      // the parent pan gesture can cancel slide-to-confirm.
      // Android has no UIKit zoom, and the JS zoom (a transparent modal that
      // scales a heavy screen while the list keeps rendering underneath) is the
      // most expensive transition in the app there. Push the plain native
      // route instead; it gets the platform's own transition. Elsewhere, no
      // source marker (`asScreen`) also means a plain push.
      if (Platform.OS === 'android' || options?.asScreen) {
        router.push('/stock-detail-native');
        return;
      }
      const hasNativeSource = Boolean(options?.nativeSourceKey || options?.source);
      if (NATIVE_ZOOM_SPIKE && hasNativeSource) {
        // The native route grows out of the row UIKit finds marked in the view
        // hierarchy, so the push waits a frame for that marker to land.
        openWithNativeZoom(
          options?.nativeSourceKey ?? stock.id,
          () => router.push('/stock-detail-native'),
        );
        return;
      }
      router.push('/stock-detail');
    },
    [router],
  );

  const close = useCallback(() => {
    router.back();
  }, [router]);

  const update = useCallback((stock: Stock) => {
    setState((current) =>
      // Guard a slow hydration landing after the user moved on to another
      // asset, which would swap the screen's contents under them.
      current.stock && current.stock.id === stock.id
        ? { ...current, stock }
        : current,
    );
  }, []);

  const updateOptions = useCallback((options: StockDetailOpenOptions) => {
    setState((current) => ({
      ...current,
      options: { ...current.options, ...options },
    }));
  }, []);

  const value = useMemo(
    () => ({ ...state, open, close, update, updateOptions }),
    [state, open, close, update, updateOptions],
  );

  return (
    <StockDetailContext.Provider value={value}>
      {children}
    </StockDetailContext.Provider>
  );
}

export function useStockDetail(): StockDetailContextValue {
  const ctx = useContext(StockDetailContext);
  if (!ctx) {
    throw new Error('useStockDetail must be used within a StockDetailProvider');
  }
  return ctx;
}
