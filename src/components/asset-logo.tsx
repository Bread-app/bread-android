import { Image } from 'expo-image';
import React from 'react';
import { View, type ImageStyle, type StyleProp } from 'react-native';
import { SvgXml } from 'react-native-svg';

/**
 * Renders a token/stock logo that may be a raster image (PNG/JPG/WebP) OR an
 * SVG. React Native's <Image> can't render SVG, so tokens.xyz SVG logos used to
 * be dropped and shown as a letter avatar, even though the tokens.xyz web
 * dashboard renders them fine. This component bridges that gap.
 *
 * Rendering strategy (handles logos that can't be classified by file extension):
 *   1. `.svg` URL            → render as SVG directly.
 *   2. any other https URL   → try <Image> first (most logos are raster); if it
 *      fails to load, RETRY the SAME url as SVG. This is essential for
 *      extensionless issuer endpoints like Backpack Securities'
 *      `https://backpack.exchange/api/stock-logo/{SYMBOL}`, which serve
 *      `image/svg+xml` with no `.svg` suffix — <Image> can't render the SVG
 *      bytes, but the SVG renderer can.
 *   3. still failing / null / non-https → `fallback` (letter avatar).
 *
 * So the worst case is exactly the previous letter-avatar behavior, never a
 * blank circle.
 *
 * PERFORMANCE — this component renders at ~50 call sites (every leg row, every
 * holding, every card), so it is on the hot path of every list in the app:
 *
 *   • Raster logos use `expo-image` with `cachePolicy="memory-disk"`. React
 *     Native's own <Image> has no such cache, so as feed cells recycled the
 *     same handful of logos were refetched and re-decoded on every mount.
 *   • `recyclingKey` tells expo-image the view is being reused for a different
 *     URL, so a recycled row never flashes the previous row's logo.
 *   • SVG markup is fetched ONCE per URL into `svgCache` and then rendered from
 *     memory. The previous `SvgCssUri` refetched and reparsed the XML on the JS
 *     thread on every single mount — mid-scroll.
 *   • Style objects are memoized rather than rebuilt inline each render.
 *
 * Security: the SVG XML is rendered with react-native-svg's NATIVE parser (not
 * a WebView) — it does not execute <script>, so remote SVGs carry no more
 * script-execution risk than the remote PNGs <Image> already loads. We
 * additionally require an https URL.
 */
type AssetLogoProps = {
  uri: string | null | undefined;
  /** Tried in order when `uri` is missing or fails to load. */
  fallbackUris?: readonly (string | null | undefined)[];
  size: number;
  /** Defaults to a circle (size / 2). */
  borderRadius?: number;
  backgroundColor?: string;
  /** Shown when the URL is missing/unusable or fails to load. */
  fallback: React.ReactNode;
  /**
   * Recolours a raster logo to a single flat colour, using the image's own
   * alpha channel as the mask — every opaque pixel becomes this colour
   * regardless of its original hue.
   *
   * Only affects raster candidates. An SVG candidate cannot be tinted this
   * way — its colours are baked into the markup, not carried in an alpha
   * mask — so when `tintColor` is set, any candidate that resolves to SVG is
   * skipped in favour of the next one, and `fallback` is used if every
   * remaining candidate is SVG too. This keeps the guarantee strict: with
   * `tintColor` set, nothing renders in its original colours.
   */
  tintColor?: string;
  /**
   * Border drawn around the logo, matching `<Image>`'s box model: the border is
   * INSET, so `size` stays the outer dimension and the artwork shrinks to fit.
   * Needed by the overlapping leg stacks, whose ring against the card
   * background is what separates one leg from the next.
   */
  borderWidth?: number;
  borderColor?: string;
  /**
   * Gaussian blur on a raster candidate, for decorative depth-of-field (the
   * success screen's burst). Ignored by the SVG renderer, which has no
   * equivalent — a blurred-in-theory SVG still draws sharp rather than not at
   * all, which is the only outcome that matters here.
   */
  blurRadius?: number;
};

function isSvgUrl(url: string): boolean {
  return /\.svg(\?.*)?$/i.test(url);
}

function isHttps(url: string): boolean {
  return /^https:\/\//i.test(url);
}

/**
 * Process-wide cache of fetched SVG markup, keyed by URL.
 *
 * `null` means "fetched and failed" — cached just as deliberately as a success,
 * so a broken logo is not re-requested by every row that scrolls past it. A URL
 * mid-flight is held in `svgInFlight` so N simultaneous rows share one request.
 */
const svgCache = new Map<string, string | null>();
const svgInFlight = new Map<string, Promise<string | null>>();

function loadSvg(url: string): Promise<string | null> {
  const cached = svgInFlight.get(url);
  if (cached) return cached;
  const request = fetch(url)
    .then((response) => (response.ok ? response.text() : null))
    // A raster body reaching the SVG path (or an HTML error page) must be
    // treated as a failure, not handed to the parser as markup.
    .then((text) => (text && /<svg[\s>]/i.test(text) ? text : null))
    .catch(() => null)
    .then((result) => {
      svgCache.set(url, result);
      svgInFlight.delete(url);
      return result;
    });
  svgInFlight.set(url, request);
  return request;
}

/** Renders cached SVG markup, fetching it once per URL. */
function CachedSvg({
  uri,
  width,
  height,
  onError,
}: {
  uri: string;
  width: number;
  height: number;
  onError: () => void;
}) {
  const [xml, setXml] = React.useState<string | null>(() => svgCache.get(uri) ?? null);

  React.useEffect(() => {
    if (svgCache.has(uri)) {
      const hit = svgCache.get(uri) ?? null;
      setXml(hit);
      if (hit === null) onError();
      return;
    }
    let active = true;
    void loadSvg(uri).then((result) => {
      if (!active) return;
      setXml(result);
      if (result === null) onError();
    });
    return () => {
      active = false;
    };
    // `onError` is a fresh closure each render; re-running on it would refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  if (!xml) return null;
  return <SvgXml xml={xml} width={width} height={height} />;
}

// 'image' = try raster first; 'svg' = render/retry as SVG; 'failed' = give up.
type RenderMode = 'image' | 'svg' | 'failed';

function initialModeFor(candidate: string | undefined): RenderMode {
  return candidate && isSvgUrl(candidate) ? 'svg' : 'image';
}

function AssetLogoImpl({
  uri,
  fallbackUris = [],
  size,
  borderRadius,
  backgroundColor,
  fallback,
  tintColor,
  borderWidth,
  borderColor,
  blurRadius,
}: AssetLogoProps) {
  const candidateKey = [uri, ...fallbackUris]
    .filter((candidate): candidate is string => Boolean(candidate && isHttps(candidate)))
    .filter((candidate, index, candidates) => candidates.indexOf(candidate) === index)
    .join('\n');
  const candidates = React.useMemo(
    () => (candidateKey ? candidateKey.split('\n') : []),
    [candidateKey],
  );
  const [candidateIndex, setCandidateIndex] = React.useState(0);
  const [mode, setMode] = React.useState<RenderMode>(() => initialModeFor(candidates[0]));

  // Reset the state machine whenever any candidate URL changes.
  React.useEffect(() => {
    setCandidateIndex(0);
    setMode(initialModeFor(candidates[0]));
  }, [candidates]);

  const currentUri = candidates[candidateIndex];
  const advanceCandidate = React.useCallback(() => {
    setCandidateIndex((index) => {
      const nextUri = candidates[index + 1];
      if (!nextUri) {
        setMode('failed');
        return index;
      }
      setMode(initialModeFor(nextUri));
      return index + 1;
    });
  }, [candidates]);

  const radius = borderRadius ?? size / 2;

  // Hoisted out of the render body: these used to be fresh objects on every
  // render, which meant a new style prop for every row on every parent update.
  const imageStyle = React.useMemo<StyleProp<ImageStyle>>(
    () => ({
      width: size,
      height: size,
      borderRadius: radius,
      backgroundColor,
      borderWidth,
      borderColor,
    }),
    [size, radius, backgroundColor, borderWidth, borderColor],
  );
  const svgFrameStyle = React.useMemo(
    () => ({
      width: size,
      height: size,
      borderRadius: radius,
      overflow: 'hidden' as const,
      backgroundColor,
      borderWidth,
      borderColor,
    }),
    [size, radius, backgroundColor, borderWidth, borderColor],
  );

  // An SVG's colours are baked into its markup, so `tintColor` cannot recolour
  // one — treat it the same as a load failure and move to the next candidate.
  // Keyed on `candidateIndex` (not just `mode`) so two SVG candidates in a row
  // both get skipped instead of the effect going stale on a repeated 'svg'.
  const skipSvgForTint = tintColor !== undefined && mode === 'svg';
  React.useEffect(() => {
    if (skipSvgForTint) advanceCandidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipSvgForTint, candidateIndex]);

  if (!currentUri || mode === 'failed' || skipSvgForTint) return <>{fallback}</>;

  if (mode === 'svg') {
    // Clip the SVG to the avatar's rounded frame. `CachedSvg` renders null while
    // loading and calls onError on fetch/parse failure → next candidate, then
    // the letter fallback.
    const inset = borderWidth ?? 0;
    return (
      <View style={svgFrameStyle}>
        <CachedSvg
          uri={currentUri}
          width={size - inset * 2}
          height={size - inset * 2}
          onError={advanceCandidate}
        />
      </View>
    );
  }

  return (
    <Image
      source={{ uri: currentUri }}
      style={imageStyle}
      tintColor={tintColor}
      blurRadius={blurRadius && blurRadius > 0 ? blurRadius : undefined}
      // Logos are small, static and repeat constantly across every list in the
      // app — exactly what the disk cache is for.
      cachePolicy="memory-disk"
      // A recycled row must not show the previous row's logo while the new one
      // decodes.
      recyclingKey={currentUri}
      // A cross-fade on a 22pt logo reads as a flicker in a scrolling list.
      transition={0}
      contentFit="cover"
      // <Image> can't decode SVG bytes (e.g. extensionless issuer logo
      // endpoints) → retry the same URL as an SVG before giving up.
      onError={() => setMode('svg')}
    />
  );
}

/**
 * Memoised because it renders once per leg, per row, per card. Note that a
 * caller passing a freshly-constructed `fallback={<View>…}` element defeats
 * this — the caching above is the bulk of the win regardless.
 */
export const AssetLogo = React.memo(AssetLogoImpl);

// Re-exported for callers that only need the URL classification.
export const assetLogoIsSvg = isSvgUrl;
