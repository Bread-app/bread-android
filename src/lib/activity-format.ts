/**
 * Formatting shared by every surface that lists wallet activity — the full
 * Activity screen and the per-asset history drawer on the stock page.
 *
 * These live here rather than beside either caller so a row reads identically
 * wherever it appears: the same trade shown in two places must not disagree
 * about its own amount or age.
 */

const USDC_MAINNET_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export function formatTokenAmount(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: value >= 1 ? 4 : 6,
  }).format(value);
}

export function formatTransactionAsset(asset: string): string {
  if (asset === USDC_MAINNET_MINT) return 'USDC';
  if (asset === 'native') return 'SOL';
  if (asset.length > 10) return `${asset.slice(0, 4)}…${asset.slice(-4)}`;
  return asset;
}

/** Trade rows are settled in USDC, whose raw amounts carry 6 decimals. */
export function formatUsdcDisplay(rawAmount: string): string {
  const value = Number(rawAmount) / 1e6;
  if (!Number.isFinite(value)) return '$0.00';
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatTransactionAmount(asset: string, rawAmount: string): string {
  const decimals = asset === 'native' ? 9 : 6;
  const raw = Number(rawAmount);
  if (!Number.isFinite(raw)) return '0';
  return formatTokenAmount(raw / 10 ** decimals);
}

/**
 * Relative for the first week, then an absolute date. The year is only shown
 * once it stops being the current one, so recent rows stay short.
 */
export function formatTransactionDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSeconds < 60) return 'Just now';
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  const now = new Date();
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}
