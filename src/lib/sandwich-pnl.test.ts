import { describe, expect, it } from 'vitest';

import type { Sandwich, SandwichPnlBasis } from '@/lib/api';
import { bestMarketReturn, episodeReturn } from '@/lib/sandwich-pnl';

function market(pnlPct: number | null, pnlBasis: SandwichPnlBasis = 'spot'): Sandwich {
  return { pnlPct, pnlBasis } as unknown as Sandwich;
}

describe('episodeReturn', () => {
  it('averages the calls equally', () => {
    // Equal weight is right across independent calls: `totalWeightBps` only
    // means something INSIDE a basket.
    const result = episodeReturn([market(10), market(20), market(30)]);

    expect(result.pnlPct).toBeCloseTo(20, 6);
    expect(result).toMatchObject({ counted: 3, total: 3, mixedBasis: false });
  });

  it('reports how much of the episode the figure actually covers', () => {
    // The bug this replaces: a priced-out market just shrank the denominator,
    // so an episode of three whose shorts had no price silently reported its one
    // long as "the episode".
    const result = episodeReturn([market(10), market(null), market(null)]);

    expect(result.pnlPct).toBeCloseTo(10, 6);
    expect(result).toMatchObject({ counted: 1, total: 3 });
  });

  it('flags an episode blending spot with unlevered perp estimates', () => {
    const result = episodeReturn([market(10), market(-4, 'underlying_move')]);

    expect(result.mixedBasis).toBe(true);
  });

  it('does not count an unpriced perp toward the basis flag', () => {
    // `mixedBasis` describes the figure, so a market that contributed nothing
    // to it must not label it.
    const result = episodeReturn([market(10), market(null, 'underlying_move')]);

    expect(result.mixedBasis).toBe(false);
  });

  it('returns null rather than 0 when nothing priced', () => {
    const result = episodeReturn([market(null), market(null)]);

    expect(result.pnlPct).toBeNull();
    expect(result).toMatchObject({ counted: 0, total: 2 });
  });

  it('handles an empty episode', () => {
    expect(episodeReturn([])).toEqual({ pnlPct: null, counted: 0, total: 0, mixedBasis: false });
  });
});

function call(id: string, pnlPct: number | null): Sandwich {
  return { id, pnlPct, pnlBasis: 'spot' } as unknown as Sandwich;
}

describe('bestMarketReturn', () => {
  it('reports the episode\'s strongest call, not its mean', () => {
    // The whole point: an episode where one call ran away used to average out
    // to nothing and read as a card where nothing happened.
    const result = bestMarketReturn([call('a', 2), call('b', 80), call('c', -6)]);

    expect(result.pnlPct).toBeCloseTo(80, 6);
    expect(result.sandwich?.id).toBe('b');
    expect(result).toMatchObject({ counted: 3, total: 3 });
  });

  it('skips unpriced markets but still counts them in the total', () => {
    const result = bestMarketReturn([call('a', null), call('b', 5), call('c', null)]);

    expect(result.sandwich?.id).toBe('b');
    expect(result).toMatchObject({ counted: 1, total: 3 });
  });

  it('keeps the first of equal returns so a tie does not shuffle between renders', () => {
    const result = bestMarketReturn([call('a', 12), call('b', 12)]);

    expect(result.sandwich?.id).toBe('a');
  });

  it('reports the least-bad call when nothing is up', () => {
    // Never invents a green number: the card shows the top of the episode even
    // when the top is a loss.
    const result = bestMarketReturn([call('a', -20), call('b', -3)]);

    expect(result.pnlPct).toBeCloseTo(-3, 6);
    expect(result.sandwich?.id).toBe('b');
  });

  it('returns null with no market when nothing is priced', () => {
    const result = bestMarketReturn([call('a', null), call('b', null)]);

    expect(result).toEqual({ pnlPct: null, sandwich: null, counted: 0, total: 2 });
  });

  it('handles an empty episode', () => {
    expect(bestMarketReturn([])).toEqual({ pnlPct: null, sandwich: null, counted: 0, total: 0 });
  });
});
