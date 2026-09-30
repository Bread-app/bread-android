import { Transaction, VersionedTransaction } from "@solana/web3.js";

import {
  createJupiterOrder,
  createUsdcTransferTransaction,
  executeJupiterOrder,
  getWalletBalances,
  sendSignedSolanaTransaction,
  type SolanaSendResponse,
} from "@/lib/api";
import {
  deserializeTransaction,
  serializeSignedTransaction,
} from "@/lib/solana-tx";
import { SOLANA_USDC_MINT, toSmallestUnits } from "@/lib/trading";

/**
 * Jupiter's yield-bearing stablecoin. Closing/selling a Jupiter prediction-market
 * position pays out in JupUSD (not USDC), so prediction sells have to convert it
 * back to USDC under the hood — see {@link settleJupUsdToCash}.
 */
export const JUP_USD_MINT = "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD";

/**
 * Minimal shape of a Privy embedded Solana wallet — enough to sign a
 * transaction without coupling this module to the Privy SDK types.
 */
export type SigningWallet = {
  address: string;
  getProvider: () => Promise<{
    request: (args: {
      method: "signTransaction";
      params: { transaction: Transaction | VersionedTransaction };
    }) => Promise<{ signedTransaction: Transaction | VersionedTransaction }>;
  }>;
};

type SendBase64Options = {
  lastValidBlockHeight?: number | string | null;
  skipSimulation?: boolean;
  fastConfirm?: boolean;
  requireConfirmed?: boolean;
};

/**
 * Sign a base64 transaction with the embedded wallet and submit it.
 * Pass `requireConfirmed` for user-visible trades that must not show success
 * while `/api/solana/send` is still pending.
 */
export async function signAndSendBase64(
  wallet: SigningWallet,
  base64Transaction: string,
  options?: SendBase64Options,
): Promise<string> {
  const result = await signAndSendBase64WithResult(wallet, base64Transaction, options);
  return result.signature;
}

export async function signAndSendBase64WithResult(
  wallet: SigningWallet,
  base64Transaction: string,
  options?: SendBase64Options,
): Promise<SolanaSendResponse> {
  const provider = await wallet.getProvider();
  const transaction = deserializeTransaction(base64Transaction);
  const signed = await provider.request({
    method: "signTransaction",
    params: { transaction },
  });
  const signedTransaction = serializeSignedTransaction(signed.signedTransaction);
  return sendSignedSolanaTransaction(signedTransaction, options);
}

/** Sign a server-issued transaction without submitting it through the generic route. */
export async function signBase64Transaction(
  wallet: SigningWallet,
  base64Transaction: string,
): Promise<string> {
  const provider = await wallet.getProvider();
  const transaction = deserializeTransaction(base64Transaction);
  const signed = await provider.request({ method: "signTransaction", params: { transaction } });
  return serializeSignedTransaction(signed.signedTransaction);
}

/** Liquid (spendable) USDC sitting in the wallet. */
export async function getLiquidUsdc(
  walletAddress: string,
): Promise<{ balance: number; smallest: bigint; decimals: number }> {
  const { tokens } = await getWalletBalances(walletAddress);
  const usdc = tokens.find(
    (token) =>
      token.mint === SOLANA_USDC_MINT ||
      (token.symbol ?? "").toUpperCase() === "USDC",
  );
  const decimals = usdc?.decimals ?? 6;
  const balance = usdc?.balance ?? 0;
  const smallest = BigInt(toSmallestUnits(String(balance), decimals) ?? "0");
  return { balance, smallest, decimals };
}

/**
 * Poll the wallet until at least `atLeastSmallest` liquid USDC is visible, or the
 * timeout elapses. Used right after a swap lands on-chain: the transaction is
 * confirmed, but the balance indexer (Helius) can lag a beat behind. Resolves
 * with whatever liquid amount is observed last — callers should treat the
 * result as best-effort.
 */
export async function waitForLiquidUsdc(opts: {
  walletAddress: string;
  atLeastSmallest: bigint;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<bigint> {
  const timeoutMs = opts.timeoutMs ?? 9_000;
  const intervalMs = opts.intervalMs ?? 1_200;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { smallest } = await getLiquidUsdc(opts.walletAddress);
    if (smallest >= opts.atLeastSmallest || Date.now() >= deadline) {
      return smallest;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export type CashStep = "checking" | "sending";

/**
 * Withdraw USDC to an external Solana address (gasless).
 *
 * The backend composes a single atomic transaction that transfers the USDC and
 * covers the network fee, priority fee, and any recipient token-account rent via
 * the integrator payer, so a 0-SOL wallet can withdraw.
 */
export async function withdrawUsdcToAddress(opts: {
  wallet: SigningWallet;
  destination: string;
  amountSmallest: bigint;
  onStep?: (step: CashStep) => void;
}): Promise<{ signature: string }> {
  const { wallet, destination, amountSmallest } = opts;

  opts.onStep?.("sending");
  const { transaction } = await createUsdcTransferTransaction({
    sender: wallet.address,
    recipient: destination,
    amount: amountSmallest.toString(),
  });
  const signature = await signAndSendBase64(wallet, transaction);
  return { signature };
}

/**
 * Settle prediction-market sell proceeds back into spendable cash.
 *
 * Closing a Jupiter prediction position pays out in JupUSD, which the rest of
 * the app does NOT treat as cash. This converts any JupUSD in the wallet to
 * USDC via Jupiter; the proceeds then simply sit as liquid cash.
 *
 * Fault tolerant by design: the close already settled on-chain before this
 * runs, so nothing here throws. A failed JupUSD→USDC swap leaves the JupUSD
 * untouched (retryable later) and is reported via `swapError`. Only call this
 * when a prediction leg was actually closed — it polls for the JupUSD payout,
 * which the balance indexer can lag a beat behind.
 */
export async function settleJupUsdToCash(opts: {
  wallet: SigningWallet;
  /** Don't bother converting dust below this many smallest units (~$0.01). */
  minSmallest?: bigint;
  timeoutMs?: number;
}): Promise<{ swappedJupUsd: bigint; swapError?: string }> {
  const { wallet } = opts;
  const minSmallest = opts.minSmallest ?? 10_000n; // ~$0.01

  // The close tx is confirmed, but our balance indexer can lag, so poll briefly
  // for the JupUSD payout to land before converting it.
  const deadline = Date.now() + (opts.timeoutMs ?? 9_000);
  let jupUsd = 0n;
  for (;;) {
    jupUsd = (await getMintBalanceSmallest(wallet.address, JUP_USD_MINT)).smallest;
    if (jupUsd >= minSmallest || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 1_200));
  }

  let swappedJupUsd = 0n;
  let swapError: string | undefined;

  if (jupUsd >= minSmallest) {
    try {
      const provider = await wallet.getProvider();
      const order = await createJupiterOrder({
        inputMint: JUP_USD_MINT,
        outputMint: SOLANA_USDC_MINT,
        amount: jupUsd.toString(),
        taker: wallet.address,
      });
      const transaction = deserializeTransaction(order.transaction);
      const signed = await provider.request({
        method: "signTransaction",
        params: { transaction },
      });
      const signedTransaction = serializeSignedTransaction(signed.signedTransaction);
      const execution = await executeJupiterOrder({
        signedTransaction,
        requestId: order.requestId,
        ...(order.lastValidBlockHeight
          ? { lastValidBlockHeight: order.lastValidBlockHeight }
          : {}),
      });

      if (
        execution.errorMessage ||
        (execution.status && execution.status !== "Success") ||
        (execution.code !== null && execution.code !== 0)
      ) {
        swapError =
          execution.errorMessage ??
          `JupUSD→USDC swap returned ${execution.status ?? execution.code}`;
      } else {
        swappedJupUsd = jupUsd;
      }
    } catch (error) {
      swapError = error instanceof Error ? error.message : "JupUSD conversion failed";
    }
  }

  return { swappedJupUsd, swapError };
}

/** Liquid balance of an arbitrary mint in the wallet, in smallest units. */
async function getMintBalanceSmallest(
  walletAddress: string,
  mint: string,
): Promise<{ smallest: bigint; decimals: number }> {
  const { tokens } = await getWalletBalances(walletAddress);
  const token = tokens.find((t) => t.mint === mint);
  const decimals = token?.decimals ?? 6;
  const balance = token?.balance ?? 0;
  const smallest = BigInt(toSmallestUnits(String(balance), decimals) ?? "0");
  return { smallest, decimals };
}
