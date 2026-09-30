import { describe, expect, it } from 'vitest';

import { perpLogoSources, symbolLogoSources } from './stock-logos';

const XSTOCK_AAPL = 'https://www.tokens.xyz/logos/xstocks/AAPLx.png';

describe('perpLogoSources', () => {
  it('prefers the tokens.xyz icon joined onto the market', () => {
    const sources = perpLogoSources({
      symbol: 'SOL',
      category: 'crypto',
      iconUri: 'https://api.tokens.xyz/logos/popular/solana.png',
      logoUri: 'https://phoenixcdn.trade/logos/SOL/abc.svg',
    });

    expect(sources.uri).toBe('https://api.tokens.xyz/logos/popular/solana.png');
    // Phoenix's own SVG stays last — RN's Image cannot render it.
    expect(sources.fallbackUris.at(-1)).toBe('https://phoenixcdn.trade/logos/SOL/abc.svg');
  });

  it('falls back to the spot icon the caller already has', () => {
    const sources = perpLogoSources(
      { symbol: 'JUP', category: 'crypto', iconUri: null, logoUri: 'https://phoenix/jup.svg' },
      'https://arweave.net/jup.png',
    );

    expect(sources.uri).toBe('https://arweave.net/jup.png');
  });

  it('derives the wrapper logo for an equity with no join', () => {
    expect(perpLogoSources({ symbol: 'AAPL', category: 'equity' }).uri).toBe(XSTOCK_AAPL);
  });

  it('treats a position with no category as an equity, as it always was', () => {
    expect(perpLogoSources({ symbol: 'AAPL' }).uri).toBe(XSTOCK_AAPL);
  });

  it('never repeats a source, so the chain cannot retry a URL that just failed', () => {
    const icon = 'https://arweave.net/sol.png';
    const sources = perpLogoSources({ symbol: 'SOL', category: 'crypto', iconUri: icon }, icon);

    expect(sources.uri).toBe(icon);
    expect(sources.fallbackUris).not.toContain(icon);
  });

  it('degrades to the placeholder rather than inventing a URL', () => {
    // A symbol the equity CDN pattern rejects, with nothing joined on.
    const sources = perpLogoSources({ symbol: '', category: 'equity' });
    expect(sources.uri).toBeNull();
    expect(sources.fallbackUris.filter(Boolean)).toEqual([]);
  });
});

describe('symbolLogoSources', () => {
  it('tries the equity CDN first for a bare ticker', () => {
    const sources = symbolLogoSources('AAPL');
    expect(sources.uri).toBe(XSTOCK_AAPL);
  });

  it('keeps the crypto CDN as a fallback, so a closed BTC perp still draws', () => {
    // A settled perp carries no category, so both patterns have to be offered:
    // the xstocks URL 404s for BTC and AssetLogo walks on to the next one.
    const sources = symbolLogoSources('BTC');
    expect(sources.fallbackUris).toContain('https://api.tokens.xyz/logos/currencies/btc.png');
  });

  it('falls through to CoinCap for coins tokens.xyz has no currency logo for', () => {
    // tokens.xyz 404s BTC/SOL/NEAR; CoinCap keys every major ticker.
    const sources = symbolLogoSources('NEAR');
    expect(sources.fallbackUris).toContain('https://assets.coincap.io/assets/icons/near@2x.png');
  });

  it('invents nothing for a symbol neither CDN can key', () => {
    const sources = symbolLogoSources('  ');
    expect(sources.uri).toBeNull();
    expect(sources.fallbackUris).toEqual([]);
  });
});
