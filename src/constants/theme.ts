/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';
import { Easing } from 'react-native-reanimated';

/**
 * Semantic color tokens. Every screen/component should style from these (via
 * `useThemedStyles` / `useThemeStore().colors`) rather than hard-coding hex, so
 * the whole app follows the Light / Dark / System toggle. Brand accents
 * (green / blue / red) are intentionally near-invariant across modes.
 */
export type ThemeColors = {
  // Backgrounds & surfaces
  background: string;
  backgroundAlt: string;
  surface: string;
  surfaceAlt: string;
  surfaceSelected: string;
  // Text — a 4-rung emphasis ladder. See `TextEmphasis` below: hierarchy is
  // expressed by picking a rung, never by layering `opacity` on top of one.
  text: string;
  textSecondary: string;
  textTertiary: string;
  textQuaternary: string;
  textInverse: string;
  // Lines & icons
  border: string;
  icon: string;
  iconMuted: string;
  // Accents (brand)
  accent: string;
  accentDeep: string;
  accentBlue: string;
  positive: string;
  negative: string;
  // Editable actions
  actionPrimary: string;
  actionPrimaryText: string;
  actionBuy: string;
  actionSell: string;
  // Editable charts
  chartPositive: string;
  chartNegative: string;
  chartNeutral: string;
  chartGrid: string;
  chartCrosshair: string;
  // Misc
  overlay: string;
  shadow: string;
  // Legacy aliases kept for existing themed-* components.
  backgroundElement: string;
  backgroundSelected: string;
};

export const Colors: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    background: '#ffffff',
    backgroundAlt: '#f8fafc',
    surface: '#ffffff',
    surfaceAlt: '#F0F0F3',
    surfaceSelected: '#E0E1E6',
    // Slightly translucent ink softens primary copy on light surfaces without
    // dimming coloured labels, icons, or any dark-mode content.
    text: 'rgba(11, 22, 34, 0.84)',
    textSecondary: '#565A62',
    textTertiary: '#6D7686',
    textQuaternary: '#98A1B1',
    textInverse: '#ffffff',
    border: '#E6E8EC',
    icon: '#10223d',
    iconMuted: '#b5bcc6',
    accent: '#35F046',
    accentDeep: '#02ED45',
    accentBlue: '#38BDF8',
    positive: '#02ED45',
    negative: '#FF1AB8',
    actionPrimary: '#38BDF8',
    actionPrimaryText: '#FFFFFF',
    actionBuy: '#35F046',
    actionSell: '#FF1AB8',
    chartPositive: '#35F046',
    // A step brighter than the hot pink the sell/negative tokens carry: on a
    // chart it is a 1-2pt line, not a filled pill, and the deeper tone read as
    // muddy against both grounds.
    chartNegative: '#FF33C9',
    chartNeutral: '#94A3B8',
    chartGrid: '#E8EEF4',
    chartCrosshair: '#10223D',
    overlay: 'rgba(0,0,0,0.4)',
    shadow: '#1b2a4a',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
  },
  dark: {
    background: '#0b0b0f',
    backgroundAlt: '#15161a',
    surface: '#1a1b1f',
    surfaceAlt: '#212225',
    surfaceSelected: '#2E3135',
    text: '#ffffff',
    textSecondary: '#B0B4BA',
    textTertiary: '#878D97',
    textQuaternary: '#5A606A',
    textInverse: '#0b0b0f',
    border: '#2a2c31',
    icon: '#e6e8eb',
    iconMuted: '#6b7280',
    accent: '#35F046',
    accentDeep: '#02ED45',
    accentBlue: '#38BDF8',
    // Green for text/status is unified app-wide (graphs keep chartPositive).
    positive: '#02ED45',
    negative: '#FF1AB8',
    actionPrimary: '#38BDF8',
    actionPrimaryText: '#FFFFFF',
    actionBuy: '#35F046',
    actionSell: '#FF1AB8',
    chartPositive: '#35F046',
    chartNegative: '#FF33C9',
    chartNeutral: '#7C828C',
    chartGrid: '#2A2C31',
    chartCrosshair: '#E6E8EB',
    overlay: 'rgba(0,0,0,0.6)',
    shadow: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
  },
};

export type ThemeColor = keyof ThemeColors;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
    /** Heavy Rubik display face, loaded via @expo-google-fonts in the root layout. */
    display: 'Rubik_900Black',
    /** Lighter Rubik display face for compact figures that should feel less heavy. */
    displayMedium: 'Rubik_700Bold',
    /** Rubik One display face for compact, high-impact direction labels. */
    displayOne: 'RubikOne_400Regular',
    /** Rounded Baloo 2 bubble face used by the detail-screen tabs. */
    bubble: 'Baloo2_800ExtraBold',
    /** Poppins SemiBold — thesis copy on the sandwich detail sheet. */
    poppins: 'Poppins_600SemiBold',
    /** UnifrakturCook — blackletter newspaper nameplate/masthead on the News tab. */
    masthead: 'UnifrakturCook_700Bold',
    /** Inter ExtraBold — crisp, high-impact headlines on the News tab. */
    headline: 'Inter_800ExtraBold',
    /** VT323 — CRT terminal face for the home ticker tape. */
    crt: 'VT323_400Regular',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
    display: 'Rubik_900Black',
    displayMedium: 'Rubik_700Bold',
    displayOne: 'RubikOne_400Regular',
    bubble: 'Baloo2_800ExtraBold',
    poppins: 'Poppins_600SemiBold',
    masthead: 'PlayfairDisplay_900Black',
    headline: 'Inter_800ExtraBold',
    crt: 'VT323_400Regular',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
    display: 'Rubik_900Black',
    displayMedium: 'Rubik_700Bold',
    displayOne: 'RubikOne_400Regular',
    bubble: 'Baloo2_800ExtraBold',
    poppins: 'Poppins_600SemiBold',
    masthead: 'PlayfairDisplay_900Black',
    headline: 'Inter_800ExtraBold',
    crt: 'VT323_400Regular',
  },
});

/**
 * Text emphasis ladder.
 *
 * Hierarchy is carried by the **color token alone**. Do not add `opacity` to a
 * text style to push it down a rung — that stacks on top of an already-dimmed
 * token, collapses neighbouring rungs into each other, and (because RN applies
 * `opacity` to the whole subtree) drags nested icons and children down with it.
 * `opacity` on text is reserved for motion and press feedback.
 *
 * Rung          Token             Role                       Examples
 * 1 primary     `text`            what the row is about      names, headings, prices, values
 * 2 secondary   `textSecondary`   supporting copy            thesis/summary body, counts, "Show more"
 * 3 tertiary    `textTertiary`    metadata & wayfinding      timestamps, @handles, section labels
 * 4 quaternary  `textQuaternary`  decorative / disabled      separator glyphs, disabled labels
 *
 * Contrast against `background` (light / dark):
 *   primary 11.3 / 19.6  ·  secondary 6.9 / 9.4  ·  tertiary 4.6 / 5.9  ·  quaternary 2.6 / 3.1
 *
 * Rungs 1–3 clear WCAG AA for body text in both modes; rung 4 is deliberately
 * sub-AA and must only carry decoration that is never the sole source of
 * information.
 */
export const TextEmphasis = {
  primary: 'text',
  secondary: 'textSecondary',
  tertiary: 'textTertiary',
  quaternary: 'textQuaternary',
} as const satisfies Record<string, ThemeColor>;

export type TextEmphasisLevel = keyof typeof TextEmphasis;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/**
 * Corner-radius scale. Values match the vocabulary already in use across the
 * app (glass capsules and pills at `md`, stacked cards at `lg`, rails and hero
 * tiles at `xl`/`xxl`) so new surfaces stay consistent instead of re-declaring
 * one-off radii per screen.
 */
export const Radius = {
  sm: 12,
  md: 18,
  lg: 20,
  xl: 26,
  xxl: 28,
} as const;

/**
 * Motion scale.
 *
 * The app treats motion the way it treats color and spacing: as a **shared
 * vocabulary**, not a per-call-site decision. An interface reads as one place
 * because everything in it obeys the same physics — two surfaces that settle at
 * visibly different rates feel like two different apps stitched together, no
 * matter how well each one is tuned on its own.
 *
 * These values are a codification, not an invention. They are the configs the
 * app already converged on by hand; the point of naming them is to stop the
 * next animation from becoming a 22nd variant.
 *
 * ## Springs
 *
 * Pick by **what the motion means**, not by how fast you want it to look.
 *
 * Role       Config                    Use for                              Overshoot
 * `snap`     26 / 320 / 1              presses, toggles, chips, segments    minimal
 * `reveal`   26 / 300 / 1              sheets, trays, screen-level enters   minimal
 * `travel`   30 / 260 / 1              an element moving between two places none
 * `settle`   24 / 260 / 1              coming to rest after a gesture       slight
 * `pop`      9 / 130 / 0.7             celebration, reward, easter eggs     pronounced
 *
 * `travel` is deliberately the only one that does not overshoot. When an
 * element hands itself from one position to another — a card becoming a header,
 * a row becoming a sheet — the user is tracking a *thing*, and a bounce at the
 * end reads as the thing overshooting its destination rather than arriving at
 * it. Reserve the bounce for `pop`, where the overshoot IS the message.
 *
 * `settle` is almost always spread with the gesture's exit velocity, so the
 * return matches the pace the user let go at and there is no visible seam at
 * release:
 *
 *     withSpring(0, { ...Motion.spring.settle, velocity: e.velocityY })
 *
 * `pop` is rationed on purpose. Delight lands hardest on surfaces the user
 * meets rarely; spending it on a high-traffic control just makes that control
 * tiring. If you are reaching for `pop` on something used daily, you probably
 * want `snap`.
 *
 * ## Durations
 *
 * Springs are preferred for anything the user *acts on* — they carry the
 * velocity of the gesture. Reach for a timed curve when the motion is not a
 * response to a touch: cross-fades, chrome, and anything that loops.
 *
 * `instant` / `fast` / `base` / `slow` are for one-shot transitions; `base` is
 * the screen-transition rate the native stack already runs at, so a timed
 * animation that accompanies a push should use it rather than a nearby number.
 *
 * `ambient` and `drift` are for **looping** motion only — shimmer, halo,
 * skeletons, marquees. They are an order of magnitude slower than the
 * transition scale so that background motion never competes with foreground
 * feedback for attention. Do not use them for a transition, and do not use the
 * transition scale for a loop.
 *
 * ## Easing
 *
 * `enter` decelerates (fast start, soft landing) and `exit` accelerates —
 * things arrive gently and leave decisively. `inOut` is symmetric and belongs
 * to loops, where there is no arrival. `linear` is for continuous rotation and
 * marquees, where any easing would read as a stutter on each cycle.
 */
export const Motion = {
  spring: {
    snap: { damping: 26, stiffness: 320, mass: 1 },
    reveal: { damping: 26, stiffness: 300, mass: 1 },
    travel: { damping: 30, stiffness: 260, mass: 1 },
    settle: { damping: 24, stiffness: 260, mass: 1 },
    pop: { damping: 9, stiffness: 130, mass: 0.7 },
  },
  duration: {
    instant: 90,
    fast: 150,
    base: 200,
    slow: 320,
    ambient: 900,
    drift: 1500,
  },
  easing: {
    enter: Easing.out(Easing.cubic),
    exit: Easing.in(Easing.cubic),
    inOut: Easing.inOut(Easing.quad),
    linear: Easing.linear,
  },
} as const;

export type MotionSpring = keyof typeof Motion.spring;
export type MotionDuration = keyof typeof Motion.duration;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
