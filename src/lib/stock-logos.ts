/**
 * Independent equity-logo fallback for symbol-keyed perp positions.
 *
 * Phoenix trader-position payloads do not repeat market metadata, and older
 * account responses may therefore omit the joined logo — so a position known
 * only by its ticker still needs somewhere to get a picture.
 *
 * tokens.xyz is that somewhere, and the only one. This used to try Backpack's
 * issuer endpoint first, which returns the TOKEN's art rather than the
 * company's — the same substitution the backend's icon picker used to make.
 * Asset icons come from tokens.xyz or they fall through to the letter avatar.
 */
export function equityLogoUri(symbol: string): string | null {
  const ticker = symbol.trim().toUpperCase().replace(/X$/, '');
  if (!/^[A-Z0-9.-]{1,12}$/.test(ticker)) return null;
  return `https://www.tokens.xyz/logos/xstocks/${encodeURIComponent(ticker)}x.png`;
}

/** The same URL, as the array form `AssetLogo`'s `fallbackUris` takes. */
export function equityLogoFallbackUris(symbol: string): string[] {
  const uri = equityLogoUri(symbol);
  return uri ? [uri] : [];
}

/**
 * Ticker-keyed crypto logos, best first. tokens.xyz's currency logos exist for
 * only a handful of coins (XRP yes, BTC/SOL/NEAR 404), so CoinCap's icon set —
 * which has every major ticker — follows it. Nothing for a ticker neither CDN
 * could key.
 */
function cryptoLogoUris(ticker: string): string[] {
  const t = ticker.trim().toLowerCase();
  if (!/^[a-z0-9]{1,12}$/.test(t)) return [];
  return [
    `https://api.tokens.xyz/logos/currencies/${encodeURIComponent(t)}.png`,
    `https://assets.coincap.io/assets/icons/${encodeURIComponent(t)}@2x.png`,
  ];
}

/**
 * Artwork for a Phoenix perp, best source first.
 *
 * A perp is a bet on an asset the app already draws elsewhere, so it should
 * wear that asset's tokens.xyz face rather than the venue's own mark. Four
 * sources, in order, none of which costs a request of its own:
 *
 *  1. `iconUri` — the tokens.xyz artwork the backend joined onto the market
 *     (see `lib/server/phoenix/icons.ts`). Present for every equity and for
 *     crypto that exists in the curated universe.
 *  2. The spot icon the caller already has on screen, when it has one.
 *  3. The deterministic URLs: the xstocks wrapper for equities; for crypto,
 *     tokens.xyz `logos/currencies/<symbol>` (only a few coins — XRP) and then
 *     CoinCap's ticker icons, which cover the rest (BTC, SOL, NEAR, HYPE…).
 *  4. Phoenix's own `logoUri` — last, because it is the venue's mark rather than
 *     the asset's, and an SVG that `<Image>` can only reach through
 *     `AssetLogo`'s failed-load retry (and not at all on a bare `<Image>`).
 *
 * `AssetLogo` walks the list and stops at the first that loads, so a miss costs
 * a failed image request, never a blank row: the letter avatar is the floor.
 */
export function perpLogoSources(
  market: {
    symbol: string;
    category?: string | null;
    iconUri?: string | null;
    logoUri?: string | null;
  },
  spotIcon?: string | null,
): { uri: string | null; fallbackUris: (string | null)[] } {
  const isCrypto = market.category === 'crypto';
  const ticker = market.symbol.trim().toUpperCase();
  const derived = isCrypto ? cryptoLogoUris(ticker) : [equityLogoUri(market.symbol)];

  const sources = [market.iconUri ?? null, spotIcon ?? null, ...derived, market.logoUri ?? null];
  const [uri, ...fallbackUris] = sources.filter((source, index) =>
    // Keep the first non-null as `uri`; drop later duplicates of it.
    source ? sources.indexOf(source) === index : false,
  );

  return { uri: uri ?? null, fallbackUris };
}

/**
 * Artwork for a perp known only by its ticker, with no asset class attached.
 *
 * Settled positions are that case: `PhoenixCloseRecord` stores a symbol and a
 * side, never a category, so `perpLogoSources` — which reads `category` and
 * treats anything missing as an equity — sends every closed crypto perp to the
 * xstocks CDN and lands on the letter tile.
 *
 * So try both patterns, equity first: it is the conservative default everywhere
 * else a category is absent, and the majority of what Bread trades. `AssetLogo`
 * walks the chain and stops at the first that loads, so the wrong guess costs a
 * failed image request rather than a blank row.
 */
export function symbolLogoSources(symbol: string): {
  uri: string | null;
  fallbackUris: (string | null)[];
} {
  const ticker = symbol.trim().toUpperCase();
  if (!ticker) return { uri: null, fallbackUris: [] };
  const equity = equityLogoUri(ticker);
  const [uri, ...fallbackUris] = [equity, ...cryptoLogoUris(ticker)].filter(
    (source): source is string => Boolean(source),
  );
  return { uri: uri ?? null, fallbackUris };
}
