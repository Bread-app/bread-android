import React, { useCallback, useRef } from 'react';
import type { View } from 'react-native';

import { NATIVE_ZOOM_SOURCE_TEST_ID, useIsNativeZoomSource } from '@/lib/native-zoom';
import { measureZoomSource, type ZoomSourceRect } from '@/lib/zoom-transition';

export type ZoomSourceProps = {
  /** Attach to the pressable surface the detail screen should grow out of. */
  ref: React.RefObject<View | null>;
  /** Marks that surface for UIKit's zoom while it is the one being opened. */
  testID: string | undefined;
  /** Measure the surface at press time, for the JS zoom. */
  measure: () => Promise<ZoomSourceRect | null>;
};

/**
 * Lets any list row be the origin of the asset detail zoom, the way `StockCard`
 * is: one native marker (for the iOS 18+ zoom) and one measured rect (for the
 * JS zoom) on the same view. A render prop, so rows rendered inline in a
 * `.map` can use it without being extracted into components of their own.
 *
 * Open with `useStockDetail().open(stock, { source: await measure(), nativeSourceKey: zoomKey })`.
 */
export function ZoomSource({
  zoomKey,
  borderRadius = 0,
  children,
}: {
  /** Unique per row on screen — the same key passed as `nativeSourceKey`. */
  zoomKey: string;
  borderRadius?: number;
  children: (props: ZoomSourceProps) => React.ReactNode;
}) {
  const ref = useRef<View>(null);
  const isSource = useIsNativeZoomSource(zoomKey);
  const measure = useCallback(() => measureZoomSource(ref, borderRadius), [borderRadius]);
  return <>{children({ ref, testID: isSource ? NATIVE_ZOOM_SOURCE_TEST_ID : undefined, measure })}</>;
}
