import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));
vi.mock('@/lib/api', () => ({ getAuthHeaders: async () => ({}) }));

type Api = typeof import('./phoenix-api');
let api: Api;

beforeAll(async () => {
  api = await import('./phoenix-api');
});

afterEach(() => vi.unstubAllGlobals());

function subaccount(subaccountIndex: number, overrides: Record<string, unknown> = {}) {
  return {
    subaccountIndex,
    traderKey: `trader-${subaccountIndex}`,
    collateralBalance: 0,
    effectiveCollateral: 0,
    effectiveCollateralForWithdrawals: 0,
    portfolioValue: 0,
    initialMargin: 0,
    maintenanceMargin: 0,
    cancelMargin: 0,
    unrealizedPnl: 0,
    discountedUnrealizedPnl: 0,
    unsettledFundingOwed: 0,
    accumulatedFunding: 0,
    riskState: null,
    riskTier: null,
    positions: [],
    openOrderCount: 0,
    ...overrides,
  };
}

function position(symbol: string, positionSize: number, entryPrice: number) {
  return {
    symbol,
    positionSize,
    entryPrice,
    positionValue: positionSize * entryPrice,
    unrealizedPnl: 0.08,
    initialMargin: 3,
    maintenanceMargin: 1.5,
    liquidationPrice: null,
    unsettledFunding: 0,
    accumulatedFunding: 0,
    takeProfitPrice: null,
    stopLossPrice: null,
  };
}

function stubAccount(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url.includes('/account') ? body : { markets: [] }),
    })),
  );
}

describe('standalone isolated Phoenix positions', () => {
  it('reads margin and leverage from the child, not the shared cross pool', async () => {
    // The bug: $3 at 10x on a cross account holding $5.09 read back as
    // "$5.15 · 5.9x". In its own child the collateral IS the margin.
    stubAccount({
      session: null,
      legacyInvite: { whitelisted: false, whitelistedAt: null, inviteCodeUsed: null },
      standaloneSubaccountIndices: [5],
      account: {
        registered: true,
        authority: 'wallet',
        pdaIndex: 0,
        traderPda: 'pda',
        slot: 1,
        cross: subaccount(0, { collateralBalance: 2.1, portfolioValue: 2.1 }),
        subaccounts: [
          subaccount(0, { collateralBalance: 2.1, portfolioValue: 2.1 }),
          subaccount(5, {
            collateralBalance: 3,
            portfolioValue: 3.08,
            positions: [position('IREN', 0.77, 38.96)],
          }),
          // A Sandwich leg's child: never listed as a standalone position.
          subaccount(1, { positions: [position('NVDA', 0.1, 100)] }),
        ],
      },
    });

    const response = await api.getPhoenixAccount();
    const positions = api.phoenixStandalonePositions(response);

    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({
      symbol: 'IREN',
      subaccountIndex: 5,
      marginUsd: 3,
      leverage: 10,
    });
    expect(api.phoenixStandaloneChildrenValue(response)).toBeCloseTo(3.08);
  });

  it('keeps cross positions when the backend predates isolated standalone perps', async () => {
    stubAccount({
      session: null,
      legacyInvite: { whitelisted: false, whitelistedAt: null, inviteCodeUsed: null },
      account: {
        registered: true,
        authority: 'wallet',
        pdaIndex: 0,
        traderPda: 'pda',
        slot: 1,
        cross: subaccount(0, { collateralBalance: 5, positions: [position('IREN', 0.77, 38.96)] }),
        subaccounts: [],
      },
    });

    const positions = api.phoenixStandalonePositions(await api.getPhoenixAccount());

    expect(positions).toHaveLength(1);
    expect(positions[0].subaccountIndex).toBeUndefined();
  });
});
