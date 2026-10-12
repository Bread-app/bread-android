import { useLoginWithSiws } from '@privy-io/expo';
import { PublicKey } from '@solana/web3.js';
import { toUint8Array, transact } from '@wallet-ui/react-native-web3js';
import { Buffer } from 'buffer';
import { useCallback } from 'react';
import nacl from 'tweetnacl';

import { BREAD_APP_IDENTITY, BREAD_SIWS_DOMAIN, SOLANA_CHAIN } from '@/lib/solana-mobile/identity';

/**
 * Sign in to Bread with an on-device Solana wallet over Mobile Wallet Adapter.
 *
 * Privy stays the identity provider — the backend only trusts Privy JWTs — so
 * this is Privy's SIWS login with MWA as the signer: authorize the wallet, ask
 * Privy for a nonce-bound SIWS message, have the wallet sign it, hand the
 * signature back to Privy. The user still gets a Privy embedded wallet for
 * trading; the MWA wallet is only linked as a login method + funding source.
 *
 * All of it happens inside ONE wallet session (one trip to Phantom). Separate
 * `connect()` + `signMessages()` calls opened a second session the moment Bread
 * came back to the foreground, which wallets on Android reject.
 *
 * Requires "Solana wallet" login to be enabled in the Privy dashboard.
 */
export function useSolanaWalletLogin() {
  const { generateMessage, login } = useLoginWithSiws();

  return useCallback(async () => {
    const { message, signature, walletLabel } = await transact(async (wallet) => {
      const authorization = await wallet.authorize({ chain: SOLANA_CHAIN, identity: BREAD_APP_IDENTITY });
      const account = authorization.accounts[0];
      if (!account) throw new Error('Wallet authorized no accounts');
      const addressBytes = toUint8Array(account.address);
      const address = new PublicKey(addressBytes).toBase58();

      // Privy's nonce request runs while the wallet still holds the session.
      const { message } = await generateMessage({
        wallet: { address },
        from: { domain: BREAD_SIWS_DOMAIN, uri: BREAD_APP_IDENTITY.uri ?? 'https://breadapp.fun' },
      });
      const messageBytes = new TextEncoder().encode(message);
      const [signed] = await wallet.signMessages({ addresses: [account.address], payloads: [messageBytes] });

      return {
        message,
        signature: detachedSignature(messageBytes, signed, addressBytes),
        walletLabel: account.label,
      };
    });

    return login({
      message,
      signature: Buffer.from(signature).toString('base64'),
      wallet: { walletClientType: walletLabel ?? 'mobile_wallet_adapter', connectorType: 'mobile_wallet_adapter' },
    });
  }, [generateMessage, login]);
}

/**
 * MWA's `sign_messages` returns "signed payloads", and wallets disagree on the
 * shape: some return the bare 64-byte signature, others the message with the
 * signature appended (or prepended). Privy wants the bare signature, so take
 * the 64-byte candidate that actually verifies against the signer's key.
 */
export function detachedSignature(message: Uint8Array, signed: Uint8Array, publicKey: Uint8Array): Uint8Array {
  const candidates =
    signed.length === 64 ? [signed] : [signed.slice(signed.length - 64), signed.slice(0, 64)];
  const valid = candidates.find((sig) => nacl.sign.detached.verify(message, sig, publicKey));
  if (!valid) throw new Error(`Wallet returned a signature that does not verify (${signed.length} bytes)`);
  return valid;
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
