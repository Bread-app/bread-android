import { describe, expect, it } from 'vitest';

import { hasLivePerpSandwichExposure } from './perp-sandwich-visibility';

function position(
  status: string,
  collateral: { effective?: number | null; balance?: number | null } = {},
) {
  return {
    status,
    effectiveCollateralUsd: collateral.effective ?? null,
    collateralBalanceUsd: collateral.balance ?? null,
  };
}

describe('hasLivePerpSandwichExposure', () => {
  it('keeps an open position even when the live read gave nothing back', () => {
    expect(hasLivePerpSandwichExposure(position('open'))).toBe(true);
  });

  it('hides quote paperwork the user never signed', () => {
    for (const status of [
      'allocated',
      'building',
      'registered',
      'awaiting_signature',
      'registration_awaiting_signature',
      // The real case: a Sandwich stuck here since the sheet was dismissed,
      // showing as a $0.00 holding with no legs and no action.
      'setup_awaiting_signature',
    ]) {
      expect(hasLivePerpSandwichExposure(position(status))).toBe(false);
    }
  });

  it('hides settled exits', () => {
    for (const status of ['failed', 'withdrawn', 'stopped_out', 'liquidated']) {
      expect(hasLivePerpSandwichExposure(position(status))).toBe(false);
    }
  });

  it('keeps a closed position whose collateral is still parked at Phoenix', () => {
    expect(hasLivePerpSandwichExposure(position('closed', { effective: 41.2 }))).toBe(true);
    expect(hasLivePerpSandwichExposure(position('closed', { balance: 41.2 }))).toBe(true);
  });

  it('drops a closed position once only dust is left to withdraw', () => {
    expect(hasLivePerpSandwichExposure(position('closed', { effective: 0 }))).toBe(false);
    expect(hasLivePerpSandwichExposure(position('closed', { effective: 0.004 }))).toBe(false);
  });

  it('fails open on a closed position with an unreadable balance', () => {
    expect(hasLivePerpSandwichExposure(position('closed'))).toBe(true);
  });
});
