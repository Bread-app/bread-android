import * as SecureStore from 'expo-secure-store';

const STORAGE_PREFIX = 'cost_basis_v1';
const SECURE_STORE_KEY_RE = /[^A-Za-z0-9._-]/g;

export type CostBasisEntry = {
  mint: string;
  qty: number;
  avgPriceUsd: number;
  realizedPnlUsd: number;
  updatedAt: string;
  /**
   * Server-ledger split: the part of `qty` bought as the asset itself rather
   * than as a Sandwich leg, and its own average. Absent on local entries and on
   * responses from a server that predates the split — see
   * `lib/standalone-holding.ts` for how each case is read.
   */
  standaloneQty?: number;
  standaloneAvgPriceUsd?: number;
};

export type CostBasisLedger = Record<string, CostBasisEntry>;

function storageKey(walletAddress: string) {
  const walletKey = walletAddress.trim().replace(SECURE_STORE_KEY_RE, '_');
  return `${STORAGE_PREFIX}.${walletKey || 'unknown'}`;
}

export async function loadCostBasisLedger(walletAddress: string): Promise<CostBasisLedger> {
  try {
    const raw = await SecureStore.getItemAsync(storageKey(walletAddress));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as CostBasisLedger;
  } catch {
    return {};
  }
}

async function saveLedger(walletAddress: string, ledger: CostBasisLedger): Promise<void> {
  try {
    await SecureStore.setItemAsync(storageKey(walletAddress), JSON.stringify(ledger));
  } catch {
    // best-effort
  }
}

export async function recordBuy(
  walletAddress: string,
  mint: string,
  qtyAcquired: number,
  usdSpent: number,
): Promise<CostBasisLedger> {
  if (!walletAddress || !mint || !Number.isFinite(qtyAcquired) || qtyAcquired <= 0) {
    return loadCostBasisLedger(walletAddress);
  }
  const ledger = await loadCostBasisLedger(walletAddress);
  const prev = ledger[mint];
  const prevQty = prev?.qty ?? 0;
  const prevCost = (prev?.avgPriceUsd ?? 0) * prevQty;
  const nextQty = prevQty + qtyAcquired;
  const nextCost = prevCost + Math.max(0, usdSpent);
  const avgPriceUsd = nextQty > 0 ? nextCost / nextQty : 0;
  ledger[mint] = {
    mint,
    qty: nextQty,
    avgPriceUsd,
    realizedPnlUsd: prev?.realizedPnlUsd ?? 0,
    updatedAt: new Date().toISOString(),
  };
  await saveLedger(walletAddress, ledger);
  return ledger;
}

export async function recordSell(
  walletAddress: string,
  mint: string,
  qtySold: number,
  usdReceived: number,
): Promise<CostBasisLedger> {
  if (!walletAddress || !mint || !Number.isFinite(qtySold) || qtySold <= 0) {
    return loadCostBasisLedger(walletAddress);
  }
  const ledger = await loadCostBasisLedger(walletAddress);
  const prev = ledger[mint];
  if (!prev) {
    return ledger;
  }
  const soldQty = Math.min(qtySold, prev.qty);
  const costSold = prev.avgPriceUsd * soldQty;
  const realized = Math.max(0, usdReceived) - costSold;
  const nextQty = Math.max(0, prev.qty - soldQty);
  ledger[mint] = {
    mint,
    qty: nextQty,
    avgPriceUsd: nextQty > 0 ? prev.avgPriceUsd : 0,
    realizedPnlUsd: prev.realizedPnlUsd + realized,
    updatedAt: new Date().toISOString(),
  };
  await saveLedger(walletAddress, ledger);
  return ledger;
}

export function computeUnrealizedPnl(
  entry: CostBasisEntry | undefined,
  currentBalance: number,
  currentPriceUsd: number | null,
): { pnlUsd: number; pnlPct: number; costUsd: number } | null {
  if (!entry || entry.qty <= 0 || !Number.isFinite(currentBalance) || currentBalance <= 0) return null;
  if (currentPriceUsd === null || !Number.isFinite(currentPriceUsd) || currentPriceUsd <= 0) return null;
  const qty = Math.min(entry.qty, currentBalance);
  const costUsd = entry.avgPriceUsd * qty;
  const marketUsd = currentPriceUsd * qty;
  const pnlUsd = marketUsd - costUsd;
  const pnlPct = costUsd > 0 ? (pnlUsd / costUsd) * 100 : 0;
  return { pnlUsd, pnlPct, costUsd };
}
