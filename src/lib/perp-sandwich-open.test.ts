import { describe, expect, it, vi } from 'vitest';

import {
  entryQuoteAfterRegistration,
  freshPerpQuote,
  PERP_QUOTE_MAX_AGE_MS,
} from './perp-sandwich-open';

describe('freshPerpQuote', () => {
  it('reuses only a matching, recent transaction', () => {
    const entry = { key: '100|2|10', quote: { id: 'quote' }, receivedAtMs: 1_000 };

    expect(freshPerpQuote(entry, '100|2|10', 1_000 + PERP_QUOTE_MAX_AGE_MS - 1)).toEqual({
      id: 'quote',
    });
    expect(freshPerpQuote(entry, '99|2|10', 1_001)).toBeNull();
    expect(freshPerpQuote(entry, '100|2|10', 1_000 + PERP_QUOTE_MAX_AGE_MS)).toBeNull();
  });
});

describe('entryQuoteAfterRegistration', () => {
  it('signs setup once and waits for an entry quote', async () => {
    const setup = { id: 'setup', preview: { setupRequired: true } };
    const entry = { id: 'entry', preview: { marginUsd: 100 } };
    const signAndSubmit = vi.fn(async () => undefined);
    const requestFreshQuote = vi
      .fn<() => Promise<typeof setup | typeof entry>>()
      .mockResolvedValueOnce(setup)
      .mockResolvedValueOnce(entry);
    const beforeRetry = vi.fn();

    await expect(
      entryQuoteAfterRegistration({
        initialQuote: setup,
        signAndSubmit,
        requestFreshQuote,
        beforeRetry,
        retryDelaysMs: [0, 0],
        sleep: async () => undefined,
      }),
    ).resolves.toBe(entry);

    expect(signAndSubmit).toHaveBeenCalledTimes(1);
    expect(requestFreshQuote).toHaveBeenCalledTimes(2);
    expect(beforeRetry).toHaveBeenCalledTimes(2);
  });

  it('does not register an already-ready account', async () => {
    const entry = { id: 'entry', preview: { marginUsd: 100 } };
    const signAndSubmit = vi.fn(async () => undefined);
    const requestFreshQuote = vi.fn(async () => entry);

    await expect(
      entryQuoteAfterRegistration({ initialQuote: entry, signAndSubmit, requestFreshQuote }),
    ).resolves.toBe(entry);
    expect(signAndSubmit).not.toHaveBeenCalled();
    expect(requestFreshQuote).not.toHaveBeenCalled();
  });
});
