import type { TypedDataPayload } from '@/lib/hyperliquid-api';

/** The slice of Privy's embedded EVM wallet this needs. */
export type EvmSigningWallet = {
  address: string;
  getProvider: () => Promise<{
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  }>;
};

/**
 * Sign EIP-712 typed data with the user's embedded EVM wallet. This is a signed
 * message, not a transaction: it costs no gas and broadcasts nothing. The
 * backend checks the signature recovers to this wallet before using it.
 */
export async function signTypedDataWithWallet(
  wallet: EvmSigningWallet,
  typedData: TypedDataPayload,
): Promise<string> {
  const provider = await wallet.getProvider();
  const signature = await provider.request({
    method: 'eth_signTypedData_v4',
    params: [wallet.address, JSON.stringify(typedData)],
  });
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    throw new Error('Your wallet returned an unreadable signature.');
  }
  return signature;
}
