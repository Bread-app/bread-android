import { useLoginWithSiws } from '@privy-io/expo';
import { useMobileWallet } from '@wallet-ui/react-native-web3js';
import { Buffer } from 'buffer';
import { useCallback } from 'react';

import { BREAD_APP_IDENTITY, BREAD_SIWS_DOMAIN } from '@/lib/solana-mobile/identity';

/**
 * Sign in to Bread with an on-device Solana wallet over Mobile Wallet Adapter.
 *
 * Privy stays the identity provider — the backend only trusts Privy JWTs — so
 * this is Privy's SIWS login with MWA as the signer: authorize the wallet, ask
 * Privy for a nonce-bound SIWS message, have the wallet sign it, hand the
 * signature back to Privy. The user still gets a Privy embedded wallet for
 * trading; the MWA wallet is only linked as a login method + funding source.
 *
 * Requires "Solana wallet" login to be enabled in the Privy dashboard.
 */
export function useSolanaWalletLogin() {
  const { connect, signMessages } = useMobileWallet();
  const { generateMessage, login } = useLoginWithSiws();

  return useCallback(async () => {
    const account = await connect();
    const address = account.address.toBase58();

    const { message } = await generateMessage({
      wallet: { address },
      from: { domain: BREAD_SIWS_DOMAIN, uri: BREAD_APP_IDENTITY.uri ?? 'https://breadapp.fun' },
    });

    const [signature] = await signMessages([new TextEncoder().encode(message)]);

    return login({
      message,
      signature: Buffer.from(signature).toString('base64'),
      wallet: { walletClientType: account.label ?? 'mobile_wallet_adapter', connectorType: 'mobile_wallet_adapter' },
    });
  }, [connect, generateMessage, login, signMessages]);
}

const CANCEL_PATTERN = /cancel|declin|reject|not authorized|ERROR_AUTHORIZATION_FAILED|user.*(closed|dismiss)/i;

/** True for "the user backed out of the wallet prompt" — not worth an error banner. */
export function isWalletCancellation(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return CANCEL_PATTERN.test(text);
}

/** True when no MWA-compatible wallet app is installed on the device. */
export function isNoWalletInstalled(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /ERROR_WALLET_NOT_FOUND|no.*wallet.*found|ActivityNotFound/i.test(text);
}
