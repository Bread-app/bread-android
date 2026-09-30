import { PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { useMobileWallet } from '@wallet-ui/react-native-web3js';
import { useCallback } from 'react';

import {
  buildUsdcDepositInstructions,
  usdcToBaseUnits,
} from '@/lib/solana-mobile/usdc-transfer';

/**
 * Move USDC from an on-device wallet (Seed Vault, Phantom, …) into the user's
 * Bread wallet in one MWA prompt. The sender pays its own fee — Bread's gasless
 * payer is never involved in an external wallet's transaction.
 *
 * Returns the signature once `confirmed`; the Privy deposit webhook + the
 * existing deposit poller pick it up exactly like any other incoming transfer.
 */
export function useMwaUsdcDeposit() {
  const { connect, connection, signAndSendTransaction } = useMobileWallet();

  return useCallback(
    async (opts: { to: string; amountUsd: string }) => {
      const account = await connect();
      const to = new PublicKey(opts.to);
      if (to.equals(account.address)) {
        throw new Error('That wallet is already your Bread wallet');
      }

      const instructions = buildUsdcDepositInstructions({
        from: account.address,
        to,
        amount: usdcToBaseUnits(opts.amountUsd),
      });

      // signAndSend needs the slot the blockhash was read at.
      const {
        context: { slot: minContextSlot },
        value: latestBlockhash,
      } = await connection.getLatestBlockhashAndContext();

      const message = new TransactionMessage({
        payerKey: account.address,
        recentBlockhash: latestBlockhash.blockhash,
        instructions,
      }).compileToV0Message();

      const signature = await signAndSendTransaction(new VersionedTransaction(message), minContextSlot);

      await connection.confirmTransaction({ signature, ...latestBlockhash }, 'confirmed');
      return { signature, from: account.address.toBase58() };
    },
    [connect, connection, signAndSendTransaction],
  );
}
