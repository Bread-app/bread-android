import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  buildPhoenixMarketOrder: vi.fn(),
  buildPhoenixClosePosition: vi.fn(),
}));
vi.mock('@/lib/phoenix-api', () => api);

import {
  clearPhoenixOrderPrebuild,
  prebuildPhoenixClose,
  prebuildPhoenixOrder,
  takePhoenixCloseBuild,
  takePhoenixOrderBuild,
} from '@/lib/phoenix-prebuild';

/**
 * The pre-build cache decides which transaction the user signs, so its rules
 * are the safety of the feature: a build is only reused for the exact inputs
 * confirmed, only once, and only while its price is still close to live.
 */
const order = {
  symbol: 'NVDA',
  side: 'long' as const,
  marginUsd: '25',
  leverage: 3,
  autoFund: true,
  takeProfitPrice: null,
  stopLossPrice: null,
};

function built(tag: string, markPrice = 100) {
  return { transaction: tag, lastValidBlockHeight: 1, preview: { markPrice } };
}

beforeEach(() => {
  vi.useRealTimers();
  api.buildPhoenixMarketOrder.mockReset();
  api.buildPhoenixClosePosition.mockReset();
  clearPhoenixOrderPrebuild();
});

describe('order pre-build', () => {
  it('reuses the pre-built order for identical inputs without building again', async () => {
    api.buildPhoenixMarketOrder.mockResolvedValueOnce(built('pre'));
    prebuildPhoenixOrder(order);
    await expect(takePhoenixOrderBuild(order, 100.1)).resolves.toMatchObject({ transaction: 'pre' });
    expect(api.buildPhoenixMarketOrder).toHaveBeenCalledTimes(1);
  });

  it('never signs a build made from different inputs', async () => {
    api.buildPhoenixMarketOrder
      .mockResolvedValueOnce(built('pre'))
      .mockResolvedValueOnce(built('fresh'));
    prebuildPhoenixOrder(order);
    await expect(
      takePhoenixOrderBuild({ ...order, leverage: 5 }, 100),
    ).resolves.toMatchObject({ transaction: 'fresh' });
  });

  it('is single use', async () => {
    api.buildPhoenixMarketOrder
      .mockResolvedValueOnce(built('pre'))
      .mockResolvedValueOnce(built('fresh'));
    prebuildPhoenixOrder(order);
    await takePhoenixOrderBuild(order, 100);
    await expect(takePhoenixOrderBuild(order, 100)).resolves.toMatchObject({ transaction: 'fresh' });
  });

  it('rebuilds when the live mark has moved away from the build', async () => {
    api.buildPhoenixMarketOrder
      .mockResolvedValueOnce(built('pre', 100))
      .mockResolvedValueOnce(built('fresh', 101));
    prebuildPhoenixOrder(order);
    await expect(takePhoenixOrderBuild(order, 101)).resolves.toMatchObject({ transaction: 'fresh' });
  });

  it('rebuilds once the pre-build is too old', async () => {
    vi.useFakeTimers();
    api.buildPhoenixMarketOrder
      .mockResolvedValueOnce(built('pre'))
      .mockResolvedValueOnce(built('fresh'));
    prebuildPhoenixOrder(order);
    vi.advanceTimersByTime(11_000);
    await expect(takePhoenixOrderBuild(order, 100)).resolves.toMatchObject({ transaction: 'fresh' });
  });

  it('falls through to a fresh build when the pre-build failed', async () => {
    api.buildPhoenixMarketOrder
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValueOnce(built('fresh'));
    prebuildPhoenixOrder(order);
    await expect(takePhoenixOrderBuild(order, 100)).resolves.toMatchObject({ transaction: 'fresh' });
  });
});

describe('close pre-build', () => {
  it('matches on symbol and share', async () => {
    api.buildPhoenixClosePosition
      .mockResolvedValueOnce(built('pre'))
      .mockResolvedValueOnce(built('fresh'));
    prebuildPhoenixClose('TSLA', 0.5);
    await expect(takePhoenixCloseBuild('TSLA', 1, 100)).resolves.toMatchObject({
      transaction: 'fresh',
    });
  });

  it('reuses the pre-built close for the same share', async () => {
    api.buildPhoenixClosePosition.mockResolvedValueOnce(built('pre'));
    prebuildPhoenixClose('tsla', 0.5);
    await expect(takePhoenixCloseBuild('TSLA', 0.5, 100)).resolves.toMatchObject({
      transaction: 'pre',
    });
    expect(api.buildPhoenixClosePosition).toHaveBeenCalledTimes(1);
  });
});
