import { useCallback, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

/**
 * SPIKE — the native half of the asset-detail zoom, using UIKit's real iOS 18
 * transition instead of the JS rebuild in `components/zoom-screen.tsx`.
 *
 * `react-native-screens` has no zoom support and no way to name a source view,
 * so the two halves talk through the view hierarchy: the row about to be opened
 * renders `testID={NATIVE_ZOOM_SOURCE_TEST_ID}` (React Native maps `testID` to
 * `accessibilityIdentifier`), and the patched `RNSScreenStack.mm` finds it and
 * hands it to `preferredTransition = .zoom` just before pushing.
 *
 * Because the marker has to be COMMITTED to the native view before the push,
 * callers mark the row and push on the next frame — see {@link openWithNativeZoom}.
 */
export const NATIVE_ZOOM_SOURCE_TEST_ID = 'rns-zoom-source';

/**
 * The destination's counterpart: the element the row should land ON.
 *
 * UIKit aligns the source view to the top-left of the pushed screen unless the
 * transition is given an `alignmentRectProvider`. On a screen with a safe-area
 * gap and its own padding that top-left is empty, so the zoom opens on blank
 * space. Marking the real header with this points UIKit at the content that
 * corresponds to the row.
 */
export const NATIVE_ZOOM_TARGET_TEST_ID = 'rns-zoom-target';

/** Namespace Sandwich posts away from asset ids while sharing one native marker. */
export function sandwichNativeZoomSourceKey(id: string): string {
  return `sandwich:${id}`;
}

/**
 * Whether this build can use UIKit's own zoom transition.
 *
 * `preferredTransition = .zoom` is iOS 18+, and it only exists in a binary built
 * from `patches/react-native-screens+4.16.0.patch` (applied automatically by the
 * `postinstall` hook). Everything that falls outside that — Android, iOS 17 and
 * older — keeps the JS rebuild in `components/zoom-screen.tsx`, which is
 * portable and looks near-identical.
 *
 * A binary built WITHOUT the patch degrades to a plain slide push rather than
 * breaking, so a stale build is a cosmetic regression, not an outage.
 */
export const NATIVE_ZOOM_SPIKE =
  Platform.OS === 'ios' && Number.parseInt(String(Platform.Version), 10) >= 18;

let sourceKey: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Mark (or unmark) the row the next push should grow out of. */
export function setNativeZoomSource(key: string | null) {
  if (sourceKey === key) return;
  sourceKey = key;
  emit();
}

/** Whether this row is currently the marked zoom source. */
export function useIsNativeZoomSource(key: string): boolean {
  const getSnapshot = useCallback(() => sourceKey === key, [key]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/**
 * Mark `key` as the source and run `push` once the marker has actually reached
 * the native view. One frame, the same cost the JS zoom already pays to measure
 * the row.
 */
export function openWithNativeZoom(key: string, push: () => void) {
  setNativeZoomSource(key);
  requestAnimationFrame(() => {
    push();
    // The transition holds its own weak reference by now, so the marker has
    // done its job; leaving it on would make the NEXT push zoom from this row.
    requestAnimationFrame(() => setNativeZoomSource(null));
  });
}
