import {
  buildPhoenixClosePosition,
  buildPhoenixMarketOrder,
  type PhoenixCloseBuild,
  type PhoenixOrderBuild,
} from '@/lib/phoenix-api';

/**
 * Speculative Phoenix builds, so the confirm tap is only sign + send.
 *
 * While the order pad (or the close pad) sits on a settled set of inputs, the
 * transaction is built in the background. The tap takes it if it was built
 * from exactly the inputs being confirmed, is young enough, and was priced
 * against a mark still close to the live one. Anything else falls through to
 * a fresh build, which is the path every trade took before this existed, so
 * a miss costs nothing but the build the tap would have run anyway.
 *
 * Rules that keep this safe:
 *  - **Single use.** Taking an entry removes it; one build is never signed twice.
 *  - **Exact inputs.** The key covers every field sent to the build route, so a
 *    user can never sign an order they did not confirm.
 *  - **No timer refresh.** Nothing rebuilds while the pad just sits there;
 *    Phoenix's rate limit is shared by every user. A stale entry is simply
 *    ignored at tap time.
 *
 * Module state rather than React context, because the pads live in portalled
 * sheets that sit outside the app's providers.
 */

/** A build older than this is ignored: the mark it priced against has moved on. */
const PREBUILD_TTL_MS = 10_000;
/**
 * Largest move of the live mark away from the build's mark we still accept.
 * The build sets a 1% price limit around its mark, so a 0.25% drift still
 * leaves most of the slippage headroom the order was meant to have.
 */
const MAX_MARK_DRIFT = 0.0025;

type Entry<T> = { key: string; startedAt: number; promise: Promise<T> };

type OrderInput = Parameters<typeof buildPhoenixMarketOrder>[0];

let orderEntry: Entry<PhoenixOrderBuild> | null = null;
let closeEntry: Entry<PhoenixCloseBuild> | null = null;

function orderKey(input: OrderInput): string {
  return JSON.stringify([
    input.symbol.trim().toUpperCase(),
    input.side,
    input.marginUsd,
    input.leverage,
    input.autoFund === true,
    input.takeProfitPrice ?? null,
    input.stopLossPrice ?? null,
  ]);
}

function closeKey(symbol: string, fraction: number, subaccountIndex?: number | null): string {
  return JSON.stringify([symbol.trim().toUpperCase(), fraction.toFixed(6), subaccountIndex ?? null]);
}

function isFresh(entry: Entry<unknown> | null, key: string): boolean {
  return entry !== null && entry.key === key && Date.now() - entry.startedAt < PREBUILD_TTL_MS;
}

function markStillClose(builtMark: number, liveMark: number | null | undefined): boolean {
  if (liveMark === null || liveMark === undefined || !Number.isFinite(liveMark) || liveMark <= 0) {
    // No live mark to compare against; the TTL alone bounds the staleness.
    return true;
  }
  return Math.abs(liveMark - builtMark) / builtMark <= MAX_MARK_DRIFT;
}

/** Start (or keep) a background build for these exact order inputs. */
export function prebuildPhoenixOrder(input: OrderInput): void {
  const key = orderKey(input);
  if (isFresh(orderEntry, key)) return;
  const promise = buildPhoenixMarketOrder(input);
  const entry: Entry<PhoenixOrderBuild> = { key, startedAt: Date.now(), promise };
  // A failed speculation is silent; the tap rebuilds and shows the real error.
  promise.catch(() => {
    if (orderEntry === entry) orderEntry = null;
  });
  orderEntry = entry;
}

export function clearPhoenixOrderPrebuild(): void {
  orderEntry = null;
}

/** The pre-built order for these inputs if it is still good, otherwise a fresh build. */
export async function takePhoenixOrderBuild(
  input: OrderInput,
  liveMark: number | null | undefined,
): Promise<PhoenixOrderBuild> {
  const entry = orderEntry;
  orderEntry = null;
  if (isFresh(entry, orderKey(input))) {
    try {
      const built = await entry!.promise;
      if (markStillClose(built.preview.markPrice, liveMark)) return built;
    } catch {
      // Fall through to a fresh build.
    }
  }
  return buildPhoenixMarketOrder(input);
}

/** Start (or keep) a background build for closing `fraction` of `symbol`. */
export function prebuildPhoenixClose(
  symbol: string,
  fraction: number,
  subaccountIndex?: number | null,
): void {
  const key = closeKey(symbol, fraction, subaccountIndex);
  if (isFresh(closeEntry, key)) return;
  const promise = buildPhoenixClosePosition(symbol, fraction, subaccountIndex);
  const entry: Entry<PhoenixCloseBuild> = { key, startedAt: Date.now(), promise };
  promise.catch(() => {
    if (closeEntry === entry) closeEntry = null;
  });
  closeEntry = entry;
}

/** The pre-built close if it is still good, otherwise a fresh build. */
export async function takePhoenixCloseBuild(
  symbol: string,
  fraction: number,
  liveMark: number | null | undefined,
  /** The standalone isolated child holding the position; omit for cross. */
  subaccountIndex?: number | null,
): Promise<PhoenixCloseBuild> {
  const entry = closeEntry;
  closeEntry = null;
  if (isFresh(entry, closeKey(symbol, fraction, subaccountIndex))) {
    try {
      const built = await entry!.promise;
      if (markStillClose(built.preview.markPrice, liveMark)) return built;
    } catch {
      // Fall through to a fresh build.
    }
  }
  return buildPhoenixClosePosition(symbol, fraction, subaccountIndex);
}
