import * as SecureStore from 'expo-secure-store';

const STORAGE_PREFIX = 'phoenix_position_leverage_v1';
const SECURE_STORE_KEY_RE = /[^A-Za-z0-9._-]/g;
/** Matches the backend's sanity ceiling; the real cap is the market's own tier. */
const MAX_LEVERAGE = 100;

/**
 * Leverage is a continuous slider value now (1x … the market's max, in 0.1
 * steps), so this is a range check rather than the old 1/2/3/5 whitelist.
 */
function isSupportedLeverage(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= MAX_LEVERAGE;
}

/** Rounds to the slider's 0.1 resolution, matching what the backend stores. */
export function roundLeverage(value: number): number {
  return Math.round(value * 10) / 10;
}

/** "2x", "5.6x" — trims the decimal when the multiplier is whole. */
export function formatLeverage(value: number): string {
  const rounded = roundLeverage(value);
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}x`;
}

export type PhoenixPositionTradeMetadata = {
  leverage: number;
  /** User-entered collateral used to size the confirmed order. */
  marginUsd: number | null;
};

export type PhoenixPositionLeverageLedger = Record<string, PhoenixPositionTradeMetadata>;

function storageKey(walletAddress: string): string {
  const walletKey = walletAddress.trim().replace(SECURE_STORE_KEY_RE, '_');
  return `${STORAGE_PREFIX}.${walletKey || 'unknown'}`;
}

export async function loadPhoenixPositionLeverages(
  walletAddress: string,
): Promise<PhoenixPositionLeverageLedger> {
  try {
    const raw = await SecureStore.getItemAsync(storageKey(walletAddress));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([symbol, value]) => {
        // v1 stored only a number. Keep reading it so existing installs migrate
        // without losing the selected multiplier.
        const leverage =
          typeof value === 'number'
            ? value
            : value && typeof value === 'object' && 'leverage' in value
              ? (value as { leverage?: unknown }).leverage
              : null;
        if (!isSupportedLeverage(leverage)) return [];
        const rawMargin =
          value && typeof value === 'object' && 'marginUsd' in value
            ? (value as { marginUsd?: unknown }).marginUsd
            : null;
        const marginUsd =
          typeof rawMargin === 'number' && Number.isFinite(rawMargin) && rawMargin > 0
            ? rawMargin
            : null;
        return [[symbol.trim().toUpperCase(), { leverage, marginUsd }]];
      }),
    );
  } catch {
    return {};
  }
}

/** Remember Bread's selected multiplier only after the market order confirms. */
export async function recordPhoenixPositionLeverage(
  walletAddress: string,
  symbol: string,
  leverage: number,
  marginUsd: number,
): Promise<void> {
  if (
    !walletAddress.trim() ||
    !symbol.trim() ||
    !isSupportedLeverage(leverage) ||
    !Number.isFinite(marginUsd) ||
    marginUsd <= 0
  ) {
    return;
  }

  try {
    const ledger = await loadPhoenixPositionLeverages(walletAddress);
    ledger[symbol.trim().toUpperCase()] = { leverage: roundLeverage(leverage), marginUsd };
    await SecureStore.setItemAsync(storageKey(walletAddress), JSON.stringify(ledger));
  } catch {
    // Display metadata is best-effort and must never make a confirmed trade fail.
  }
}

/**
 * Migrate a position opened before leverage persistence existed. This is only
 * safe for a single-position cross account: entry notional divided by deposited
 * collateral approximates the multiplier selected in Bread. Snapped to the
 * slider's 0.1 resolution rather than a fixed list — any multiplier in the
 * market's range is selectable now.
 */
export function inferPhoenixPositionLeverage(
  entryNotionalUsd: number,
  collateralBalanceUsd: number,
): number | null {
  if (
    !Number.isFinite(entryNotionalUsd) ||
    !Number.isFinite(collateralBalanceUsd) ||
    entryNotionalUsd <= 0 ||
    collateralBalanceUsd <= 0
  ) {
    return null;
  }

  const ratio = roundLeverage(entryNotionalUsd / collateralBalanceUsd);
  return Math.min(MAX_LEVERAGE, Math.max(1, ratio));
}
