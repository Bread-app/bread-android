import { useEffect, useRef, useState } from 'react';

import { getBasketQuotePreview, getTradeQuotePreview, type TradeQuotePreview } from '@/lib/api';

/**
 * Live Jupiter terms for the amount currently on the dialpad.
 *
 * The dialpad used to show an estimate derived from the cached price (dollars ÷
 * price), which is not the trade: it omits the spread, the referral fee and the
 * route's impact, and it cheerfully prices Ondo prestocks at 3am when their RFQ
 * makers will not fill at all. At two requests for a single leg there is room
 * in the Developer plan's 10 req/s to ask the venue instead of guessing.
 *
 * That headroom is per-LEG, and it does not survive multiplication — see the
 * note at the foot of this file for why baskets must not quote this way.
 *
 * Three things keep that affordable, since the amount changes on every keypress:
 *  - a debounce, so a typed "125" is one request rather than three;
 *  - an abort, so a superseded request stops occupying a connection; and
 *  - a short-lived cache, so re-opening the sheet or flipping buy/sell and back
 *    reuses terms that are still current.
 *
 * `amountRaw` is base units of whatever is SPENT (micro-USDC on a buy, token
 * units on a sell) — null while the caller can't compute it yet, which parks
 * the hook rather than quoting something wrong.
 */

const DEBOUNCE_MS = 400;
/** Quotes move; past this they are re-asked rather than shown as current. */
const CACHE_TTL_MS = 15_000;

type CacheEntry = {
  at: number;
  preview: TradeQuotePreview;
};
const cache = new Map<string, CacheEntry>();
/** Every keystroke mints a key, so the oldest are dropped rather than kept forever. */
const CACHE_MAX_ENTRIES = 40;

function evict() {
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

function remember(key: string, preview: TradeQuotePreview) {
  cache.set(key, { at: Date.now(), preview });
  evict();
}

export type TradeQuotePreviewState = {
  preview: TradeQuotePreview | null;
  loading: boolean;
  /** Set when the quote could not be fetched at all (network/timeout). */
  error: string | null;
};

export function useTradeQuotePreview(opts: {
  enabled: boolean;
  side: 'buy' | 'sell';
  mint: string | null;
  amountRaw: string | null;
  taker?: string | null;
}): TradeQuotePreviewState {
  const { enabled, side, mint, amountRaw, taker } = opts;
  const [state, setState] = useState<TradeQuotePreviewState>({
    preview: null,
    loading: false,
    error: null,
  });

  // Every request carries the id it was issued under, so a slow response that
  // lost the race can be dropped instead of overwriting newer terms.
  const requestIdRef = useRef(0);

  const key = enabled && mint && amountRaw ? `${side}:${mint}:${amountRaw}:${taker ?? ''}` : null;

  useEffect(() => {
    const requestId = ++requestIdRef.current;

    if (!key || !mint || !amountRaw) {
      setState({ preview: null, loading: false, error: null });
      return;
    }

    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      setState({ preview: cached.preview ?? null, loading: false, error: null });
      return;
    }

    // Keep the previous terms on screen while the next ones load: blanking the
    // row on every keystroke flickers harder than a slightly stale number reads
    // as wrong, and the spinner already says it is being refreshed.
    setState((prev) => ({ preview: prev.preview, loading: true, error: null }));

    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const preview = await getTradeQuotePreview({
            side,
            mint,
            amount: amountRaw,
            taker: taker ?? undefined,
            signal: controller.signal,
          });
          if (requestId !== requestIdRef.current) return;
          remember(key, preview);
          setState({ preview, loading: false, error: null });
        } catch (error) {
          // A superseded request aborts by design — that is not a failure the
          // user should see, and the newer request owns the state now.
          if (requestId !== requestIdRef.current) return;
          setState({
            preview: null,
            loading: false,
            error: error instanceof Error ? error.message : 'Could not load a quote.',
          });
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, side, mint, amountRaw, taker]);

  return state;
}

/**
 * The basket form: live venue terms for every leg of a sandwich at once.
 *
 * This is the expensive one, and the constraint that kept it unbuilt is real —
 * both venue quotes plus the safety guard's reverse quote PER LEG, against a
 * bucket that execution shares. A careless version of this hook would switch
 * off the safety check on the very trade it was previewing.
 *
 * So it is deliberately more conservative than the single-leg hook above:
 *
 *  - a LONGER debounce, because the cost per fire scales with leg count;
 *  - `enabled: false` while a buy is warming or executing, which is the rule
 *    that actually protects the guard: the trade owns the bucket outright, and
 *    a preview never competes with it;
 *  - one in-flight request, superseded ones aborted; and
 *  - the same short TTL cache, keyed on every leg and amount.
 *
 * The server paces its own fan-out (lib/server/jupiter-rate-limit.ts), so the
 * legs spread across ~2s rather than bursting; that is what keeps a big basket
 * from hitting the ceiling even once this fires.
 */

/** Longer than the single-leg debounce: each fire costs 2 requests per leg. */
const BASKET_DEBOUNCE_MS = 650;

export type BasketQuoteLeg = { legId: string; mint: string; amountRaw: string; label?: string };

export type BasketQuotePreviewState = {
  /** Terms per legId, absent until that leg has been quoted. */
  previews: Map<string, TradeQuotePreview>;
  loading: boolean;
  error: string | null;
  /**
   * True only when `previews` belongs to the exact leg/amount key currently on
   * screen. The hook deliberately keeps older terms visible during a refresh,
   * but callers must never use those older terms to arm or block a trade.
   */
  ready: boolean;
};

const EMPTY_PREVIEWS = new Map<string, TradeQuotePreview>();

const basketCache = new Map<string, { at: number; previews: Map<string, TradeQuotePreview> }>();

export function useBasketQuotePreview(opts: {
  /** Pass false while a buy is warming or in flight — the trade owns the bucket. */
  enabled: boolean;
  side: 'buy' | 'sell';
  legs: BasketQuoteLeg[];
  taker?: string | null;
}): BasketQuotePreviewState {
  const { enabled, side, legs, taker } = opts;
  const [state, setState] = useState<{
    previews: Map<string, TradeQuotePreview>;
    loading: boolean;
    error: string | null;
    resolvedKey: string | null;
  }>({
    previews: EMPTY_PREVIEWS,
    loading: false,
    error: null,
    resolvedKey: null,
  });

  const requestIdRef = useRef(0);

  // Serialized so the effect re-runs on a real change of terms rather than on
  // every re-render handing it a fresh array identity.
  const key =
    enabled && legs.length > 0
      ? `${side}:${taker ?? ''}:${legs.map((leg) => `${leg.legId}@${leg.mint}@${leg.amountRaw}`).join(',')}`
      : null;

  useEffect(() => {
    const requestId = ++requestIdRef.current;

    if (!key) {
      setState({ previews: EMPTY_PREVIEWS, loading: false, error: null, resolvedKey: null });
      return;
    }

    const cached = basketCache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      setState({ previews: cached.previews, loading: false, error: null, resolvedKey: key });
      return;
    }

    // Previous terms stay on screen while the next load — same reasoning as the
    // single-leg hook, and it matters more here because the fetch is slower.
    setState((prev) => ({ ...prev, loading: true, error: null }));

    const controller = new AbortController();
    const snapshot = legs;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const rows = await getBasketQuotePreview({
            side,
            legs: snapshot.map((leg) => ({
              mint: leg.mint,
              amount: leg.amountRaw,
              label: leg.label,
            })),
            taker: taker ?? undefined,
            signal: controller.signal,
          });
          if (requestId !== requestIdRef.current) return;
          const previews = new Map<string, TradeQuotePreview>();
          rows.forEach((preview, index) => {
            const leg = snapshot[index];
            if (leg) previews.set(leg.legId, preview);
          });
          basketCache.set(key, { at: Date.now(), previews });
          while (basketCache.size > CACHE_MAX_ENTRIES) {
            const oldest = basketCache.keys().next();
            if (oldest.done) break;
            basketCache.delete(oldest.value);
          }
          setState({ previews, loading: false, error: null, resolvedKey: key });
        } catch (error) {
          if (requestId !== requestIdRef.current) return;
          setState({
            previews: EMPTY_PREVIEWS,
            loading: false,
            error: error instanceof Error ? error.message : 'Could not load basket terms.',
            resolvedKey: key,
          });
        }
      })();
    }, BASKET_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `legs` is covered by `key`, which serializes its contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, side, taker]);

  return {
    previews: state.previews,
    loading: state.loading,
    error: state.error,
    // `resolvedKey` prevents a closed-market result for "$5" from disabling a
    // newly-entered "$50" order during the new quote's debounce/network time.
    ready: key !== null && state.resolvedKey === key && !state.loading,
  };
}
