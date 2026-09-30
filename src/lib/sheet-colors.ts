import type { ThemeColors } from '@/constants/theme';

/**
 * The asset page's surface — a hair off pure white (and off pure black) so
 * the page reads as a card lifted from the feed rather than the feed itself.
 * Spot and Perp are two views of one page, so both draw on this; the perp
 * side used to paint `colors.background` and showed as a white card sitting
 * on a green one whenever it opened.
 */
export function getSheetColors(c: ThemeColors) {
  const isDark = c.background !== '#ffffff';
  return {
    background: isDark ? '#0c0f0d' : '#f7fcf8',
    backgroundAlt: c.backgroundAlt,
    surfaceAlt: c.surfaceAlt,
    border: c.border,
  };
}
