import { type CostBasisEntry, type CostBasisLedger } from '@/lib/cost-basis';
import { type HeliusTransferRecord } from '@/lib/api';

/** Solana mainnet USDC mint */
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/**
 * Derives a weighted-average cost basis ledger from Helius on-chain transfer history.
 * Processes swaps chronologically, tracking buys (USDC → token) and sells (token → USDC).
 * tokenAmount in Helius Enhanced TX API is already human-readable (divided by decimals).
 */
export function deriveOnchainCostBasis(
  walletAddress: string,
  transfers: HeliusTransferRecord[],
): CostBasisLedger {
  const wallet = walletAddress.trim().toLowerCase();

  // Oldest first so we build up average cost in chronological order
  const sorted = [...transfers]
    .filter((tx) => !tx.transactionError && (tx.tokenTransfers?.length ?? 0) > 0)
    .sort((a, b) => a.timestamp - b.timestamp);

  const ledger: CostBasisLedger = {};

  for (const tx of sorted) {
    const tokenTransfers = tx.tokenTransfers ?? [];

    const received = tokenTransfers.filter(
      (t) => t.toUserAccount.toLowerCase() === wallet && t.tokenAmount > 0,
    );
    const sent = tokenTransfers.filter(
      (t) => t.fromUserAccount.toLowerCase() === wallet && t.tokenAmount > 0,
    );

    const usdcSent = sent.find((t) => t.mint === USDC_MINT);
    const usdcReceived = received.find((t) => t.mint === USDC_MINT);
    const stockReceived = received.filter((t) => t.mint !== USDC_MINT);
    const stockSent = sent.filter((t) => t.mint !== USDC_MINT);

    // BUY: wallet paid USDC and received stock token(s)
    if (usdcSent && stockReceived.length > 0) {
      const usdcSpent = usdcSent.tokenAmount;
      // If multiple output tokens, split cost proportionally by USD value (approximated equally)
      const costPerToken = usdcSpent / stockReceived.length;
      for (const r of stockReceived) {
        const prev = ledger[r.mint];
        const prevQty = prev?.qty ?? 0;
        const prevCostTotal = (prev?.avgPriceUsd ?? 0) * prevQty;
        const nextQty = prevQty + r.tokenAmount;
        const nextCostTotal = prevCostTotal + costPerToken;
        ledger[r.mint] = {
          mint: r.mint,
          qty: nextQty,
          avgPriceUsd: nextQty > 0 ? nextCostTotal / nextQty : 0,
          realizedPnlUsd: prev?.realizedPnlUsd ?? 0,
          updatedAt: new Date(tx.timestamp * 1000).toISOString(),
        };
      }
    }

    // SELL: wallet sent stock token(s) and received USDC
    if (usdcReceived && stockSent.length > 0) {
      const totalUsdcReceived = usdcReceived.tokenAmount;
      const totalStockSentQty = stockSent.reduce((s, t) => s + t.tokenAmount, 0);
      for (const s of stockSent) {
        const prev = ledger[s.mint];
        if (!prev || prev.qty <= 0) continue;
        const soldQty = Math.min(s.tokenAmount, prev.qty);
        const costSold = prev.avgPriceUsd * soldQty;
        // Distribute received USDC proportionally to this token's share
        const usdcForThis =
          totalStockSentQty > 0
            ? totalUsdcReceived * (s.tokenAmount / totalStockSentQty)
            : totalUsdcReceived;
        const realized = usdcForThis - costSold;
        const nextQty = Math.max(0, prev.qty - soldQty);
        ledger[s.mint] = {
          mint: s.mint,
          qty: nextQty,
          avgPriceUsd: nextQty > 0 ? prev.avgPriceUsd : 0,
          realizedPnlUsd: prev.realizedPnlUsd + realized,
          updatedAt: new Date(tx.timestamp * 1000).toISOString(),
        };
      }
    }
  }

  return ledger;
}

/**
 * Merges on-chain and local cost basis ledgers.
 * On-chain is authoritative when it has an entry; local fills gaps for recent
 * in-app trades not yet indexed by Helius.
 */
export function mergeCostBasisLedgers(
  onchain: CostBasisLedger,
  local: CostBasisLedger,
): CostBasisLedger {
  const merged: CostBasisLedger = { ...onchain };
  for (const [mint, localEntry] of Object.entries(local)) {
    if (!merged[mint]) {
      merged[mint] = localEntry;
    }
  }
  return merged;
}

export type { CostBasisEntry, CostBasisLedger };
