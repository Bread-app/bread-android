import { useCallback, useEffect, useState } from 'react';

/**
 * Demo buys — a Settings switch that makes buying a Sandwich or a single asset
 * cost nothing.
 *
 * With it on, the buy pad behaves exactly as usual — amount, presets, the
 * success receipt and its celebration — but the engine stops before building,
 * signing or broadcasting anything. No transaction exists, so no cash moves,
 * no position is recorded and the portfolio is untouched. Cash is also not
 * required: the balance gate is skipped so a demo works from an empty wallet.
 *
 * Unlike `paper-mode` (dev-only, in-memory, perps pad) and `demo/demo-config`
 * (compile-time shoot rig), this one ships in every build and persists across
 * launches. Venue minimums (the $5 prediction-leg floor, perp margin bounds)
 * don't apply either, since no order ever reaches a venue.
 *
 * Sells are deliberately NOT covered: a demo buy holds nothing to sell, and a
 * faked sell of a REAL holding would be a lie about the user's money.
 */

// Loaded lazily so pure modules that read the flag (api.ts, the sandwich
// ledger) stay importable from unit tests without React Native.
const secureStore = () => import('expo-secure-store');

// SecureStore keys allow alphanumerics plus ".", "-", "_".
const STORAGE_KEY = 'bread.demo-buy-mode';

let demoBuyMode = false;
let hydrated = false;

type Listener = (enabled: boolean) => void;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((listener) => listener(demoBuyMode));
}

// Read once per launch. Until it answers the flag is off, which is the safe
// direction: the worst case is one real buy pad before the switch loads, and
// the pad itself shows a real buy in that case.
void secureStore()
  .then((store) => store.getItemAsync(STORAGE_KEY))
  .then((stored) => {
    // A toggle made before hydration finished wins over the stored value.
    if (hydrated) return;
    hydrated = true;
    if (stored === '1' && !demoBuyMode) {
      demoBuyMode = true;
      emit();
    }
  })
  .catch(() => {
    hydrated = true;
  });

export function isDemoBuyMode(): boolean {
  return demoBuyMode;
}

export function setDemoBuyMode(enabled: boolean) {
  hydrated = true;
  if (demoBuyMode === enabled) return;
  demoBuyMode = enabled;
  emit();
  secureStore()
    .then((store) => store.setItemAsync(STORAGE_KEY, enabled ? '1' : '0'))
    .catch(() => {});
}

/** Subscribe a component to the flag. Returns the live value and a setter. */
export function useDemoBuyMode(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(isDemoBuyMode);

  useEffect(() => {
    const listener: Listener = (next) => setEnabled(next);
    listeners.add(listener);
    setEnabled(isDemoBuyMode());
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const set = useCallback((next: boolean) => setDemoBuyMode(next), []);
  return [enabled, set];
}

/** How long a demo buy "takes" — long enough that the loading state reads. */
export const DEMO_BUY_DELAY_MS = 1_000;
