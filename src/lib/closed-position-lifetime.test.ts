import { describe, expect, it } from 'vitest';

import { lifetimePnlCopy } from './closed-position-lifetime';

describe('lifetimePnlCopy', () => {
  it('labels a complete repeated-position total', () => {
    expect(lifetimePnlCopy({
      closeCount: 2,
      knownPnlCount: 2,
      latestCloseId: 'second',
      complete: true,
      costUsd: 200,
      proceedsUsd: 215,
      realizedPnlUsd: 15,
      realizedPnlPct: 0.075,
    })).toEqual({ label: 'All-time · 2 closes', value: '+$15.00', pnlUsd: 15 });
  });

  it('does not disguise missing closes as zero', () => {
    expect(lifetimePnlCopy({
      closeCount: 3,
      knownPnlCount: 2,
      latestCloseId: 'third',
      complete: false,
      costUsd: null,
      proceedsUsd: null,
      realizedPnlUsd: -4.5,
      realizedPnlPct: null,
    })).toEqual({ label: 'Known P&L · 2/3 closes', value: '−$4.50', pnlUsd: -4.5 });
  });

  it('keeps a single close focused on its own result', () => {
    expect(lifetimePnlCopy({
      closeCount: 1,
      knownPnlCount: 1,
      latestCloseId: 'only',
      complete: true,
      costUsd: 100,
      proceedsUsd: 110,
      realizedPnlUsd: 10,
      realizedPnlPct: 0.1,
    })).toBeNull();
  });
});
