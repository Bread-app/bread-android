/**
 * Shared geometry for every amount keypad in the app.
 *
 * Four 49pt rows plus three 4pt gutters keeps the number rhythm compact like
 * the native trading reference while preserving full-size touch targets.
 * Keeping this outside either pad prevents tall sheets from stretching one
 * keypad differently from another.
 */
export const NUMERIC_KEYPAD_HEIGHT = 208;
export const NUMERIC_KEYPAD_GAP = 4;
/** Compact numeral size shared by spot, perp order, and perp close pads. */
export const NUMERIC_KEYPAD_FONT_SIZE = 28;

export const NUMERIC_KEYPAD_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'del'],
] as const;
