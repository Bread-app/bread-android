import { useEffect, useRef } from "react";

type ShakeOptions = {
  /** Disable the listener entirely (e.g. while a screen is unfocused). */
  enabled?: boolean;
  /**
   * Dynamic acceleration (in g, with the ~1g of gravity removed) above which a
   * sample counts as part of a shake. ~1.2–2.0 is a firm, deliberate shake.
   */
  threshold?: number;
  /** Minimum gap between two recognized shakes so one shake fires once. */
  cooldownMs?: number;
};

type AccelerometerModule = {
  isAvailableAsync: () => Promise<boolean>;
  setUpdateInterval: (ms: number) => void;
  addListener: (
    listener: (data: { x: number; y: number; z: number }) => void,
  ) => { remove: () => void };
};

/**
 * expo-sensors ships native modules that only exist in a dev/native build
 * compiled *after* the package was added. A static `import` would crash any
 * screen using this hook on a client that predates that rebuild. So we resolve
 * it lazily and treat a missing module as "shake unsupported"; drag/tap still
 * open the wallet.
 */
function loadAccelerometer(): AccelerometerModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-sensors") as { Accelerometer?: AccelerometerModule };
    return mod?.Accelerometer ?? null;
  } catch {
    return null;
  }
}

/**
 * Fires `onShake` when the device is physically shaken. No-ops gracefully when
 * the sensor isn't available (web, some simulators, or a dev client built
 * before expo-sensors was added).
 */
export function useShake(onShake: () => void, options: ShakeOptions = {}) {
  const { enabled = true, threshold = 1.2, cooldownMs = 800 } = options;

  const onShakeRef = useRef(onShake);
  onShakeRef.current = onShake;
  const lastShakeRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const accelerometer = loadAccelerometer();
    if (!accelerometer) return;

    let subscription: { remove: () => void } | null = null;
    let cancelled = false;

    (async () => {
      try {
        const available = await accelerometer.isAvailableAsync();
        if (cancelled || !available) return;

        accelerometer.setUpdateInterval(80);
        subscription = accelerometer.addListener(({ x, y, z }) => {
          const magnitude = Math.sqrt(x * x + y * y + z * z);
          const delta = Math.abs(magnitude - 1);
          if (delta < threshold) return;

          const now = Date.now();
          if (now - lastShakeRef.current < cooldownMs) return;
          lastShakeRef.current = now;
          onShakeRef.current();
        });
      } catch {
        // Sensor unavailable — drag/tap still open the wallet.
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [enabled, threshold, cooldownMs]);
}
