import { PublicKey, type PublicKeyInitData } from '@solana/web3.js';
import type { WalletAuthorizationCache } from '@wallet-ui/react-native-web3js';
import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'bread.mwa.authorization';

/**
 * JSON.stringify flattens every `PublicKey` to base58, so rebuild them on read.
 * `address` must be covered, not just the deprecated `publicKey` alias, or
 * `account.address.toBase58()` throws after a restart.
 */
function reviver(key: string, value: unknown) {
  if ((key === 'address' || key === 'publicKey') && typeof value === 'string') {
    return new PublicKey(value as PublicKeyInitData);
  }
  return value;
}

/**
 * MWA authorization cache backed by SecureStore (the app's only local
 * persistence). The provider's default is AsyncStorage, which would hold the
 * wallet `auth_token` unencrypted.
 */
export function createSecureStoreCache(): WalletAuthorizationCache {
  return {
    async get() {
      try {
        const raw = await SecureStore.getItemAsync(STORAGE_KEY);
        return raw ? JSON.parse(raw, reviver) : undefined;
      } catch {
        return undefined;
      }
    },
    async set(value) {
      if (!value) {
        await SecureStore.deleteItemAsync(STORAGE_KEY);
        return;
      }
      await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(value));
    },
    async clear() {
      await SecureStore.deleteItemAsync(STORAGE_KEY);
    },
  };
}
