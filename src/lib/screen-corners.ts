import { Dimensions, Platform } from 'react-native';

/**
 * The physical corner radius of the display, in points.
 *
 * Controls pinned to the bottom of the screen only look deliberate when their
 * own corners run *parallel* to the glass they sit in — the same gap the whole
 * way around the curve. That is only possible if we know how round the screen
 * itself is, and iOS does not expose it (the private
 * `_displayCornerRadius` is off-limits), so it is keyed off the point size of
 * the display, which is unique per hardware family.
 *
 * `0` means "assume square" — older iPhones, Android, web. Callers fall back to
 * a plain pill there rather than guessing a curve that isn't on the device.
 */
function displayCornerRadius(): number {
  if (Platform.OS !== 'ios') return 0;

  const { width, height } = Dimensions.get('screen');
  const key = `${Math.round(Math.min(width, height))}x${Math.round(Math.max(width, height))}`;

  switch (key) {
    // Home-button iPhones: square display, square corners.
    case '320x568':
    case '375x667':
    case '414x736':
      return 0;
    case '375x812': // X, XS, 11 Pro, 12/13 mini
      return 39;
    case '414x896': // XR, 11, XS Max, 11 Pro Max
      return 41.5;
    case '390x844': // 12, 13, 14
      return 47.33;
    case '428x926': // 12/13 Pro Max, 14 Plus
      return 53.33;
    case '393x852': // 14 Pro, 15, 15 Pro, 16
    case '430x932': // 14 Pro Max, 15 Plus/Pro Max, 16 Plus
      return 55;
    case '402x874': // 16 Pro
    case '440x956': // 16 Pro Max
      return 62;
    default:
      // An iPhone we don't have in the table yet. Everything shipped since the
      // X is rounded, and the tall aspect ratio is the tell.
      return height / width > 1.9 ? 55 : 0;
  }
}

export const SCREEN_CORNER_RADIUS = displayCornerRadius();

/**
 * The height, margin and corner radius for a control pinned against the bottom
 * of the screen, sized so its corners nest concentrically inside the display's.
 *
 * Concentric means `inset + radius === SCREEN_CORNER_RADIUS`: the control's
 * curve is the screen's curve moved inward by the margin, so the gap between
 * the two stays even the whole way around. A radius can never exceed half the
 * control's height (past that it is just a pill), so on a very round phone the
 * control grows a little to earn the curve it needs — up to `maxHeight`, after
 * which the pill is as round as it goes and the last point or two of mismatch
 * is invisible. The inset is clamped at both ends so a round phone doesn't
 * squeeze the buttons toward the middle, nor a square one let them graze the
 * edge.
 */
export function concentricEdge(
  preferredHeight: number,
  { min = 16, max = 28, maxHeight = preferredHeight + 10 }: {
    min?: number;
    max?: number;
    maxHeight?: number;
  } = {},
): { height: number; inset: number; radius: number } {
  const pill = preferredHeight / 2;
  if (SCREEN_CORNER_RADIUS <= 0) {
    return { height: preferredHeight, inset: min, radius: pill };
  }

  const inset = Math.min(max, Math.max(min, Math.round(SCREEN_CORNER_RADIUS - pill)));
  const want = SCREEN_CORNER_RADIUS - inset;
  // Taller than a pill of this height can curve: grow into the radius rather
  // than settle for a corner that cuts across the screen's.
  const height = Math.min(maxHeight, Math.max(preferredHeight, want * 2));
  return { height, inset, radius: Math.min(height / 2, want) };
}

/**
 * The app's pinned call-to-action geometry: BUY, LONG/SHORT, CLOSE, PUBLISH —
 * every button that lives at the bottom edge of a screen or sheet.
 *
 * One shared object so the bars agree with each other as well as with the
 * hardware. A CTA that is 24pt from the edge on one screen and 20pt on the next
 * reads as sloppy even when neither is wrong on its own, and the radius has to
 * be derived from the inset anyway — the two are one decision, not two.
 */
export const CTA = concentricEdge(62);

/**
 * The bottom padding for a CTA bar, given the screen's safe-area inset.
 *
 * On iOS the display corner is the reference and the home indicator sits well
 * inside {@link CTA}'s inset, so the inset stands on its own. Android's inset
 * is a navigation bar — real chrome that would sit on top of the button — so
 * there the button clears it instead.
 */
export function ctaBottomInset(safeAreaBottom = 0): number {
  if (Platform.OS === 'ios') return CTA.inset;
  return Math.max(CTA.inset, safeAreaBottom + 12);
}
