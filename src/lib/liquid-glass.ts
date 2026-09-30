import { isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { Platform } from 'react-native';

/**
 * Whether this device can actually render Liquid Glass (iOS 26+).
 *
 * A runtime capability probe rather than a `Platform.Version >= 26` check: some
 * iOS 26 betas ship without the API, and asking the system beats inferring it
 * from a version number.
 */
export const HAS_LIQUID_GLASS =
  Platform.OS === 'ios' && isGlassEffectAPIAvailable();

/**
 * The `variant` to hand an `@expo/ui` SwiftUI `Button`.
 *
 * `.glass` / `.glassProminent` are iOS 26 button styles. Below 26 `@expo/ui`
 * applies **no** `buttonStyle` at all for them (see `ios/Button/Button.swift` —
 * the glass cases live inside `if #available(iOS 26.0)`, and the `else` branch
 * returns the button untouched). The control then falls back to SwiftUI's
 * `.automatic` style, which on iOS 18 is a borderless *text* button: the fill
 * silently vanishes and only the label is left. Any label colour chosen to read
 * against the missing fill then reads against the page background instead,
 * which is how Home's "+ Add cash" ended up as near-invisible blue-on-blue.
 *
 * These pre-26 substitutes are the closest system styles that still paint a
 * fill, so the tint keeps meaning the same thing on both sides of the boundary.
 */
export function glassButtonVariant(
  variant: 'glass' | 'glassProminent',
): 'glass' | 'glassProminent' | 'bordered' | 'borderedProminent' {
  if (HAS_LIQUID_GLASS) {
    return variant;
  }
  return variant === 'glassProminent' ? 'borderedProminent' : 'bordered';
}
