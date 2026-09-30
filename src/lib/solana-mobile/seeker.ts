import { Platform } from 'react-native';

type AndroidConstants = { Model?: string; Brand?: string; Manufacturer?: string };

/**
 * Lightweight Seeker check from Platform constants.
 *
 * SPOOFABLE — rooted devices can fake these values. Use it only for UI
 * treatment (copy, badges, which button leads). Anything that grants value must
 * verify the Seeker Genesis Token server-side after a SIWS proof instead:
 * https://docs.solanamobile.com/recipes/general/detecting-seeker-users
 */
export function isSeekerDevice(): boolean {
  if (Platform.OS !== 'android') return false;
  const constants = Platform.constants as AndroidConstants;
  return constants.Model === 'Seeker' || constants.Brand === 'solanamobile';
}

/** True when this build was produced by the `dapp-store` EAS profile. */
export const IS_DAPP_STORE_BUILD = process.env.EXPO_PUBLIC_DISTRIBUTION === 'dapp-store';
