/**
 * The wallet demo mode reports: cash, a couple of loose holdings, and the legs
 * of whatever demo Sandwich the device is holding.
 *
 * The leg balances are DERIVED from the position's own cost basis rather than
 * fixed, which is what makes the profile shot survive an improvised take: buy
 * $50 or buy $500 on camera and the holding still comes back at exactly
 * DEMO_HERO_RETURN_PCT, because the quantity is computed as
 * `invested x (1 + target) / price`. Every figure downstream — the leg rows, the
 * basket header, the portfolio total — is then the app's own arithmetic over
 * these balances, not another fixture that could drift out of agreement.
 */

import {
  DEMO_HERO_RETURN_PCT,
  DEMO_LEG_DAY_CHANGE_PCT,
  DEMO_PORTFOLIO_CHANGE_PCT,
  DEMO_PORTFOLIO_VALUE_USD,
  DEMO_SEEDED_INVESTED_USD,
  DEMO_SIDE_HOLDINGS,
} from './demo-config';
import {
  DEMO_ASSET_BY_MINT,
  DEMO_HERO_CALL,
  DEMO_SANDWICH_CREATED_AT_MS,
  SOL_MINT,
  USDC_MINT,
  demoLogoUri,
  demoSandwichId,
} from './demo-data';
import type { PhoenixAccountResponse, PhoenixPosition } from '../phoenix-api';
import { getStoredSandwichPositions } from '../sandwich-positions';

const GROWTH = 1 + DEMO_HERO_RETURN_PCT / 100;

function sideMint(symbol: string): string {
  if (symbol === 'SOL') return SOL_MINT;
  return `Demo${symbol}`.padEnd(44, '2');
}

/** The hero position as the backend would report it, for a device with no local history. */
export function demoPortfolioPositions() {
  const call = DEMO_HERO_CALL;
  const totalWeight = call.legs.reduce((sum, leg) => sum + leg.weightBps, 0) || 10000;
  return [
    {
      id: demoSandwichId(call),
      sandwichId: demoSandwichId(call),
      name: call.headline,
      summary: call.summary,
      investedUsd: DEMO_SEEDED_INVESTED_USD,
      updatedAt: new Date(Date.now() - DEMO_SANDWICH_CREATED_AT_MS).toISOString(),
      legs: call.legs.map((leg) => {
        const investedUsd = (DEMO_SEEDED_INVESTED_USD * leg.weightBps) / totalWeight;
        return {
          legId: `${leg.asset.mint}-leg`,
          mint: leg.asset.mint,
          symbol: leg.asset.symbol,
          label: leg.asset.name,
          imageUrl: leg.asset.imageUrl,
          weightBps: leg.weightBps,
          inputAmount: Math.round(investedUsd * 1_000_000).toString(),
          investedUsd: Number(investedUsd.toFixed(2)),
        };
      }),
    },
  ];
}

/** What each demo leg mint is worth right now, keyed by mint. */
async function heldLegValues(owner: string): Promise<Map<string, number>> {
  const values = new Map<string, number>();

  const stored = await getStoredSandwichPositions(owner).catch(() => []);
  for (const position of stored) {
    for (const leg of position.legs) {
      if (!DEMO_ASSET_BY_MINT[leg.mint]) continue;
      const invested = leg.investedUsd ?? 0;
      if (invested <= 0) continue;
      values.set(leg.mint, (values.get(leg.mint) ?? 0) + invested * GROWTH);
    }
  }

  // Nothing on the device yet — the profile shot can still be filmed first,
  // against the same position the portfolio endpoint reports.
  if (values.size === 0) {
    for (const position of demoPortfolioPositions()) {
      for (const leg of position.legs) {
        values.set(leg.mint, (leg.investedUsd ?? 0) * GROWTH);
      }
    }
  }

  return values;
}

const SIDE_HOLDINGS_USD = DEMO_SIDE_HOLDINGS.reduce((sum, holding) => sum + holding.usdValue, 0);

/**
 * Cash on hand: what is left of DEMO_PORTFOLIO_VALUE_USD after everything else
 * the headline counts — side holdings, the Sandwich legs at their scripted
 * return, and the perp short's collateral (margin + PnL, which is what the
 * Phoenix `portfolioValue` the headline reads adds up to).
 */
export async function demoCashUsd(owner: string): Promise<number> {
  const legTotal = [...(await heldLegValues(owner)).values()].reduce((sum, value) => sum + value, 0);
  const phoenix = demoPhoenixAccount().account.cross?.portfolioValue ?? 0;
  return Number(Math.max(0, DEMO_PORTFOLIO_VALUE_USD - SIDE_HOLDINGS_USD - legTotal - phoenix).toFixed(2));
}

/**
 * `/api/solana/wallet-balances?priced=1` — quantities plus the metadata and
 * prices the priced form carries, so nothing downstream needs a backfill call.
 */
export async function demoWalletBalances(owner: string) {
  const balances: { mint: string; uiAmount: number; decimals: number }[] = [];
  const meta: Record<string, { symbol: string; name: string; icon: string | null }> = {};
  const prices: Record<string, number> = {};

  balances.push({ mint: USDC_MINT, uiAmount: await demoCashUsd(owner), decimals: 6 });
  meta[USDC_MINT] = { symbol: 'USDC', name: 'USD Coin', icon: null };
  prices[USDC_MINT] = 1;

  for (const holding of DEMO_SIDE_HOLDINGS) {
    const mint = sideMint(holding.symbol);
    const price = holding.symbol === 'SOL' ? 212.4 : 268.31;
    balances.push({
      mint,
      uiAmount: Number((holding.usdValue / price).toFixed(6)),
      decimals: holding.decimals,
    });
    meta[mint] = {
      symbol: holding.symbol,
      name: holding.name,
      icon: holding.symbol === 'SOL' ? null : demoLogoUri(holding.symbol),
    };
    prices[mint] = price;
  }

  for (const [mint, valueUsd] of await heldLegValues(owner)) {
    const asset = DEMO_ASSET_BY_MINT[mint];
    if (!asset) continue;
    balances.push({
      mint,
      uiAmount: Number((valueUsd / asset.currentPriceUsd).toFixed(6)),
      decimals: 8,
    });
    meta[mint] = { symbol: asset.symbol, name: asset.name, icon: asset.imageUrl };
    prices[mint] = asset.currentPriceUsd;
  }

  return { balances, priced: true, meta, prices };
}

/** Prices for the standalone lookup, in the shape the bulk price route returns. */
export function demoPrices(mints: string[]) {
  const prices: Record<string, number> = {};
  const meta: Record<string, unknown> = {};
  for (const mint of mints) {
    if (mint === USDC_MINT) {
      prices[mint] = 1;
      meta[mint] = { symbol: 'USDC', name: 'USD Coin', icon: null, priceChange24h: 0 };
      continue;
    }
    const asset = DEMO_ASSET_BY_MINT[mint];
    if (!asset) continue;
    prices[mint] = asset.currentPriceUsd;
    meta[mint] = {
      symbol: asset.symbol,
      name: asset.name,
      icon: asset.imageUrl,
      priceChange24h: DEMO_LEG_DAY_CHANGE_PCT,
    };
  }
  return { prices, meta };
}

/**
 * The portfolio-value curve. A seeded walk on a rising trend, ending on the
 * headline figure so the chart and the number under it agree, up by
 * DEMO_PORTFOLIO_CHANGE_PCT over whatever range is selected.
 */
export async function demoPortfolioHistory(owner: string, range: string) {
  const days = range === '24h' ? 1 : range === '30d' ? 30 : range === 'all' ? 90 : 7;
  const points: { t: number; valueUsd: number }[] = [];
  const legTotal = [...(await heldLegValues(owner)).values()].reduce((sum, value) => sum + value, 0);
  const phoenix = demoPhoenixAccount().account.cross?.portfolioValue ?? 0;
  const endValue = (await demoCashUsd(owner)) + SIDE_HOLDINGS_USD + legTotal + phoenix;
  const startValue = endValue / (1 + DEMO_PORTFOLIO_CHANGE_PCT / 100);

  const count = days <= 1 ? 24 : Math.min(days * 4, 120);
  const stepMs = (days * 24 * 60 * 60 * 1000) / (count - 1);
  const now = Date.now();
  for (let i = 0; i < count; i += 1) {
    const progress = i / (count - 1);
    // A little shaped noise: enough to look like a market, never enough to dip
    // the line below where it started.
    const wobble = Math.sin(progress * 11.3) * 0.012 + Math.sin(progress * 3.1) * 0.008;
    const value = startValue + (endValue - startValue) * progress;
    points.push({
      t: Math.floor(now - (count - 1 - i) * stepMs),
      valueUsd: Number((value * (1 + (i === count - 1 ? 0 : wobble))).toFixed(2)),
    });
  }

  return { points, changePct: Number((((endValue - startValue) / startValue) * 100).toFixed(2)) };
}

// ── The perp short, as Phoenix would report it ──────────────────────────────

/**
 * The hero's perp leg, opened at Phoenix. Holdings draws it in the same row as
 * any real Phoenix position — name, leverage, SHORT, margin + PnL — because it
 * IS one as far as the profile can tell.
 *
 * Sized off the SEEDED position only, not off what was bought on camera: the
 * buy pad runs the spot path, so a take's purchase lands on the spot legs and
 * the short is simply already there. Its collateral counts toward the
 * portfolio headline the way real Phoenix collateral does.
 */
export function demoPhoenixAccount(): PhoenixAccountResponse {
  const call = DEMO_HERO_CALL;
  const totalWeight = call.legs.reduce((sum, leg) => sum + leg.weightBps, 0) || 10000;
  const spec = call.legs.find((leg) => leg.venue === 'perp');
  const positions: PhoenixPosition[] = [];
  let marginUsd = 0;
  let unrealizedPnl = 0;

  if (spec) {
    const { asset } = spec;
    const leverage = spec.leverage ?? 1;
    marginUsd = Number(((DEMO_SEEDED_INVESTED_USD * spec.weightBps) / totalWeight).toFixed(2));
    const notionalUsd = marginUsd * leverage;
    const size = notionalUsd / asset.entryPriceUsd;
    // Signed: negative is short. PnL on a short is entry minus mark.
    const positionSize = spec.side === 'short' ? -size : size;
    unrealizedPnl = Number(
      (Math.abs(size) * (asset.currentPriceUsd - asset.entryPriceUsd) * Math.sign(positionSize)).toFixed(2),
    );
    positions.push({
      symbol: asset.underlyingSymbol,
      name: asset.name.replace(/ xStock$/, ''),
      logoUri: null,
      iconUri: asset.imageUrl,
      leverage,
      marginUsd,
      positionSize: Number(positionSize.toFixed(6)),
      entryPrice: asset.entryPriceUsd,
      positionValue: Number((Math.abs(size) * asset.currentPriceUsd).toFixed(2)),
      unrealizedPnl,
      initialMargin: marginUsd,
      maintenanceMargin: Number((marginUsd / 2).toFixed(2)),
      liquidationPrice:
        spec.side === 'short'
          ? Number((asset.entryPriceUsd * (1 + 0.9 / leverage)).toFixed(2))
          : Number((asset.entryPriceUsd * (1 - 0.9 / leverage)).toFixed(2)),
      unsettledFunding: 0,
      accumulatedFunding: 0,
      takeProfitPrice: null,
      stopLossPrice: null,
    });
  }

  const effectiveCollateral = Number((marginUsd + unrealizedPnl).toFixed(2));
  const cross = {
    subaccountIndex: 0,
    traderKey: 'DemoPhoenixTrader11111111111111111111111111',
    collateralBalance: marginUsd,
    effectiveCollateral,
    effectiveCollateralForWithdrawals: Number(Math.max(0, effectiveCollateral - marginUsd).toFixed(2)),
    portfolioValue: effectiveCollateral,
    initialMargin: marginUsd,
    maintenanceMargin: Number((marginUsd / 2).toFixed(2)),
    cancelMargin: 0,
    unrealizedPnl,
    discountedUnrealizedPnl: unrealizedPnl,
    unsettledFundingOwed: 0,
    accumulatedFunding: 0,
    riskState: null,
    riskTier: null,
    positions,
    openOrderCount: 0,
  };

  return {
    session: null,
    legacyInvite: { whitelisted: false, whitelistedAt: null, inviteCodeUsed: null },
    account: {
      registered: true,
      authority: 'DemoPhoenixAuthority1111111111111111111111',
      pdaIndex: 0,
      traderPda: 'DemoPhoenixPda11111111111111111111111111111',
      slot: null,
      cross,
      subaccounts: [cross],
    },
  };
}
