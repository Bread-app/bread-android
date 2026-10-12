import { Platform } from 'react-native';

/**
 * The push transition for full-screen routes.
 *
 * Android uses react-native-screens' `ios_from_right`: the incoming screen
 * slides in from the right while the one underneath shifts left, the same push
 * bread-mobile has on iOS. It is a Fragment animation run natively, off the JS
 * thread, so it costs no more than the Material default it replaced. iOS keeps
 * its quick side-push. `animationDuration` is iOS-only, so it is not sent to
 * Android.
 */
export const PUSH_TRANSITION =
  Platform.OS === 'android'
    ? ({ animation: 'ios_from_right' } as const)
    : ({ animation: 'slide_from_right', animationDuration: 200 } as const);

/**
 * For routes iOS opens with UIKit's zoom out of the tapped row (asset detail,
 * Sandwich detail). That zoom needs `animation: 'default'` on iOS — any other
 * value installs a custom animator that overrides it. Android has no native
 * zoom, so it gets the same side-push as every other screen.
 */
export const ZOOM_ROUTE_TRANSITION =
  Platform.OS === 'android'
    ? ({ animation: 'ios_from_right' } as const)
    : ({ animation: 'default' } as const);
