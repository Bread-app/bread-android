import { MobileWalletProvider } from '@wallet-ui/react-native-web3js';
import React, { type ReactNode } from 'react';

import {
  BREAD_APP_IDENTITY,
  SOLANA_CHAIN,
  SOLANA_RPC_URL,
} from '@/lib/solana-mobile/identity';
import { createSecureStoreCache } from '@/lib/solana-mobile/secure-store-cache';

const authorizationCache = createSecureStoreCache();

/**
 * Mobile Wallet Adapter for the whole app (Seed Vault on Seeker, Phantom,
 * Solflare, …). Must wrap `BottomSheetModalProvider`: gorhom portals sheet
 * content up to that provider, so anything mounted below it is invisible to
 * `useMobileWallet` inside a sheet.
 */
export function SolanaMobileProvider({ children }: { children: ReactNode }) {
  return (
    <MobileWalletProvider
      chain={SOLANA_CHAIN}
      endpoint={SOLANA_RPC_URL}
      identity={BREAD_APP_IDENTITY}
      cache={authorizationCache}>
      {children}
    </MobileWalletProvider>
  );
}
