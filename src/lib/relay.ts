import { getRelayDepositStatus, getWalletDeposits } from '@/lib/api';

/**
 * Cross-chain "Add cash" via Relay deposit addresses. The user sends USDC on a
 * supported EVM chain to a generated deposit address; Relay bridges it to USDC
 * on their Solana wallet, where it lands as spendable cash.
 *
 * Same-chain Solana deposits are handled by the plain QR step in the deposit
 * sheet, so Relay only covers the *other* chains here.
 */
export type RelaySourceChain = {
  /** Relay chain id. */
  id: number;
  name: string;
  /** USDC token address on this chain (the source currency we bridge from). */
  usdcAddress: string;
  /** Decimals of USDC on this chain — 6 on most chains, but 18 on BNB Chain. */
  usdcDecimals: number;
  /** Short label for QR / instructions. */
  shortName: string;
  /** Brand color used as the badge background behind the logo. */
  color: string;
  /** Official chain logo (Relay CDN). */
  logoUrl: string;
};

/** Relay serves official chain icons keyed by chain id. */
function relayChainLogo(id: number): string {
  return `https://assets.relay.link/icons/${id}/light.png`;
}

// Addresses, ids and decimals are sourced from Relay's chains API
// (https://api.relay.link/chains); note BNB Chain's USDC uses 18 decimals.
export const RELAY_SOURCE_CHAINS: RelaySourceChain[] = [
  { id: 8453, name: 'Base', shortName: 'Base', color: '#0052FF', usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', usdcDecimals: 6, logoUrl: relayChainLogo(8453) },
  { id: 1, name: 'Ethereum', shortName: 'Ethereum', color: '#627EEA', usdcAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', usdcDecimals: 6, logoUrl: relayChainLogo(1) },
  { id: 143, name: 'Monad', shortName: 'Monad', color: '#836EF9', usdcAddress: '0x754704bc059f8c67012fed69bc8a327a5aafb603', usdcDecimals: 6, logoUrl: relayChainLogo(143) },
  { id: 56, name: 'BNB Chain', shortName: 'BNB', color: '#F0B90B', usdcAddress: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', usdcDecimals: 18, logoUrl: relayChainLogo(56) },
];

export type RelayDepositStatus =
  | 'waiting'
  | 'depositing'
  | 'pending'
  | 'submitted'
  | 'delayed'
  | 'success'
  | 'refund'
  | 'failure'
  | 'unknown';

/**
 * Poll Relay until the deposit reaches a terminal state. Resolves with the
 * final status. Best-effort: returns the last seen status when the deadline
 * passes (the deposit may still complete later).
 */
export async function pollRelayDeposit(opts: {
  /** The generated deposit address — Relay keys the request by it. */
  depositAddress: string;
  onStatus?: (status: RelayDepositStatus) => void;
  timeoutMs?: number;
  intervalMs?: number;
  signal?: { cancelled: boolean };
}): Promise<RelayDepositStatus> {
  // Bridges can take a few minutes end-to-end (source confirmations + fill), so
  // keep watching for a while before giving up.
  const timeoutMs = opts.timeoutMs ?? 15 * 60_000;
  const intervalMs = opts.intervalMs ?? 4_000;
  const deadline = Date.now() + timeoutMs;

  let last: RelayDepositStatus = 'waiting';
  for (;;) {
    if (opts.signal?.cancelled) return last;
    const { status } = await getRelayDepositStatus(opts.depositAddress).catch(() => ({ status: last }));
    last = status as RelayDepositStatus;
    opts.onStatus?.(last);
    if (last === 'success' || last === 'refund' || last === 'failure') return last;
    if (Date.now() >= deadline) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * Poll the backend (fed by Privy's `wallet.funds_deposited` webhook) until a
 * *new* deposit lands in `walletAddress` — the authoritative "USDC is actually
 * in your Solana wallet" signal for a cross-chain deposit.
 *
 * `knownIds` are the deposit ids already present when waiting began, so a
 * deposit that landed earlier (from a prior session) doesn't false-trigger.
 * Resolves true on arrival, false on timeout/cancel. Best-effort: pairs with
 * Relay's own status so the flow still completes if webhooks aren't configured.
 */
export async function pollWalletDepositLanded(opts: {
  walletAddress: string;
  /** Deposit ids seen before this wait started; a new id means fresh funds. */
  knownIds: Set<string>;
  onFound?: (deposit: { amount: string }) => void;
  timeoutMs?: number;
  intervalMs?: number;
  signal?: { cancelled: boolean };
}): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 15 * 60_000;
  const intervalMs = opts.intervalMs ?? 3_000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (opts.signal?.cancelled) return false;
    const deposits = await getWalletDeposits(opts.walletAddress).catch(() => []);
    const fresh = deposits.find((deposit) => !opts.knownIds.has(deposit.id));
    if (fresh) {
      opts.onFound?.({ amount: fresh.amount });
      return true;
    }
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
