import { describe, expect, it } from 'vitest';

import { describeTradeUnavailable } from '@/lib/api';
import { ONDO_TRADE_UNAVAILABLE_MESSAGE } from '@/lib/market-hours';

/**
 * Turning a raw venue refusal into copy.
 *
 * The rule these pin: naming the RFQ venue is not the same as knowing its
 * market is shut. Ondo runs 24/5, so a 3 AM Friday miss is a maker gap — and
 * telling that user to come back at the bell handed them a window they were
 * already inside.
 */
describe('describeTradeUnavailable', () => {
  it('gives the 24/5 window when the venue itself blames the clock', () => {
    expect(
      describeTradeUnavailable(
        'Ondo tokens are only available via JupiterZ. Trading is not available outside of market hours.',
      ),
    ).toBe(ONDO_TRADE_UNAVAILABLE_MESSAGE);
  });

  it('does not claim a schedule for a diagnostic that merely names the RFQ route', () => {
    const copy = describeTradeUnavailable(
      'Atomic timestamp basket unavailable: FIGx: RFQ-only route',
    );
    expect(copy).not.toBe(ONDO_TRADE_UNAVAILABLE_MESSAGE);
    expect(copy).not.toMatch(/8 PM|24\/5/);
  });

  it('does not inherit a schedule from a mint that happens to end in "ondo"', () => {
    const copy = describeTradeUnavailable(
      '14diAn5z8kjrKwSC8WLqvBqqe5YmihJhjxRxd8Z6ondo: quoted price failed the execution guard',
    );
    expect(copy).not.toBe(ONDO_TRADE_UNAVAILABLE_MESSAGE);
  });

  it('still improves a higher-minimum refusal', () => {
    expect(describeTradeUnavailable('There is a minimum trade size of $1.')).toMatch(/minimum/i);
  });

  it('leaves a reason it cannot improve alone', () => {
    expect(describeTradeUnavailable('Something else entirely')).toBeNull();
  });
});
