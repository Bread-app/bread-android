/**
 * The fixtures are only useful if the app ACCEPTS them, and the app rejects a
 * malformed payload silently — a sandwich that fails `normalizeSandwich` simply
 * disappears from the feed. So these tests drive the real public API functions
 * with demo mode on and assert on what comes back out of the normalizers, which
 * is the same path a take runs. A shoot should never be the thing that discovers
 * a missing field.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

process.env.EXPO_PUBLIC_DEMO_MODE = '1';

// SecureStore is a native module; the demo wallet only reads it to find an
// existing position, and "none stored" is a state it already handles.
vi.mock('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));

type Api = typeof import('../api');
let api: Api;

beforeAll(async () => {
  api = await import('../api');
});

describe('demo episode', () => {
  it('reports moments once the scripted analysis finishes', async () => {
    const source = await api.createPodcastSource('https://youtu.be/demo');
    expect(source.id).toBeTruthy();
    expect(source.status).toBe('extracting');

    const { moments } = await api.getPodcastMoments(source.id);
    expect(moments).toHaveLength(4);
    expect(moments.filter((m) => m.routeStatus === 'routed')).toHaveLength(3);
    // The declined call keeps its reason and gains no buy CTA.
    const declined = moments.find((m) => m.routeStatus === 'unrouted');
    expect(declined?.unroutedReason).toBeTruthy();
    expect(declined?.legs).toHaveLength(0);
  });

  it('builds every routed moment into a sandwich the app can parse', async () => {
    const { sandwiches, failures } = await api.buildAllMomentSandwiches('demo-source-episode-1');
    expect(failures).toHaveLength(0);
    expect(sandwiches).toHaveLength(3);
    for (const entry of sandwiches) {
      expect(entry.sandwich.legs.length).toBeGreaterThan(0);
      expect(entry.sandwich.pnlPct).not.toBeNull();
    }
  });

  it('serves the hero sandwich at the scripted return', async () => {
    const [hero] = await api.getSandwichesBySource('demo-source-episode-1');
    expect(hero).toBeTruthy();
    expect(hero.pnlPct).toBeCloseTo(18.33, 1);
    expect(hero.legs).toHaveLength(3);
    expect(hero.legs.reduce((sum, leg) => sum + leg.weightBps, 0)).toBe(10000);

    const byId = await api.getSandwichById(hero.id);
    expect(byId?.id).toBe(hero.id);
  });

  it('carries the mixed venue: a perp short and two spot longs', async () => {
    const [hero] = await api.getSandwichesBySource('demo-source-episode-1');
    // The SANDWICH stays spot so the buy runs the spot pad; only the leg is perp.
    expect(hero.venue).toBe('spot');
    const legs = [...hero.legs].sort((a, b) => a.order - b.order);
    expect(legs.map((leg) => [leg.symbol, leg.venue, leg.side])).toEqual([
      ['TAO', 'perp', 'short'],
      ['VVV', 'spot', 'long'],
      ['CHIP', 'spot', 'long'],
    ]);
    // The rows report the figures in the mock: a 3x short on a −4.13% move,
    // and the two spot legs as their own moves.
    expect(legs.map((leg) => leg.pnlPct)).toEqual([12.39, 38.8, -16.69]);
    expect(legs.map((leg) => leg.currentPriceUsd)).toEqual([234.21, 23.62, 0.0452]);
    // Cited post and builder byline, both real accounts.
    expect(hero.source.sourceType).toBe('x_post');
    expect(hero.source.authorHandle).toBe('@zeroxkyle');
    expect(hero.builder?.username).toBe('vzy');
    // Every leg still has something the spot buy plan can route.
    const plan = api.buildSandwichBuyPlan(hero, '100000000');
    expect(plan.executableLegs).toHaveLength(3);
    expect(plan.skippedLegs).toHaveLength(0);
  });
});

describe('demo perp short', () => {
  it('is an already-open Phoenix short at the leg\'s leverage', async () => {
    const phoenix = await import('../phoenix-api');
    const { account } = await phoenix.getPhoenixAccount();
    expect(account.registered).toBe(true);
    const [position] = account.cross?.positions ?? [];
    expect(position).toBeTruthy();
    expect(position.symbol).toBe('TAO');
    expect(position.leverage).toBe(3);
    expect(position.positionSize).toBeLessThan(0);
    // A quarter of the seeded $150, at 3x, on a −4.13% move: the short is up.
    expect(position.marginUsd).toBeCloseTo(37.5, 2);
    expect(position.unrealizedPnl).toBeGreaterThan(0);
    // Collateral counts toward the headline, so it must be margin + PnL.
    expect(account.cross?.portfolioValue).toBeCloseTo(
      (position.marginUsd ?? 0) + position.unrealizedPnl,
      2,
    );
  });
});

describe('demo feed pin', () => {
  it('puts the hero card in front of whatever the server sent', async () => {
    // The real feed: stub the fetch with a server answer and let the second
    // demo pass decorate it, exactly as it would on the phone.
    const realPost = {
      id: 'real-post-1',
      kind: 'thesis',
      createdAt: new Date().toISOString(),
      likeCount: 0,
      commentCount: 0,
      viewerHasLiked: false,
      sandwiches: [],
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ posts: [realPost], nextCursor: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    try {
      const { posts } = await api.getPostPage(40, null, null, 'anon-demo');
      expect(fetchSpy).toHaveBeenCalled();
      expect(posts[0]?.id).toBe('demo-post-episode-1');
      expect(posts[0]?.sandwiches).toHaveLength(1);
      // Sourced from X, so the feed draws a plain Sandwich card, not an episode.
      expect(posts[0]?.sandwiches[0]?.source.sourceType).toBe('x_post');
      expect(posts[0]?.sandwiches[0]?.legs.some((leg) => leg.venue === 'perp')).toBe(true);
      // The detail route serves the same source, so tapping through agrees.
      const detail = await api.getSandwichById(posts[0]!.sandwiches[0]!.id);
      expect(detail?.source.sourceType).toBe('x_post');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('demo buy', () => {
  it('needs no signature and confirms', async () => {
    const [hero] = await api.getSandwichesBySource('demo-source-episode-1');
    const started = await api.startSandwichBasketBuy(hero.id, 120);
    expect(started.status).toBe('needs_signature');
    if (started.status !== 'needs_signature') return;

    // The whole point: nothing to sign, so no wallet prompt and no chain.
    expect(started.transactions).toHaveLength(0);
    const spent = started.legs.reduce((sum, leg) => sum + Number(leg.amountUsdc), 0);
    expect(spent).toBe(120_000_000);

    const result = await api.submitSignedBasketBuy(started.basketRunId, []);
    expect(result.status).toBe('confirmed');
  });
});

describe('demo wallet', () => {
  it('prices the held legs at exactly the scripted return', async () => {
    const { tokens } = await api.getWalletBalances('DemoWallet1111111111111111111111111111111111');
    const cash = tokens.find((token) => token.symbol === 'USDC');
    // Cash is whatever makes the headline land on the cent.
    const { DEMO_PORTFOLIO_VALUE_USD } = await import('./demo-config');
    const { demoPhoenixAccount } = await import('./demo-portfolio');
    const holdingsUsd = tokens.reduce((sum, token) => sum + (token.usdValue ?? 0), 0);
    const phoenixUsd = demoPhoenixAccount().account.cross?.portfolioValue ?? 0;
    expect(cash?.usdValue).toBeGreaterThan(0);
    expect(holdingsUsd + phoenixUsd).toBeCloseTo(DEMO_PORTFOLIO_VALUE_USD, 1);

    const positions = (await import('./demo-portfolio')).demoPortfolioPositions();
    const invested = positions[0].investedUsd ?? 0;
    const legMints = new Set(positions[0].legs.map((leg) => leg.mint));
    const legValue = tokens
      .filter((token) => token.mint && legMints.has(token.mint))
      .reduce((sum, token) => sum + (token.usdValue ?? 0), 0);

    expect(((legValue - invested) / invested) * 100).toBeCloseTo(18.33, 1);
  });
});

describe('demo charts', () => {
  it('walks from the entry price to the current one, deterministically', async () => {
    const { DEMO_ASSETS } = await import('./demo-data');
    const vvv = DEMO_ASSETS.VVV;
    const first = await api.getBirdeyeOhlcv(vvv.mint, '1D');
    expect(first.items.length).toBeGreaterThan(10);
    expect(first.items[0].open).toBeCloseTo(vvv.entryPriceUsd, 1);
    expect(first.items[first.items.length - 1].close).toBeCloseTo(vvv.currentPriceUsd, 1);

    // Not a straight line: a chart that never wiggles reads as a mock on camera.
    const closes = first.items.map((item) => item.close);
    const monotonic = closes.every((close, i) => i === 0 || close >= closes[i - 1]);
    expect(monotonic).toBe(false);
  });
});
