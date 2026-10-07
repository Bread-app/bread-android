import { signAndSendBase64WithResult, type SigningWallet } from '@/lib/cash';
import { signTypedDataWithWallet, type EvmSigningWallet } from '@/lib/evm-sign';
import {
  HyperliquidApiError,
  buildHyperliquidDeposit,
  getHyperliquidAccount,
  openHyperliquidPosition,
  prepareHyperliquidWithdraw,
  submitHyperliquidWithdraw,
  waitForHyperliquidTransfer,
  type HyperliquidDepositBuild,
  type HyperliquidWithdrawPrepare,
  type OpenHyperliquidPositionInput,
  type OpenHyperliquidPositionResult,
} from '@/lib/hyperliquid-api';
import { ensureHyperliquidTradingSetup } from '@/lib/hyperliquid-trading-setup';

/** Mirrors the backend's reserve: taker fee + Bread's 0.1% builder fee, on notional. */
const FEE_RESERVE_RATE = 0.0011;
/** Covers Relay's few-cent fee so a top-up lands at least the shortfall. */
const TOP_UP_BUFFER_USD = 0.1;
const MIN_TOP_UP_USD = 1;
/** Hyperliquid's one-time account charge eats ~$1.20 of the first deposit. */
const MIN_FIRST_DEPOSIT_USD = 5;

export type DepositOutcome = { build: HyperliquidDepositBuild; delivered: 'success' | 'timeout' };

/**
 * Cash → Perps: one Solana signature (Bread pays the fee), then wait for Relay to
 * credit Hyperliquid. Throws if Relay reports the move failed — the USDC is then
 * refunded to cash, never lost.
 */
export async function depositToHyperliquid(solanaWallet: SigningWallet, amountUsd: string): Promise<DepositOutcome> {
  const build = await buildHyperliquidDeposit(amountUsd);
  await signAndSendBase64WithResult(solanaWallet, build.transaction, {
    lastValidBlockHeight: build.lastValidBlockHeight,
    fastConfirm: true,
    requireConfirmed: true,
  });
  const delivered = await waitForHyperliquidTransfer(build.requestId);
  if (delivered === 'failed') {
    throw new Error('Relay couldn’t deliver this move. Your USDC will be refunded to cash.');
  }
  return { build, delivered };
}

export type WithdrawOutcome = { prepared: HyperliquidWithdrawPrepare; delivered: 'success' | 'timeout' };

/**
 * Perps → Cash: two gasless signatures from the embedded EVM wallet (Relay's
 * nonce mapping, then the HyperCore transfer), then wait for Relay to pay out
 * on Solana. Throws if Relay reports failure — the funds are then refunded to
 * perps, never lost.
 */
export async function withdrawFromHyperliquid(evmWallet: EvmSigningWallet, amountUsd: string): Promise<WithdrawOutcome> {
  const prepared = await prepareHyperliquidWithdraw(amountUsd);
  // Relay's mapping first: it must be in place before the funds arrive.
  const authorizeSignature = await signTypedDataWithWallet(evmWallet, prepared.authorize.typedData);
  const sendAssetSignature = await signTypedDataWithWallet(evmWallet, prepared.sendAsset.typedData);
  await submitHyperliquidWithdraw({ prepared, authorizeSignature, sendAssetSignature });
  const delivered = await waitForHyperliquidTransfer(prepared.requestId);
  if (delivered === 'failed') {
    throw new Error('Relay couldn’t deliver this move. The funds will be refunded to perps.');
  }
  return { prepared, delivered };
}

export type HyperliquidTradeStep = 'topping-up' | 'setting-up' | 'placing';

export type HyperliquidTradeResult = OpenHyperliquidPositionResult & {
  /** Cash moved into perps to make the trade possible, if any. */
  toppedUpUsd: number;
};

/**
 * Open a Hyperliquid position the way a user thinks about it: "$20 long NVDA at
 * 5x", paid from cash if the perps balance is short. Whatever is missing is done
 * first, in order, with no extra screens:
 *
 * 1. **Top up** — move the shortfall from cash (the first move also opens the
 *    Hyperliquid account).
 * 2. **Set up** — the one-time silent approvals (unified balance, builder fee,
 *    trading key), which Hyperliquid only accepts once the account has funds.
 * 3. **Place** the order.
 *
 * Every step is idempotent, so a retry after any failure picks up where this left off.
 */
export async function openHyperliquidTrade(
  input: OpenHyperliquidPositionInput,
  wallets: { solana: SigningWallet; evm: EvmSigningWallet },
  onStep?: (step: HyperliquidTradeStep) => void,
): Promise<HyperliquidTradeResult> {
  let toppedUpUsd = 0;

  const topUp = async (shortfallUsd: number, firstDeposit: boolean) => {
    const amount = Math.max(
      Math.ceil((shortfallUsd + TOP_UP_BUFFER_USD) * 100) / 100,
      firstDeposit ? MIN_FIRST_DEPOSIT_USD : MIN_TOP_UP_USD,
    );
    onStep?.('topping-up');
    const { delivered } = await depositToHyperliquid(wallets.solana, amount.toFixed(2));
    if (delivered === 'timeout') {
      throw new Error('Your cash is on its way to perps — try the trade again in a moment.');
    }
    toppedUpUsd += amount;
  };

  // A trade needs: an account with enough free margin, then the approvals.
  // Checking the account first means a brand-new user is funded before setup,
  // which Hyperliquid requires.
  const { account } = await getHyperliquidAccount();
  const neededUsd = input.marginUsd * (1 + input.leverage * FEE_RESERVE_RATE);
  if (!account.exists || account.withdrawable < neededUsd) {
    await topUp(neededUsd - account.withdrawable, !account.exists);
  }

  onStep?.('setting-up');
  await ensureHyperliquidTradingSetup(wallets.evm);

  onStep?.('placing');
  try {
    return { ...(await openHyperliquidPosition(input)), toppedUpUsd };
  } catch (error) {
    // The balance moved between our read and the order (a fill, funding, a fee):
    // top up exactly what the server says is missing, once, and retry.
    if (error instanceof HyperliquidApiError && error.code === 'insufficient_margin') {
      const shortfall = Number(error.body.shortfallUsd);
      if (Number.isFinite(shortfall) && shortfall > 0) {
        await topUp(shortfall, false);
        onStep?.('placing');
        return { ...(await openHyperliquidPosition(input)), toppedUpUsd };
      }
    }
    throw error;
  }
}
