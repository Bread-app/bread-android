import { Platform } from 'react-native';

/**
 * The push transition for full-screen routes.
 *
 * Android uses react-native-screens' `default`, which on Android 13+ is the
 * platform's own activity transition (10% shift + fade on
 * fast_out_extra_slow_in) run by the Fragment animator — native, off the JS
 * thread, and what every other Android app does. iOS keeps its quick
 * side-push. `animationDuration` is iOS-only, so it is not sent to Android.
 */
export const PUSH_TRANSITION =
  Platform.OS === 'android'
    ? ({ animation: 'default' } as const)
    : ({ animation: 'slide_from_right', animationDuration: 200 } as const);
