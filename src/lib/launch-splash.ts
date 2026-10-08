import * as SplashScreen from 'expo-splash-screen';

/**
 * Holds the native launch splash (bread slice on green, see app.json) over the
 * app until the first real screen is decided, instead of hiding the instant JS
 * mounts and flashing a white spinner while Privy + the user sync settle.
 *
 * Runs at import time so it lands before the first render. `hideLaunchSplash`
 * is idempotent; the root layout also arms a fallback timer so a hung Privy
 * init can never trap the user behind the splash.
 */
void SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ fade: true, duration: 300 });

/** Upper bound on how long the splash may cover a slow launch. */
export const LAUNCH_SPLASH_MAX_MS = 6000;

let hidden = false;

export function hideLaunchSplash() {
  if (hidden) return;
  hidden = true;
  SplashScreen.hide();
}
