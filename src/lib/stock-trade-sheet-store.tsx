import { useRouter } from 'expo-router';
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import type { TradeAmountPad } from '@/components/trade-amount-sheet';

export type StockTradeSheetContent = {
  pad: React.ComponentProps<typeof TradeAmountPad>;
  tweetUrl: string | null;
};

type StockTradeSheetActions = {
  present: (owner: symbol, content: StockTradeSheetContent, onDismiss: () => void) => void;
  close: (owner?: symbol) => void;
  openDeposit: (owner: symbol) => void;
  markClosed: () => void;
};

// Separate contexts: publishing quote/amount changes must update the route
// without making the engine owner re-render and publish the same props again.
const ActionsContext = createContext<StockTradeSheetActions | null>(null);
const ContentContext = createContext<StockTradeSheetContent | null>(null);

export function StockTradeSheetProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [content, setContent] = useState<StockTradeSheetContent | null>(null);
  const active = useRef<{ owner: symbol; onDismiss: () => void } | null>(null);
  const routeOpen = useRef(false);

  const present = useCallback((owner: symbol, next: StockTradeSheetContent, onDismiss: () => void) => {
    if (active.current && active.current.owner !== owner) active.current.onDismiss();
    active.current = { owner, onDismiss };
    setContent(next);
    if (!routeOpen.current) {
      routeOpen.current = true;
      router.navigate('/stock-trade');
    }
  }, [router]);

  const close = useCallback((owner?: symbol) => {
    if (!active.current || (owner && owner !== active.current.owner)) return;
    const previous = active.current;
    active.current = null;
    previous.onDismiss();
    if (routeOpen.current && router.canGoBack()) router.back();
    // Keep routeOpen true until unmount so repeated taps cannot stack routes
    // during the native dismissal animation.
  }, [router]);

  const markClosed = useCallback(() => {
    routeOpen.current = false;
    const previous = active.current;
    active.current = null;
    setContent(null);
    previous?.onDismiss();
  }, []);

  const openDeposit = useCallback((owner: symbol) => {
    if (active.current && active.current.owner !== owner) return;
    const previous = active.current;
    active.current = null;
    previous?.onDismiss();
    // Replace the trade route in one navigation action. A back followed by
    // navigate can race the native dismissal and leave deposit underneath it.
    if (routeOpen.current) router.replace('/deposit');
    else router.navigate('/deposit');
  }, [router]);

  const actions = useMemo(
    () => ({ present, close, openDeposit, markClosed }),
    [present, close, openDeposit, markClosed],
  );
  return (
    <ActionsContext.Provider value={actions}>
      <ContentContext.Provider value={content}>{children}</ContentContext.Provider>
    </ActionsContext.Provider>
  );
}

export function useStockTradeSheet() {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error('useStockTradeSheet must be used within StockTradeSheetProvider');
  return actions;
}

export function useStockTradeSheetContent() {
  return useContext(ContentContext);
}
