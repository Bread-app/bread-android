import { useRouter } from 'expo-router';
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import type { Sandwich } from '@/lib/api';
import type { SandwichPosition } from '@/lib/sandwich-positions';
import type { ToastState } from '@/lib/toast-state';
import type { SandwichFxEvent } from '@/lib/trade-fx';

export type SandwichTradeSide = 'buy' | 'sell';

export type SandwichTradeSheetHandlers = {
  onToast?: (toast: ToastState, duration?: number) => void;
  /** Opens the trade receipt (`tradeFx.playSandwich`); returns its id. */
  onCelebrate?: (event: SandwichFxEvent) => number;
  onPositionUpdated?: (position: SandwichPosition | null) => void;
  /** The pad's "Add cash" — the opener closes the sheet and routes on. */
  onRequestAddCash?: () => void;
};

type SandwichTradeSheetState = {
  side: SandwichTradeSide;
  sandwich: Sandwich | null;
  position: SandwichPosition | null;
  initialAmount: string | null;
};

export type SandwichTradeSheetOpenOptions = SandwichTradeSheetHandlers & {
  side: SandwichTradeSide;
  sandwich: Sandwich;
  position?: SandwichPosition | null;
  initialAmount?: string | null;
};

type SandwichTradeSheetContextValue = SandwichTradeSheetState & {
  /** Push the native form-sheet route. */
  open: (options: SandwichTradeSheetOpenOptions) => void;
  /** Pop it, if it is up. */
  close: () => void;
  /** Always the handlers the current opener last passed. */
  handlers: React.MutableRefObject<SandwichTradeSheetHandlers>;
  /** Called by the route when it unmounts. */
  markClosed: () => void;
};

const SandwichTradeSheetContext = createContext<SandwichTradeSheetContextValue | null>(null);

/**
 * Owns the Sandwich buy / sell pad — the `(app)/sandwich-trade` route,
 * presented as a native iOS form sheet. Same shape as
 * {@link PhoenixPositionSheetProvider}: mounted in `(app)/_layout` above the
 * router Stack, so the opener and the route read one context, and the
 * sandwich travels through here rather than through route params.
 *
 * Type-only imports on purpose: this sits in the root layout, and pulling the
 * Sandwich screen in here would put an 11k-line module (and its import graph)
 * on the app's startup path — see [[inline-requires-needs-acyclic-graph]].
 */
export function SandwichTradeSheetProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<SandwichTradeSheetState>({
    side: 'buy',
    sandwich: null,
    position: null,
    initialAmount: null,
  });
  const handlers = useRef<SandwichTradeSheetHandlers>({});
  const isOpenRef = useRef(false);

  const open = useCallback(
    (options: SandwichTradeSheetOpenOptions) => {
      handlers.current = {
        onToast: options.onToast,
        onCelebrate: options.onCelebrate,
        onPositionUpdated: options.onPositionUpdated,
        onRequestAddCash: options.onRequestAddCash,
      };
      setState({
        side: options.side,
        sandwich: options.sandwich,
        position: options.position ?? null,
        initialAmount: options.initialAmount ?? null,
      });
      // navigate, not push: a double tap must not stack two pads.
      if (!isOpenRef.current) {
        isOpenRef.current = true;
        router.navigate('/sandwich-trade');
      }
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
    <SandwichTradeSheetContext.Provider value={value}>{children}</SandwichTradeSheetContext.Provider>
  );
}

export function useSandwichTradeSheet(): SandwichTradeSheetContextValue {
  const value = useContext(SandwichTradeSheetContext);
  if (!value) {
    throw new Error('useSandwichTradeSheet must be used within SandwichTradeSheetProvider');
  }
  return value;
}
