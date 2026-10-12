/**
 * The Home header is a fixed solid sky-blue board, deliberately outside the app's
 * light/dark tokens — same call the ticker tape makes, and for the same reason:
 * a pale-blue balance and a phosphor-green P&L only read as lit against a deep
 * ground. Themed tokens would wash both out in light mode.
 */
export const HeaderPalette = {
  /**
   * A calm, slightly deep sky blue. The login screen's '#38BDF8' was tried
   * first but it was too loud: white read at 2.1:1 and the P&L tones vanished.
   * The top overscroll ground takes it from here so pulling past the page stays
   * seamless.
   *
   * Was '#101520', a near-black with a cool cast: lifted off pure black so the
   * board read as a surface rather than a hole, since on OLED #000 is a
   * genuinely unlit pixel and the sheet's edge above it loses all definition.
   */
  background: '#2AA8E8',
  /**
   * The ticker, sheet corners and compact bar. Same sky blue as `background`:
   * the board is one solid colour (was a gradient down to '#4338CA').
   */
  backgroundBottom: '#2AA8E8',
  /** Bare channels for the ticker's edge fades. */
  backgroundBottomRgb: '42, 168, 232',
  /** The balance. */
  value: '#FFFFFF',
  /** Muted copy on the board (errors, secondary lines). */
  muted: 'rgba(255, 255, 255, 0.62)',
  /** Placeholder blocks while a figure loads. */
  skeleton: 'rgba(255, 255, 255, 0.10)',
  /** Pressable chrome on the board. */
  control: 'rgba(255, 255, 255, 0.14)',
} as const;

/**
 * Lit figure tones on the board, shared by the ticker tape and the hero's P&L.
 *
 * These are the app's positive and negative colours. Keeping them here rather
 * than reading the theme is deliberate: the board is outside the light/dark
 * tokens, and one place for both the tape and the P&L keeps their direction
 * colours consistent.
 *
 * Was '#50FF05' / '#E63B8A', tuned to glow on a near-black board.
 */
export const BoardTone = {
  up: '#35F046',
  down: '#FF1F4B',
  flat: '#7F8C88',
} as const;

/** Corner radius where the white content sheet meets the header. */
export const SHEET_RADIUS = 32;
