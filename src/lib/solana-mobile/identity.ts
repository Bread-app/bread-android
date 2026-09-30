import type { AppIdentity, MobileWalletProviderProps } from '@wallet-ui/react-native-web3js';

type Chain = MobileWalletProviderProps['chain'];

/**
 * The identity wallets show on the MWA authorize prompt.
 *
 * `uri` must be absolute: wallets verify the app by checking the Digital Asset
 * Links file at `https://breadapp.fun/.well-known/assetlinks.json` against this
 * APK's signing certificate, and the MWA spec recommends declining an
 * authorization with no `uri`. `icon` must be a path RELATIVE to `uri` (or a
 * data URI) — an absolute https URL may be rejected, and the Kotlin client only
 * accepts the relative form.
 */
export const BREAD_APP_IDENTITY: AppIdentity = {
  name: 'Bread',
  uri: 'https://breadapp.fun',
  icon: 'favicon.ico',
};

/** The domain Bread signs SIWS messages for. Must match `BREAD_APP_IDENTITY.uri`. */
export const BREAD_SIWS_DOMAIN = 'breadapp.fun';

export const SOLANA_CHAIN: Chain = 'solana:mainnet';

/**
 * RPC the wallet adapter's `Connection` talks to. Only used for the blockhash +
 * context slot MWA's signAndSend needs; everything else still goes through the
 * backend's `/api/solana/*` routes.
 */
export const SOLANA_RPC_URL =
  process.env.EXPO_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
