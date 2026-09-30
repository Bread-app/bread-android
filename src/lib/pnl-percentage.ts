/** Return on the capital attached to a position, expressed in percentage points. */
export function pnlPercentageFromBasis(
  pnlUsd: number | null | undefined,
  basisUsd: number | null | undefined,
): number | null {
  if (
    typeof pnlUsd !== 'number' ||
    !Number.isFinite(pnlUsd) ||
    typeof basisUsd !== 'number' ||
    !Number.isFinite(basisUsd) ||
    basisUsd <= 0
  ) {
    return null;
  }
  return (pnlUsd / basisUsd) * 100;
}

/** Compact direction-first label used by every open-position row. */
export function formatPnlPercentage(pct: number | null | undefined): string | null {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null;
  if (Math.abs(pct) < 0.005) return '0.00%';
  return `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(2)}%`;
}

/** Same figure with a sign instead of an arrow — for pills, where the arrow glyph reads as a chevron. */
export function formatSignedPnlPercentage(pct: number | null | undefined): string | null {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null;
  if (Math.abs(pct) < 0.005) return '0.00%';
  return `${pct > 0 ? '+' : '-'}${Math.abs(pct).toFixed(2)}%`;
}
