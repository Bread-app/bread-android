import { DEMO_BUY_DELAY_MS } from './demo-buy-mode';
import type { PhoenixAccountResponse, PhoenixPosition } from './phoenix-api';

/**
 * The paper account behind Settings → Demo buys.
 *
 * A demo buy has to *behave* like a real one: cash goes down, the asset shows
 * up in Holdings with live PnL, it can be sold, a perp shows up as an open
 * position and can be closed. Rather than teach every screen about demo
 * positions, this ledger answers the handful of reads those screens already
 * make — wallet balances, cost basis, the exact token balance a sell clamps to,
 * and the Phoenix account — so Home, Profile and the trade pads run their
 * ordinary code over it. Prices are never faked: holdings are valued at live
 * market prices, so the PnL is real PnL on pretend money.
 *
 * While demo mode is on the real wallet is hidden entirely (the account starts
 * at {@link DEMO_STARTING_CASH_USD} of virtual cash), so a demo portfolio is
 * never confused with, or mixed into, real money.
 *
 * Imports nothing from `api.ts` on purpose: `api.ts` calls into this module,
 * and Metro's inline requires turn a cycle into a runtime crash.
 */

/** Cash a fresh demo account opens with; buys draw it down like real cash. */
export const DEMO_STARTING_CASH_USD = 127.33;

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// SecureStore values are capped at ~2KB on Android, so the ledger is written
// as numbered chunks with a count key alongside.
const STORAGE_PREFIX = 'bread.demo-account';
// Lazy, so api.ts (which imports this module) stays importable in unit tests.
const secureStore = () => import('expo-secure-store');
const CHUNK_CHARS = 1800;

type DemoSpot = {
  /** Total held, sandwich legs included. */
  qty: number;
  costUsd: number;
  decimals: number;
  /** The part of `qty` held inside Sandwiches — a stock sell can't touch it. */
  sandwichQty: number;
  sandwichCostUsd: number;
};

type DemoSandwichLot = { mint: string; qty: number; costUsd: number };

export type DemoPerp = {
  symbol: string;
  name: string | null;
  iconUri: string | null;
  side: 'long' | 'short';
  leverage: number;
  marginUsd: number;
  entryPrice: number;
  /** Unsigned base size. */
  size: number;
  openedAt: string;
};

type DemoAccount = {
  cashUsd: number;
  spot: Record<string, DemoSpot>;
  perps: DemoPerp[];
  sandwiches: Record<string, DemoSandwichLot[]>;
};

function emptyAccount(): DemoAccount {
  return { cashUsd: DEMO_STARTING_CASH_USD, spot: {}, perps: [], sandwiches: {} };
}

let cached: DemoAccount | null = null;
let loading: Promise<DemoAccount> | null = null;
/** Every mutation runs in order, so two quick trades can't overwrite each other. */
let queue: Promise<unknown> = Promise.resolve();

async function readStored(): Promise<DemoAccount> {
  try {
    const SecureStore = await secureStore();
    const count = Number(await SecureStore.getItemAsync(`${STORAGE_PREFIX}.n`));
    if (!Number.isInteger(count) || count <= 0) return emptyAccount();
    const parts: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const part = await SecureStore.getItemAsync(`${STORAGE_PREFIX}.${index}`);
      if (part === null) return emptyAccount();
      parts.push(part);
    }
    const parsed = JSON.parse(parts.join('')) as Partial<DemoAccount>;
    return {
      cashUsd: typeof parsed.cashUsd === 'number' ? parsed.cashUsd : DEMO_STARTING_CASH_USD,
      spot: parsed.spot ?? {},
      perps: parsed.perps ?? [],
      sandwiches: parsed.sandwiches ?? {},
    };
  } catch {
    return emptyAccount();
  }
}

async function writeStored(account: DemoAccount): Promise<void> {
  const SecureStore = await secureStore();
  const json = JSON.stringify(account);
  const chunks: string[] = [];
  for (let offset = 0; offset < json.length; offset += CHUNK_CHARS) {
    chunks.push(json.slice(offset, offset + CHUNK_CHARS));
  }
  const previous = Number(await SecureStore.getItemAsync(`${STORAGE_PREFIX}.n`).catch(() => null)) || 0;
  for (let index = 0; index < chunks.length; index += 1) {
    await SecureStore.setItemAsync(`${STORAGE_PREFIX}.${index}`, chunks[index]);
  }
  await SecureStore.setItemAsync(`${STORAGE_PREFIX}.n`, String(chunks.length));
  for (let index = chunks.length; index < previous; index += 1) {
    await SecureStore.deleteItemAsync(`${STORAGE_PREFIX}.${index}`).catch(() => {});
  }
}

async function load(): Promise<DemoAccount> {
  if (cached) return cached;
  loading ??= readStored().then((account) => {
    cached = account;
    return account;
  });
  return loading;
}

function mutate<T>(change: (account: DemoAccount) => T): Promise<T> {
  const run = queue.then(async () => {
    const account = await load();
    const result = change(account);
    await writeStored(account).catch(() => {});
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

const round = (value: number, digits = 6) => Number(value.toFixed(digits));
const sameSymbol = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

// ── Trades ──────────────────────────────────────────────────────────────────

export class DemoInsufficientCashError extends Error {
  constructor() {
    super('Not enough demo cash for this buy.');
  }
}

/** Spend virtual cash on `mint` at `priceUsd`. Returns the quantity bought. */
export function demoBuySpot(input: {
  mint: string;
  usd: number;
  priceUsd: number;
  decimals: number;
  sandwichId?: string;
}): Promise<number> {
  return mutate((account) => {
    if (!(input.usd > 0) || !(input.priceUsd > 0)) throw new Error('No price for this asset right now.');
    if (input.usd > account.cashUsd + 1e-6) throw new DemoInsufficientCashError();
    const qty = round(input.usd / input.priceUsd, Math.min(input.decimals, 9));
    account.cashUsd = round(account.cashUsd - input.usd, 6);
    const spot = account.spot[input.mint] ?? {
      qty: 0,
      costUsd: 0,
      decimals: input.decimals,
      sandwichQty: 0,
      sandwichCostUsd: 0,
    };
    spot.qty += qty;
    spot.costUsd += input.usd;
    if (input.sandwichId) {
      spot.sandwichQty += qty;
      spot.sandwichCostUsd += input.usd;
      const lots = account.sandwiches[input.sandwichId] ?? [];
      const lot = lots.find((entry) => entry.mint === input.mint);
      if (lot) {
        lot.qty += qty;
        lot.costUsd += input.usd;
      } else {
        lots.push({ mint: input.mint, qty, costUsd: input.usd });
      }
      account.sandwiches[input.sandwichId] = lots;
    }
    account.spot[input.mint] = spot;
    return qty;
  });
}

/**
 * Sell `qty` of a standalone holding at `priceUsd`. Sandwich legs are not
 * touched, the same rule the real sell path enforces.
 */
export function demoSellSpot(input: {
  mint: string;
  qty: number;
  priceUsd: number;
}): Promise<{ qtySold: number; proceedsUsd: number; realizedPnlUsd: number; realizedPnlPct: number | null }> {
  return mutate((account) => {
    const spot = account.spot[input.mint];
    const standaloneQty = spot ? spot.qty - spot.sandwichQty : 0;
    if (!spot || standaloneQty <= 0) throw new Error("You don't hold any of this to sell.");
    const qtySold = Math.min(input.qty, standaloneQty);
    const standaloneCost = spot.costUsd - spot.sandwichCostUsd;
    const costSold = standaloneQty > 0 ? (standaloneCost * qtySold) / standaloneQty : 0;
    const proceedsUsd = qtySold * input.priceUsd;
    spot.qty -= qtySold;
    spot.costUsd -= costSold;
    if (spot.qty <= 1e-9) delete account.spot[input.mint];
    account.cashUsd = round(account.cashUsd + proceedsUsd, 6);
    return {
      qtySold,
      proceedsUsd,
      realizedPnlUsd: proceedsUsd - costSold,
      realizedPnlPct: costSold > 0 ? ((proceedsUsd - costSold) / costSold) * 100 : null,
    };
  });
}

/**
 * Exit `fraction` of a Sandwich. Proceeds are what the position was worth on
 * screen at the moment of the sell — the same live-priced figure the sell pad
 * showed — so the receipt and the cash credited always agree.
 */
export function demoSellSandwich(input: {
  sandwichId: string;
  fraction: number;
  proceedsUsd: number;
}): Promise<void> {
  return mutate((account) => {
    const lots = account.sandwiches[input.sandwichId];
    if (!lots || lots.length === 0) throw new Error('Nothing left in this Sandwich to sell.');
    const fraction = Math.max(0, Math.min(1, input.fraction));
    for (const lot of lots) {
      const qtySold = fraction >= 0.9999 ? lot.qty : lot.qty * fraction;
      const costSold = fraction >= 0.9999 ? lot.costUsd : lot.costUsd * fraction;
      lot.qty -= qtySold;
      lot.costUsd -= costSold;
      const spot = account.spot[lot.mint];
      if (spot) {
        spot.qty -= qtySold;
        spot.costUsd -= costSold;
        spot.sandwichQty -= qtySold;
        spot.sandwichCostUsd -= costSold;
        if (spot.qty <= 1e-9) delete account.spot[lot.mint];
      }
    }
    if (fraction >= 0.9999) delete account.sandwiches[input.sandwichId];
    account.cashUsd = round(account.cashUsd + Math.max(0, input.proceedsUsd), 6);
  });
}

/**
 * A Sandwich exit for the sell screens, shaped like the basket engine's
 * confirmed submit so they can treat it as one. Paced like a real fill.
 */
export async function demoSandwichExit(input: {
  sandwichId: string;
  fraction: number;
  proceedsUsd: number;
}): Promise<{ status: 'confirmed'; basketRunId: string; bundleId: string; signatures: string[] }> {
  await new Promise((resolve) => setTimeout(resolve, DEMO_BUY_DELAY_MS));
  await demoSellSandwich(input);
  return { status: 'confirmed', basketRunId: 'demo', bundleId: 'demo', signatures: [] };
}

/** Move `marginUsd` of cash into a new perp position at `entryPrice`. */
export function demoOpenPerp(input: {
  symbol: string;
  name: string | null;
  iconUri: string | null;
  side: 'long' | 'short';
  leverage: number;
  marginUsd: number;
  entryPrice: number;
}): Promise<void> {
  return mutate((account) => {
    if (!(input.entryPrice > 0)) throw new Error('No mark price for this market right now.');
    if (input.marginUsd > account.cashUsd + 1e-6) throw new DemoInsufficientCashError();
    account.cashUsd = round(account.cashUsd - input.marginUsd, 6);
    // Case is kept: Hyperliquid coin names are case-sensitive when priced.
    const symbol = input.symbol.trim();
    const size = (input.marginUsd * input.leverage) / input.entryPrice;
    const existing = account.perps.find(
      (perp) => sameSymbol(perp.symbol, symbol) && perp.side === input.side,
    );
    if (existing) {
      // Adding to a position averages its entry, as a venue would.
      const totalSize = existing.size + size;
      existing.entryPrice = (existing.entryPrice * existing.size + input.entryPrice * size) / totalSize;
      existing.size = totalSize;
      existing.marginUsd += input.marginUsd;
      existing.leverage = (existing.size * existing.entryPrice) / existing.marginUsd;
      return;
    }
    account.perps.push({
      symbol,
      name: input.name,
      iconUri: input.iconUri,
      side: input.side,
      leverage: input.leverage,
      marginUsd: input.marginUsd,
      entryPrice: input.entryPrice,
      size,
      openedAt: new Date().toISOString(),
    });
  });
}

/** Close `fraction` of a perp at `exitPrice`; margin plus PnL returns to cash. */
export function demoClosePerp(input: {
  symbol: string;
  fraction: number;
  exitPrice: number;
}): Promise<{ pnlUsd: number }> {
  return mutate((account) => {
    const perp = account.perps.find((entry) => sameSymbol(entry.symbol, input.symbol));
    if (!perp) throw new Error(`No open demo ${input.symbol} position.`);
    const fraction = Math.max(0, Math.min(1, input.fraction));
    const size = perp.size * fraction;
    const margin = perp.marginUsd * fraction;
    const direction = perp.side === 'short' ? -1 : 1;
    const pnlUsd = (input.exitPrice - perp.entryPrice) * size * direction;
    // A loss can't take more than the margin — that's a liquidation.
    account.cashUsd = round(account.cashUsd + Math.max(0, margin + pnlUsd), 6);
    if (fraction >= 0.9999) {
      account.perps = account.perps.filter((entry) => entry !== perp);
    } else {
      perp.size -= size;
      perp.marginUsd -= margin;
    }
    return { pnlUsd };
  });
}

/** Back to a fresh account with starting cash and nothing held. */
export function resetDemoAccount(): Promise<void> {
  return mutate((account) => {
    const fresh = emptyAccount();
    account.cashUsd = fresh.cashUsd;
    account.spot = fresh.spot;
    account.perps = fresh.perps;
    account.sandwiches = fresh.sandwiches;
  });
}

export async function getDemoPerps(): Promise<DemoPerp[]> {
  return (await load()).perps;
}

// ── Reads the app already makes, answered from the ledger ───────────────────

/**
 * Answer a backend read from the paper account, or `undefined` to let it
 * through. Prices, metadata, charts and quotes always pass through — demo
 * holdings are valued at real prices.
 */
export async function resolveDemoAccountRequest(
  method: string,
  path: string,
  params: Record<string, string> | undefined,
): Promise<unknown> {
  if (method !== 'GET') return undefined;

  if (path === '/api/solana/wallet-balances') {
    const account = await load();
    const balances: { mint: string; uiAmount: number; decimals: number }[] = [
      { mint: USDC_MINT, uiAmount: round(account.cashUsd, 6), decimals: 6 },
    ];
    for (const [mint, spot] of Object.entries(account.spot)) {
      if (spot.qty > 0) balances.push({ mint, uiAmount: spot.qty, decimals: spot.decimals });
    }
    // Unpriced on purpose: the app prices the rows itself at live prices.
    return { balances };
  }

  if (/^\/api\/helius\/wallet\/[^/]+\/cost-basis$/.test(path)) {
    const account = await load();
    const ledger: Record<string, unknown> = {};
    for (const [mint, spot] of Object.entries(account.spot)) {
      if (!(spot.qty > 0) || !(spot.costUsd > 0)) continue;
      const standaloneQty = Math.max(0, spot.qty - spot.sandwichQty);
      const standaloneCost = Math.max(0, spot.costUsd - spot.sandwichCostUsd);
      ledger[mint] = {
        qty: spot.qty,
        avgPriceUsd: spot.costUsd / spot.qty,
        standaloneQty,
        standaloneAvgPriceUsd: standaloneQty > 0 ? standaloneCost / standaloneQty : 0,
      };
    }
    return { ledger, solTraded: false };
  }

  if (path === '/api/solana/token-balance') {
    const account = await load();
    const mint = params?.mint ?? '';
    if (mint === USDC_MINT) {
      return { amount: BigInt(Math.floor(account.cashUsd * 1e6)).toString(), decimals: 6 };
    }
    const spot = account.spot[mint];
    const decimals = spot?.decimals ?? 6;
    const raw = spot ? Math.floor(spot.qty * 10 ** decimals) : 0;
    return { amount: BigInt(Math.max(0, raw)).toString(), decimals };
  }

  // Perp Sandwiches open as plain demo perps; there are no basket rows.
  if (path === '/api/perp-sandwich-positions') return { positions: [] };

  return undefined;
}

/** The demo perps as a Phoenix account, marked at `marks` (live prices). */
export async function demoPhoenixAccountResponse(
  marks: Record<string, number | null>,
): Promise<PhoenixAccountResponse> {
  const account = await load();
  let margin = 0;
  let pnl = 0;
  const positions: PhoenixPosition[] = account.perps.map((perp) => {
    const mark = marks[perp.symbol] ?? marks[perp.symbol.toUpperCase()] ?? perp.entryPrice;
    const direction = perp.side === 'short' ? -1 : 1;
    const unrealizedPnl = round((mark - perp.entryPrice) * perp.size * direction, 2);
    margin += perp.marginUsd;
    pnl += unrealizedPnl;
    const maintenance = perp.marginUsd / 2;
    return {
      symbol: perp.symbol,
      name: perp.name,
      logoUri: null,
      iconUri: perp.iconUri,
      leverage: round(perp.leverage, 1),
      marginUsd: round(perp.marginUsd, 2),
      positionSize: round(perp.size * direction, 6),
      entryPrice: perp.entryPrice,
      positionValue: round(perp.size * mark, 2),
      unrealizedPnl,
      initialMargin: round(perp.marginUsd, 2),
      maintenanceMargin: round(maintenance, 2),
      liquidationPrice: round(perp.entryPrice * (1 - (direction * 0.9) / perp.leverage), 4),
      unsettledFunding: 0,
      accumulatedFunding: 0,
      takeProfitPrice: null,
      stopLossPrice: null,
    };
  });

  const effectiveCollateral = round(margin + pnl, 2);
  const cross = {
    subaccountIndex: 0,
    traderKey: 'DemoTrader111111111111111111111111111111111',
    collateralBalance: round(margin, 2),
    effectiveCollateral,
    // Nothing spare: every demo open moves its margin from cash, as autoFund does.
    effectiveCollateralForWithdrawals: 0,
    portfolioValue: effectiveCollateral,
    initialMargin: round(margin, 2),
    maintenanceMargin: round(margin / 2, 2),
    cancelMargin: 0,
    unrealizedPnl: round(pnl, 2),
    discountedUnrealizedPnl: round(pnl, 2),
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
      authority: 'DemoAuthority11111111111111111111111111111',
      pdaIndex: 0,
      traderPda: 'DemoTraderPda1111111111111111111111111111111',
      slot: null,
      cross,
      subaccounts: [cross],
    },
  };
}
