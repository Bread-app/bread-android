import { useCallback, useEffect, useState } from 'react';

/**
 * Dev-only paper trading.
 *
 * The perps success receipt only ever appeared after a real order settled on
 * chain, which made iterating on it cost real collateral and a real position to
 * unwind every single time. With paper mode on, the Long/Short button runs the
 * whole pad — validation, sizing, leverage, auto-close — then stops short of
 * building and signing the transaction, and fires the receipt off the values
 * you actually typed.
 *
 * Hard-gated on `__DEV__`. `isPaperMode()` is a compile-time false in a release
 * bundle, so the short-circuit below it is unreachable in anything shipped —
 * there is no runtime path, no persisted flag, and no setting that can turn
 * this on in production.
 */

/** Deliberately in-memory: a paper session should never outlive an app launch. */
let paperMode = false;

type Listener = (enabled: boolean) => void;
const listeners = new Set<Listener>();

export function isPaperMode(): boolean {
  return __DEV__ && paperMode;
}

export function setPaperMode(enabled: boolean) {
  if (!__DEV__) return;
  if (paperMode === enabled) return;
  paperMode = enabled;
  listeners.forEach((listener) => listener(paperMode));
}

/** Subscribe a component to the flag. Returns the live value. */
export function usePaperMode(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(isPaperMode);

  useEffect(() => {
    const listener: Listener = (next) => setEnabled(next);
    listeners.add(listener);
    setEnabled(isPaperMode());
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const set = useCallback((next: boolean) => setPaperMode(next), []);
  return [enabled, set];
}
