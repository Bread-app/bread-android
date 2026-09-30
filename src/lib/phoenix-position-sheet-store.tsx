import { useRouter } from 'expo-router';
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import type { PerpSandwichContext } from '@/lib/perp-sandwich-display';
import type { PhoenixPosition } from '@/lib/phoenix-api';

export type PhoenixPositionSheetHandlers = {
  /** Fired after auto-close is written, so the owner can refetch. */
  onUpdated?: () => void;
  /** The confirmed reduce-only order, for the owner to submit. */
  onRequestClosePosition?: (
    position: PhoenixPosition,
    options: { fraction: number; returnToCash: boolean; exitPrice: number | null },
  ) => void;
};

export type PhoenixPositionSheetOpenOptions = PhoenixPositionSheetHandlers & {
  autoClose?: boolean;
  context?: PerpSandwichContext | null;
};

type PhoenixPositionSheetState = {
  position: PhoenixPosition | null;
  context: PerpSandwichContext | null;
  autoClose: boolean;
};

type PhoenixPositionSheetContextValue = PhoenixPositionSheetState & {
  /** Push the native form-sheet route for `position`. */
  open: (position: PhoenixPosition, options?: PhoenixPositionSheetOpenOptions) => void;
  /** Pop it, if it is up. */
  close: () => void;
  /** Always the handlers the current opener last passed. */
  handlers: React.MutableRefObject<PhoenixPositionSheetHandlers>;
  /** Called by the route when it unmounts. */
  markClosed: () => void;
};

const PhoenixPositionSheetContext = createContext<PhoenixPositionSheetContextValue | null>(null);

/**
 * Owns the app-wide Phoenix position sheet — the `(app)/phoenix-position`
 * route, presented as a native iOS form sheet. Mounted in `(app)/_layout`
 * above the router Stack, like {@link StockDetailProvider}, so the screen that
 * opens it and the route itself read the same context. The position record
 * travels through here rather than through route params.
 *
 * The opener's callbacks live in a ref rather than state: they close over the
 * opener's latest render, and a sheet that outlives a few of those renders
 * must still call the freshest version.
 */
export function PhoenixPositionSheetProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<PhoenixPositionSheetState>({
    position: null,
    context: null,
    autoClose: false,
  });
  const handlers = useRef<PhoenixPositionSheetHandlers>({});
  const isOpenRef = useRef(false);

  const open = useCallback(
    (position: PhoenixPosition, options?: PhoenixPositionSheetOpenOptions) => {
      handlers.current = {
        onUpdated: options?.onUpdated,
        onRequestClosePosition: options?.onRequestClosePosition,
      };
      setState({
        position,
        context: options?.context ?? null,
        autoClose: options?.autoClose === true,
      });
      isOpenRef.current = true;
      router.push('/phoenix-position');
    },
    [router],
  );

  const close = useCallback(() => {
    if (!isOpenRef.current) return;
    isOpenRef.current = false;
    if (router.canGoBack()) router.back();
  }, [router]);

  const markClosed = useCallback(() => {
    isOpenRef.current = false;
  }, []);

  const value = useMemo(
    () => ({ ...state, open, close, handlers, markClosed }),
    [state, open, close, markClosed],
  );

  return (
    <PhoenixPositionSheetContext.Provider value={value}>{children}</PhoenixPositionSheetContext.Provider>
  );
}

export function usePhoenixPositionSheet(): PhoenixPositionSheetContextValue {
  const value = useContext(PhoenixPositionSheetContext);
  if (!value) {
    throw new Error('usePhoenixPositionSheet must be used within PhoenixPositionSheetProvider');
  }
  return value;
}
