import { signTypedDataWithWallet, type EvmSigningWallet } from '@/lib/evm-sign';
import { prepareTradingSetup, submitTradingSetup } from '@/lib/hyperliquid-api';

/**
 * Make sure this user can trade on Hyperliquid: one USDC balance across every
 * market (unified account), Bread's builder fee approved, and Bread's server
 * agent approved to place their orders. Each is a free signed message from the
 * embedded EVM wallet, and only what's missing is asked for — a no-op once done.
 *
 * Hyperliquid refuses all three until the account has received a deposit, so
 * this runs after the first move to perps (and before any order, as a backstop).
 */
export async function ensureHyperliquidTradingSetup(wallet: EvmSigningWallet): Promise<boolean> {
  const prepared = await prepareTradingSetup();
  if (prepared.ready) return true;
  const signed = [];
  for (const step of prepared.steps) {
    // Sequential: the wallet signs one message at a time.
    signed.push({
      step: step.step,
      nonce: step.nonce,
      signature: await signTypedDataWithWallet(wallet, step.typedData),
    });
  }
  const result = await submitTradingSetup(signed);
  return result.ready;
}
