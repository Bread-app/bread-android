import { describe, expect, it } from 'vitest';

import { formatPnlPercentage, pnlPercentageFromBasis } from './pnl-percentage';

describe('open-position PnL percentage', () => {
  it('calculates return on the supplied cost or margin basis', () => {
    expect(pnlPercentageFromBasis(25, 100)).toBe(25);
    expect(pnlPercentageFromBasis(-12.5, 50)).toBe(-25);
  });

  it('does not invent a percentage without a usable basis', () => {
    expect(pnlPercentageFromBasis(5, null)).toBeNull();
    expect(pnlPercentageFromBasis(5, 0)).toBeNull();
    expect(pnlPercentageFromBasis(Number.NaN, 100)).toBeNull();
  });

  it('formats gains and losses with directional arrows', () => {
    expect(formatPnlPercentage(8.234)).toBe('▲ 8.23%');
    expect(formatPnlPercentage(-32.5)).toBe('▼ 32.50%');
    expect(formatPnlPercentage(0)).toBe('0.00%');
    expect(formatPnlPercentage(null)).toBeNull();
  });
});
