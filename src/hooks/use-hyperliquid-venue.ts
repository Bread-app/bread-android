import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getHyperliquidAccount,
  getHyperliquidMarket,
  type HyperliquidAccount,
  type HyperliquidMarket,
} from '@/lib/hyperliquid-api';
import { PERPS_VENUE } from '@/lib/perps-venue';

/**
 * Whether a perp ticker trades on Hyperliquid for this build, and the live
 * market + perps account when it does. `active` is false — and the screen stays
 * on Phoenix — when the venue flag is off or Hyperliquid has no USDC market for
 * the ticker.
 *
 * The account read never downgrades a known-good value on a failed refresh, the
 * same rule as the cash balance ([[cash-balance-never-zero]]).
 */
export function useHyperliquidVenue(symbol: string | null) {
  const enabled = PERPS_VENUE === 'hyperliquid' && !!symbol;
  const [market, setMarket] = useState<HyperliquidMarket | null>(null);
  const [account, setAccount] = useState<HyperliquidAccount | null>(null);
  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;

  const reloadAccount = useCallback(async () => {
    if (PERPS_VENUE !== 'hyperliquid') return;
    try {
      setAccount((await getHyperliquidAccount()).account);
    } catch {
      // Keep the last good read; see the hook's note.
    }
  }, []);

  /** Re-read the market — the ticket prices off it, so refresh when it opens. */
  const reloadMarket = useCallback(async () => {
    const current = symbolRef.current;
    if (PERPS_VENUE !== 'hyperliquid' || !current) return;
    try {
      const next = await getHyperliquidMarket(current);
      if (symbolRef.current === current) setMarket(next);
    } catch {
      // A failed refresh keeps the market we had.
    }
  }, []);

  useEffect(() => {
    setMarket(null);
    if (!enabled) return;
    void reloadMarket();
    void reloadAccount();
  }, [enabled, symbol, reloadAccount, reloadMarket]);

  return { active: enabled && market !== null, market, account, reloadAccount, reloadMarket };
}
