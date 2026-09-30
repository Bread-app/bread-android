/**
 * The demo backend.
 *
 * One function sits in front of `requestJson` and answers the routes a shoot
 * touches; everything else falls through to the real API untouched. Answers are
 * the raw JSON the server would send, so they go through the app's own
 * normalizers — a fixture that would have been rejected from a real server is
 * still rejected here.
 *
 * The money routes are the reason this exists at all: `/buy` answers with a run
 * that needs NO signatures, so a take never raises a wallet prompt and no
 * transaction can reach a chain, while every screen downstream behaves as if
 * the buy landed.
 */

import {
  DEMO_ANALYZE_EXTRACT_SHARE,
  DEMO_ANALYZE_MS,
  DEMO_FEED_PIN,
  isDemoMode,
} from './demo-config';
import { demoCandles } from './demo-candles';
import {
  DEMO_CALLS,
  DEMO_SOURCE_ID,
  demoCallBySandwichId,
  DEMO_POST_ID,
  demoFeedPostPayload,
  demoMomentPayload,
  demoSandwichId,
  demoSandwichPayload,
  demoSandwichPayloads,
} from './demo-data';
import {
  demoPortfolioHistory,
  demoPortfolioPositions,
  demoPrices,
  demoWalletBalances,
} from './demo-portfolio';

/** Returned when demo mode has nothing to say about a route. */
export const DEMO_PASSTHROUGH = Symbol('demo-passthrough');

export type DemoRequest = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  params?: Record<string, string>;
  body?: unknown;
};

/** When the current analysis started, so polling can walk the stage labels. */
let analyzeStartedAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function analyzeStatus(): 'extracting' | 'resolving' | 'ready' {
  const elapsed = Date.now() - analyzeStartedAt;
  if (elapsed >= DEMO_ANALYZE_MS) return 'ready';
  return elapsed < DEMO_ANALYZE_MS * DEMO_ANALYZE_EXTRACT_SHARE ? 'extracting' : 'resolving';
}

/** Native USDC units per leg, weighted, with the remainder given to the first leg. */
function splitAmount(amountUsdc: number, weights: number[]): string[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const native = Math.round(amountUsdc * 1_000_000);
  const parts = weights.map((weight) => Math.floor((native * weight) / total));
  const remainder = native - parts.reduce((sum, part) => sum + part, 0);
  if (parts.length > 0) parts[0] += remainder;
  return parts.map((part) => part.toString());
}

function quotePreviewRow(mint: string, amountNative: string, side: 'buy' | 'sell') {
  const spent = Number(amountNative) / 1_000_000;
  const price =
    demoCandles(mint, '1H').slice(-1)[0]?.c ?? 100;
  return {
    ok: true,
    side,
    mint,
    venue: 'metis',
    spent,
    expectedReceived: Number((spent / price).toFixed(6)),
    minReceived: Number(((spent / price) * 0.997).toFixed(6)),
    pricePerTokenUsd: price,
    slippageBps: 30,
    priceImpactPct: 0.04,
    maxSlippagePct: 0.3,
    firmQuote: false,
    unavailable: null,
    // Never closed: a shoot does not wait for the opening bell.
    marketOpen: true,
  };
}

/**
 * Answer a request, or hand it back. Async because a few answers are paced —
 * an instant "analysis" would look like a cache, not like work.
 */
export async function resolveDemoRequest(
  request: DemoRequest,
): Promise<unknown | typeof DEMO_PASSTHROUGH> {
  if (!isDemoMode()) return DEMO_PASSTHROUGH;

  const { method, path } = request;
  const params = request.params ?? {};
  const body = record(request.body);

  // ── Episode analysis ──────────────────────────────────────────────────────

  if (path === '/api/sandwich/sources' && method === 'POST') {
    analyzeStartedAt = Date.now();
    await sleep(600);
    const input = typeof body.input === 'string' ? body.input : 'https://youtu.be/demo';
    const { demoSourcePayload } = await import('./demo-data');
    return { source: demoSourcePayload('extracting', input) };
  }

  const sourceMatch = /^\/api\/sandwich\/sources\/([^/]+)(\/.*)?$/.exec(path);
  if (sourceMatch) {
    const tail = sourceMatch[2] ?? '';
    const { demoSourcePayload } = await import('./demo-data');
    const status = analyzeStatus();

    if (tail === '' && method === 'GET') {
      return { source: demoSourcePayload(status, 'https://youtu.be/demo') };
    }

    if (tail === '/moments' && method === 'GET') {
      return {
        source: demoSourcePayload('ready', 'https://youtu.be/demo'),
        moments: DEMO_CALLS.map(demoMomentPayload),
      };
    }

    if (tail === '/build-all' && method === 'POST') {
      // Builds are a persist pass over legs analysis already resolved, so this
      // is quick — but not instant, or the cards pop in before the feed settles.
      await sleep(900);
      return {
        sandwiches: DEMO_CALLS.filter((call) => !call.unroutedReason).map((call) => ({
          momentId: call.id,
          sandwich: demoSandwichPayload(call),
        })),
        failures: [],
      };
    }

    const buildOne = /^\/moments\/([^/]+)\/build$/.exec(tail);
    if (buildOne && method === 'POST') {
      const call = DEMO_CALLS.find((entry) => entry.id === buildOne[1]);
      if (call && !call.unroutedReason) {
        await sleep(500);
        return { sandwich: demoSandwichPayload(call) };
      }
    }
  }

  // ── Sandwiches ────────────────────────────────────────────────────────────

  if (path === '/api/sandwiches' && method === 'GET') {
    const sourceId = params.sourceId;
    if (sourceId && sourceId !== DEMO_SOURCE_ID) return { sandwiches: [] };
    return { sandwiches: demoSandwichPayloads() };
  }

  // The CARD's social routes. Demo mode is one episode, so every market shares
  // one post id and one set of counts — liking any of them likes the episode.
  const postMatch = /^\/api\/posts\/([^/]+)(\/.*)?$/.exec(path);
  if (postMatch) {
    if (decodeURIComponent(postMatch[1]) !== DEMO_POST_ID) return DEMO_PASSTHROUGH;
    const tail = postMatch[2] ?? '';

    if (tail === '/like') {
      const liked = method === 'POST';
      const [first] = demoSandwichPayloads();
      const baseline = first?.likeCount ?? 0;
      return {
        post: {
          id: DEMO_POST_ID,
          viewerHasLiked: liked,
          likeCount: baseline + (liked ? 1 : 0),
          commentCount: first?.commentCount ?? 0,
        },
      };
    }

    if (tail === '/comments' && method === 'GET') {
      return { comments: [], nextCursor: null, totalCount: 0 };
    }

    return DEMO_PASSTHROUGH;
  }

  const sandwichMatch = /^\/api\/sandwiches\/([^/]+)(\/.*)?$/.exec(path);
  if (sandwichMatch) {
    const sandwichId = decodeURIComponent(sandwichMatch[1]);
    const tail = sandwichMatch[2] ?? '';
    const call = demoCallBySandwichId(sandwichId);
    if (!call) return DEMO_PASSTHROUGH;

    if (tail === '' && method === 'GET') {
      return { sandwich: demoSandwichPayload(call) };
    }

    // `/like` and `/comments` moved to /api/posts — see the post handler below.

    // The buy. Nothing to sign, so the tap never reaches the wallet — and
    // nothing exists that could reach a chain.
    if (tail === '/buy' && method === 'POST') {
      const amountUsdc = Number(body.amountUsdc ?? 0);
      const amounts = splitAmount(amountUsdc, call.legs.map((leg) => leg.weightBps));
      await sleep(700);
      return {
        status: 'needs_signature',
        basketRunId: `demo-run-${Date.now()}`,
        transactions: [],
        legs: call.legs.map((leg, index) => ({
          legId: `${leg.asset.mint}-leg`,
          symbol: leg.asset.symbol,
          mint: leg.asset.mint,
          amountUsdc: amounts[index],
          weightBps: leg.weightBps,
          decimals: 8,
          route: 'rpc',
        })),
        slippage: {
          worstCaseSlippagePct: 0.3,
          maxPriceImpactPct: 0.04,
          legs: call.legs.map((leg) => ({
            legId: `${leg.asset.mint}-leg`,
            symbol: leg.asset.symbol,
            slippagePct: 0.3,
            priceImpactPct: 0.04,
          })),
        },
        atomic: true,
      };
    }

    if (tail === '/sell' && method === 'POST') {
      await sleep(700);
      return {
        status: 'needs_signature',
        basketRunId: `demo-run-${Date.now()}`,
        transactions: [],
        legs: call.legs.map((leg) => ({
          legId: `${leg.asset.mint}-leg`,
          symbol: leg.asset.symbol,
          mint: leg.asset.mint,
          amountUsdc: '0',
          weightBps: leg.weightBps,
          route: 'rpc',
        })),
        action: 'sell',
        atomic: true,
      };
    }
  }

  const runMatch = /^\/api\/basket-runs\/([^/]+)\/submit$/.exec(path);
  if (runMatch && method === 'POST') {
    await sleep(1100);
    return {
      status: 'confirmed',
      basketRunId: decodeURIComponent(runMatch[1]),
      bundleId: 'demo-bundle',
      signatures: ['demo-signature'],
    };
  }

  // ── Trading surface ───────────────────────────────────────────────────────

  if (path === '/api/trade/quote-preview' && method === 'POST') {
    const side = body.side === 'sell' ? 'sell' : 'buy';
    if (Array.isArray(body.legs)) {
      return {
        legs: body.legs.map((raw) => {
          const leg = record(raw);
          return quotePreviewRow(String(leg.mint ?? ''), String(leg.amount ?? '0'), side);
        }),
      };
    }
    return quotePreviewRow(String(body.mint ?? ''), String(body.amount ?? '0'), side);
  }

  if (path === '/api/trade/preflight') {
    return { ok: true, tradable: true, reason: null, marketOpen: true };
  }

  // ── Wallet, prices, charts ────────────────────────────────────────────────

  if (path === '/api/solana/wallet-balances') {
    return demoWalletBalances(params.owner ?? '');
  }

  // The demo SOL is a holding, not swap rent: without this the headline would
  // drop it (see `solTraded` in lib/holdings.ts) and miss the figure it is
  // tuned to. The ledger stays empty — the side holdings show 24h change.
  if (/^\/api\/helius\/wallet\/[^/]+\/cost-basis$/.test(path)) {
    return { ledger: {}, solTraded: true };
  }

  if (path === '/api/jupiter/prices') {
    const raw = params.mints ?? (typeof body.mints === 'string' ? body.mints : '');
    const mints = Array.isArray(body.mints)
      ? body.mints.map(String)
      : raw.split(',').map((mint) => mint.trim()).filter(Boolean);
    return demoPrices(mints);
  }

  if (path === '/api/tokens/ohlcv') {
    const timeFrom = params.time_from ? Number(params.time_from) : undefined;
    return {
      success: true,
      data: { items: demoCandles(params.address ?? '', params.type ?? '1H', timeFrom) },
    };
  }

  // ── Profile ───────────────────────────────────────────────────────────────

  const portfolioMatch = /^\/api\/users\/([^/]+)\/portfolio(\/history)?$/.exec(path);
  if (portfolioMatch && method === 'GET') {
    if (portfolioMatch[2]) {
      return demoPortfolioHistory('', params.range ?? '7d');
    }
    return { positions: demoPortfolioPositions() };
  }

  // Perps and prediction markets are not part of any demo shot; answering them
  // empty keeps their panels quiet rather than showing a network error.
  if (path === '/api/perp-sandwich-positions') return { positions: [] };
  if (path.startsWith('/api/notifications')) {
    return { notifications: [], nextCursor: null, unreadCount: 0, updated: 0 };
  }

  return DEMO_PASSTHROUGH;
}

/**
 * Second pass, on the REAL server's answer, for the one route demo mode wants
 * to add to rather than replace: the home feed. The feed stays whatever the
 * server is serving; the hero card is put in front of it (DEMO_FEED_PIN).
 *
 * Only the first page — a cursor means the user is already scrolling, and the
 * card is not on page three. The real request has already succeeded by the
 * time this runs, so a dead feed is still a dead feed rather than a lone card.
 */
export function decorateDemoResponse(request: DemoRequest, payload: unknown): unknown {
  if (!isDemoMode() || !DEMO_FEED_PIN) return payload;

  if (request.path === '/api/posts' && request.method === 'GET' && !request.params?.cursor) {
    const body = record(payload);
    const posts = Array.isArray(body.posts) ? body.posts : [];
    // A refetch after a like must not stack a second copy.
    const rest = posts.filter((post) => record(post).id !== DEMO_POST_ID);
    return { ...body, posts: [demoFeedPostPayload(), ...rest] };
  }

  return payload;
}

export { demoSandwichId, DEMO_SOURCE_ID };
