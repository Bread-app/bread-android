/**
 * Symbol arithmetic shared by spot wrappers and Phoenix markets.
 *
 * Deliberately dependency-free — `phoenix-api` reaches SecureStore and the auth
 * layer at module scope, and these two functions are needed by pure logic (and
 * its tests) that must not drag any of that in. `phoenix-api` re-exports them,
 * so call sites can keep importing from either place.
 */

/** The market shape this module needs: a symbol, and (optionally) its venue category. */
type SymbolCarrier = { symbol: string; category?: string | null };

/**
 * Which Phoenix category a spot asset may be expressed as.
 *
 * Phoenix reuses equity tickers for crypto listings — `MET` is Meteora (not
 * MetLife), `LIT` is Lighter (not the lithium ETF), and `CHIP`/`MEGA`/`VVV`
 * likewise — so matching on the symbol string alone would wire a MetLife thesis
 * into a memecoin perp. Every spot→perp lookup therefore has to agree on the
 * asset class first.
 */
export type PhoenixAssetKind = 'equity' | 'crypto';

/** tokens.xyz asset classes that live on Phoenix's crypto board. */
const CRYPTO_ASSET_CATEGORIES = new Set(['crypto', 'stablecoin', 'memecoin', 'token']);

/**
 * The Phoenix category a tokens.xyz asset class maps to.
 *
 * Anything unknown — including a missing category — resolves to `equity`, which
 * is the conservative answer: it is what every caller assumed before crypto
 * perps existed, and a wrong `crypto` guess is the direction that collides.
 */
export function phoenixKindForAssetCategory(category?: string | null): PhoenixAssetKind {
  const normalized = category?.trim().toLowerCase() ?? '';
  return CRYPTO_ASSET_CATEGORIES.has(normalized) ? 'crypto' : 'equity';
}

/** The kind a Phoenix market trades as. Commodities are not tradable here. */
function marketKind(market: SymbolCarrier): PhoenixAssetKind | 'commodity' {
  if (market.category === 'crypto') return 'crypto';
  if (market.category === 'commodity') return 'commodity';
  // Absent category means a partially-hydrated market (tests, previews); equity
  // is the historical default.
  return 'equity';
}

/**
 * Canonical underlying ticker shared by spot wrappers and Phoenix markets.
 * Tokenized equities commonly arrive as `AAPLx`/`AAPLon`; Phoenix keys the
 * matching perp by the underlying (`AAPL`).
 */
export function normalizePhoenixAssetSymbol(symbol: string): string {
  let normalized = symbol.trim().toUpperCase();
  normalized = normalized.replace(/(?:[-_/.:]?PERP(?:ETUAL)?)$/, '');
  if (normalized.endsWith('ON') && normalized.length > 4) {
    normalized = normalized.slice(0, -2);
  }
  if (normalized.endsWith('X') && normalized.length > 4) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * The spot asset a perp lookup is made for. A bare ticker is accepted for
 * callers that only have one (a Sandwich leg), and is treated as an equity.
 */
export type PhoenixAssetRef = { symbol: string; name?: string | null; category?: string | null };

/** Lowercased alphanumerics — `NEAR Protocol` and `near protocol` are one name. */
function nameKey(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Do two names describe the same thing? Containment, not equality, so
 * `Sui` still matches `Sui Network`.
 */
function namesAgree(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = nameKey(a);
  const right = nameKey(b);
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left);
}

/**
 * Does this Phoenix market back that spot asset?
 *
 * Passing a bare ticker means "equity", so every pre-crypto call site keeps its
 * exact previous behaviour: a Sandwich leg, which carries a ticker and no asset
 * class, can never match a crypto perp.
 *
 * The two classes match on different rules, because their failure modes differ:
 *
 * - **Equities** match on the normalized underlying. The spot side is a wrapper
 *   (`AAPLx`, `AAPLon`) of a security whose ticker is globally unique, so
 *   stripping the wrapper suffix is both necessary and safe.
 *
 * - **Crypto** matches on the exact ticker *and* an agreeing name. Tickers are
 *   not unique across crypto: tokens.xyz lists `CHIP` as USD.AI while Phoenix's
 *   `CHIP` is an unrelated token, and pairing them would put one asset's chart
 *   above the other's perp. No wrapper stripping either — the `X`/`ON` rule is
 *   an equity-wrapper rule and would invent matches here.
 */
export function phoenixMarketMatchesAsset(
  market: SymbolCarrier & { name?: string | null },
  asset: string | PhoenixAssetRef,
): boolean {
  const ref: PhoenixAssetRef = typeof asset === 'string' ? { symbol: asset } : asset;
  const kind = phoenixKindForAssetCategory(ref.category);
  if (marketKind(market) !== kind) return false;

  if (kind === 'crypto') {
    if (market.symbol.trim().toUpperCase() !== ref.symbol.trim().toUpperCase()) return false;
    // Phoenix falls back to the symbol when it publishes no name (SUI, XRP), so
    // a nameless market still agrees with a spot asset called after its ticker,
    // and still rejects one that is not (CHIP).
    return namesAgree(market.name ?? market.symbol, ref.name ?? ref.symbol);
  }

  return normalizePhoenixAssetSymbol(market.symbol) === normalizePhoenixAssetSymbol(ref.symbol);
}

/** The Phoenix market backing a spot asset, or null. See {@link phoenixMarketMatchesAsset}. */
export function findPhoenixMarketForAsset<T extends SymbolCarrier & { name?: string | null }>(
  markets: readonly T[],
  asset: PhoenixAssetRef | null | undefined,
): T | null {
  if (!asset?.symbol) return null;
  return markets.find((market) => phoenixMarketMatchesAsset(market, asset)) ?? null;
}

/**
 * The markets of one asset class that no spot asset in `spotAssets` backs —
 * the Phoenix half of a spot ∪ perp list.
 *
 * tokens.xyz and Phoenix list different universes: DOGE, XRP, LINK, SPY and
 * QQQ trade as perps with no spot row at all, so a list built from tokens.xyz
 * alone hides them. Matching uses {@link phoenixMarketMatchesAsset}, so a perp
 * whose spot twin IS listed stays out (it is reached through that row's
 * spot/perp toggle) and a ticker collision (`CHIP`) is kept as its own market.
 */
export function phoenixOnlyMarkets<T extends SymbolCarrier & { name?: string | null }>(
  markets: readonly T[],
  spotAssets: readonly PhoenixAssetRef[],
  kind: PhoenixAssetKind,
): T[] {
  return markets.filter(
    (market) =>
      marketKind(market) === kind &&
      !spotAssets.some((asset) => phoenixMarketMatchesAsset(market, asset)),
  );
}
