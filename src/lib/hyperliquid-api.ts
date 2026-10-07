import { getAuthHeaders } from '@/lib/api';

/**
 * Bread's Hyperliquid perps balance: read it, and move money between it and
 * Solana cash. Every move goes through the backend, which derives both wallets
 * from the signed-in user — the client never names an address.
 */

function getApiBaseUrl(): string {
  return (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export class HyperliquidApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  /** The full error body — e.g. `shortfallUsd` on `insufficient_margin`. */
  readonly body: Record<string, unknown>;

  constructor(status: number, code: string | null, message: string, body: Record<string, unknown> = {}) {
    super(message);
    this.name = 'HyperliquidApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}/api/hyperliquid${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(await getAuthHeaders()),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => null)) as
    | (T & { error?: unknown; message?: unknown })
    | null;
  if (!response.ok || !json) {
    const code = typeof json?.error === 'string' ? json.error : null;
    const message =
      typeof json?.message === 'string' ? json.message : code ?? `Request failed (${response.status})`;
    throw new HyperliquidApiError(response.status, code, message, (json ?? {}) as Record<string, unknown>);
  }
  return json;
}

export type HyperliquidPosition = {
  /** "BTC", or "xyz:NVDA" for a stock perp. */
  coin: string;
  dex: string;
  side: 'long' | 'short';
  size: number;
  entryPx: number;
  positionValueUsd: number;
  unrealizedPnlUsd: number;
  returnOnEquity: number;
  liquidationPx: number | null;
  leverage: number;
  marginType: 'cross' | 'isolated';
  marginUsedUsd: number;
};

export type HyperliquidAccount = {
  address: string;
  /** False until the first deposit creates the account on Hyperliquid. */
  exists: boolean;
  /** True once trading setup switched it to one USDC balance across all markets. */
  unified: boolean;
  positions: HyperliquidPosition[];
  accountValue: number;
  withdrawable: number;
  marginUsed: number;
  unrealizedPnl: number;
  positionCount: number;
  spotUsdc: number;
};

export type HyperliquidAccountResponse = {
  account: HyperliquidAccount;
  limits: { minDepositUsd: number; minWithdrawUsd: number };
};

export function getHyperliquidAccount(): Promise<HyperliquidAccountResponse> {
  return request('GET', '/account');
}

export type HyperliquidDepositBuild = {
  transaction: string;
  lastValidBlockHeight: number;
  requestId: string;
  amountUsd: number;
  amountOutUsd: number;
  setupFeeUsd: number;
  timeEstimateSec: number | null;
};

export function buildHyperliquidDeposit(amountUsd: string): Promise<HyperliquidDepositBuild> {
  return request('POST', '/deposit/build', { amountUsd });
}

/** An `eth_signTypedData_v4` payload, passed to the wallet as-is. */
export type TypedDataPayload = {
  domain: Record<string, unknown>;
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
};

export type HyperliquidWithdrawPrepare = {
  requestId: string;
  amountUsd: number;
  amountOutUsd: number;
  timeEstimateSec: number | null;
  authorize: { typedData: TypedDataPayload; body: Record<string, unknown> };
  sendAsset: { typedData: TypedDataPayload; params: Record<string, unknown> };
};

export function prepareHyperliquidWithdraw(amountUsd: string): Promise<HyperliquidWithdrawPrepare> {
  return request('POST', '/withdraw/prepare', { amountUsd });
}

export function submitHyperliquidWithdraw(input: {
  prepared: HyperliquidWithdrawPrepare;
  authorizeSignature: string;
  sendAssetSignature: string;
}): Promise<{ requestId: string; amountUsd: number }> {
  const { prepared } = input;
  return request('POST', '/withdraw/submit', {
    requestId: prepared.requestId,
    authorize: {
      typedData: prepared.authorize.typedData,
      body: prepared.authorize.body,
      signature: input.authorizeSignature,
    },
    sendAsset: { params: prepared.sendAsset.params, signature: input.sendAssetSignature },
  });
}

export type HyperliquidTransferStatus =
  | 'waiting'
  | 'pending'
  | 'submitted'
  | 'success'
  | 'failure'
  | 'refund'
  | 'unknown';

export async function getHyperliquidTransferStatus(requestId: string): Promise<HyperliquidTransferStatus> {
  const result = await request<{ status: HyperliquidTransferStatus }>(
    'GET',
    `/transfer-status?requestId=${encodeURIComponent(requestId)}`,
  );
  return result.status;
}

/**
 * Wait for Relay to deliver a move. Relay fills in about a second; the cap is
 * for a slow fill, after which the caller says "arriving shortly" rather than
 * claiming failure — the money is in flight, not lost.
 */
export async function waitForHyperliquidTransfer(
  requestId: string,
  { timeoutMs = 20_000, intervalMs = 1_000 } = {},
): Promise<'success' | 'failed' | 'timeout'> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await getHyperliquidTransferStatus(requestId).catch(() => 'unknown' as const);
    if (status === 'success') return 'success';
    if (status === 'failure' || status === 'refund') return 'failed';
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return 'timeout';
}

export type TradingSetupStep = 'unifiedAccount' | 'builderFee' | 'agent';

export type TradingSetupPrepare = {
  ready: boolean;
  steps: { step: TradingSetupStep; nonce: number; typedData: TypedDataPayload }[];
};

export function prepareTradingSetup(): Promise<TradingSetupPrepare> {
  return request('POST', '/trading-setup/prepare', {});
}

export function submitTradingSetup(
  steps: { step: TradingSetupStep; nonce: number; signature: string }[],
): Promise<{ ready: boolean; completed: TradingSetupStep[] }> {
  return request('POST', '/trading-setup/submit', { steps });
}

export type HyperliquidMarket = {
  coin: string;
  dex: string;
  symbol: string;
  assetId: number;
  szDecimals: number;
  /** Hyperliquid's own ceiling for this market (BTC 40x, HYPE 10x…). */
  maxLeverage: number;
  markPx: number;
  midPx: number | null;
  oraclePx: number;
  dayNtlVlm: number;
  openInterestUsd: number;
  /** Mark 24h ago. */
  prevDayPx: number;
  /** Hourly funding rate as a fraction. */
  funding: number;
};

/** Every USDC-margined Hyperliquid market (cached server-side for a minute). */
export async function listHyperliquidMarkets(): Promise<HyperliquidMarket[]> {
  const { markets } = await request<{ markets: HyperliquidMarket[] }>('GET', '/markets');
  return markets;
}

/** The USDC-margined Hyperliquid market for a ticker, or null when there isn't one. */
export async function getHyperliquidMarket(symbol: string): Promise<HyperliquidMarket | null> {
  try {
    const { market } = await request<{ market: HyperliquidMarket }>(
      'GET',
      `/markets?symbol=${encodeURIComponent(symbol)}`,
    );
    return market;
  } catch (error) {
    if (error instanceof HyperliquidApiError && error.code === 'market_not_found') return null;
    throw error;
  }
}

export type HyperliquidSide = 'long' | 'short';

export type OpenHyperliquidPositionInput = {
  /** Coin ("xyz:NVDA") or ticker ("NVDA"). */
  market: string;
  side: HyperliquidSide;
  marginUsd: number;
  leverage: number;
  takeProfitPx?: number | null;
  stopLossPx?: number | null;
  slippageBps?: number;
};

export type OpenHyperliquidPositionResult = {
  coin: string;
  side: HyperliquidSide;
  size: number;
  avgPx: number;
  notionalUsd: number;
  marginUsd: number;
  leverage: number;
  oid: number;
  tpsl: { takeProfitPx?: number | null; stopLossPx?: number | null; error?: string } | null;
};

export function openHyperliquidPosition(input: OpenHyperliquidPositionInput): Promise<OpenHyperliquidPositionResult> {
  return request('POST', '/order', input);
}

export type CloseHyperliquidPositionResult = {
  coin: string;
  side: HyperliquidSide;
  size: number;
  avgPx: number;
  pnlUsd: number;
  closedFully: boolean;
};

export function closeHyperliquidPosition(input: {
  market: string;
  fraction?: number;
  slippageBps?: number;
}): Promise<CloseHyperliquidPositionResult> {
  return request('POST', '/close', input);
}

export function setHyperliquidTpSl(input: {
  market: string;
  takeProfitPx?: number | null;
  stopLossPx?: number | null;
}): Promise<{ takeProfitPx?: number | null; stopLossPx?: number | null }> {
  return request('POST', '/tpsl', input);
}

export type HyperliquidCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  markOpen: number;
  markHigh: number;
  markLow: number;
  markClose: number;
  volume: number;
  volumeQuote: number;
  tradeCount: number;
};

export async function getHyperliquidCandles(
  coin: string,
  timeframe: string,
  limit: number,
): Promise<HyperliquidCandle[]> {
  const { candles } = await request<{ candles: HyperliquidCandle[] }>(
    'GET',
    `/candles?coin=${encodeURIComponent(coin)}&timeframe=${timeframe}&limit=${limit}`,
  );
  return candles;
}
