import type { ClosedPositionLifetime } from '@/lib/api';

export type LifetimePnlCopy = {
  label: string;
  value: string;
  pnlUsd: number;
};

function signedUsd(value: number): string {
  const absolute = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (Math.abs(value) < 0.005) return '$0.00';
  return `${value > 0 ? '+' : '−'}$${absolute}`;
}

/**
 * Copy shared by compact rows, sandwich cards, and the detail sheet.
 *
 * An incomplete aggregate is explicitly called "Known P&L" and states its
 * coverage. That lets the user see useful recovered history without presenting
 * missing closes as break-even trades.
 */
export function lifetimePnlCopy(
  lifetime: ClosedPositionLifetime | null | undefined,
): LifetimePnlCopy | null {
  if (!lifetime || lifetime.closeCount <= 1 || lifetime.realizedPnlUsd === null) return null;
  const closeWord = lifetime.closeCount === 1 ? 'close' : 'closes';
  return {
    label: lifetime.complete
      ? `All-time · ${lifetime.closeCount} ${closeWord}`
      : `Known P&L · ${lifetime.knownPnlCount}/${lifetime.closeCount} closes`,
    value: signedUsd(lifetime.realizedPnlUsd),
    pnlUsd: lifetime.realizedPnlUsd,
  };
}
