import type { RefObject } from 'react';
import type { View } from 'react-native';

/**
 * The on-screen rectangle a zoom transition grows out of (and collapses back
 * into) — window coordinates, plus the corner radius of the tapped surface so
 * the growing card starts with the same corners the row had.
 *
 * This is the whole contract between a list row and the screen it opens: rows
 * measure themselves at press time and hand this over, and nothing else about
 * the source needs to cross the route boundary.
 */
export type ZoomSourceRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  borderRadius: number;
};

/**
 * Measure a pressed row for {@link ZoomSourceRect}.
 *
 * `measureInWindow` is callback-based, so this resolves a frame later at worst;
 * callers await it before pushing. It resolves `null` rather than rejecting
 * when the node is gone or reports a zero-sized frame — an unmeasurable source
 * is not an error, it just means the destination should present without a zoom
 * instead of growing out of a degenerate rect.
 */
export function measureZoomSource(
  ref: RefObject<View | null>,
  borderRadius = 20,
): Promise<ZoomSourceRect | null> {
  const node = ref.current;
  if (!node) return Promise.resolve(null);
  return new Promise((resolve) => {
    node.measureInWindow((x, y, width, height) => {
      if (!width || !height) {
        resolve(null);
        return;
      }
      resolve({ x, y, width, height, borderRadius });
    });
  });
}
