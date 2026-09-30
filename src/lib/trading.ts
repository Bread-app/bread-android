export const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
/** Jupiter's canonical mint for both wrapped and native SOL swaps. */
export const SOLANA_WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';
/** Helius Wallet API pseudo-mint used to identify a wallet's native SOL row. */
export const SOLANA_NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111111';

/** Keep the holdings identity native, but use Jupiter's canonical SOL mint to trade it. */
export function toSolanaTradeMint(mint: string | null | undefined): string | null {
  if (!mint) return null;
  return mint === SOLANA_NATIVE_SOL_MINT ? SOLANA_WRAPPED_SOL_MINT : mint;
}

export function toSmallestUnits(value: string, decimals: number): string | null {
  const normalized = value.trim();

  if (!normalized || decimals < 0 || !Number.isInteger(decimals)) {
    return null;
  }

  if (!/^\d*\.?\d*$/.test(normalized)) {
    return null;
  }

  const [whole = '0', fraction = ''] = normalized.split('.');
  const paddedFraction = `${fraction}${'0'.repeat(decimals)}`.slice(0, decimals);
  const combined = `${whole || '0'}${paddedFraction}`.replace(/^0+(?=\d)/, '');

  if (!/^\d+$/.test(combined)) {
    return null;
  }

  try {
    return BigInt(combined || '0').toString();
  } catch {
    return null;
  }
}

export function fromSmallestUnits(value: string, decimals: number): number | null {
  if (!/^\d+$/.test(value) || decimals < 0 || !Number.isInteger(decimals)) {
    return null;
  }

  const padded = value.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals) || '0';
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  const asString = fraction ? `${whole}.${fraction}` : whole;
  const parsed = Number(asString);

  return Number.isFinite(parsed) ? parsed : null;
}

export function isPositiveSmallestUnitAmount(value: string | null | undefined): boolean {
  if (!value || !/^\d+$/.test(value)) {
    return false;
  }

  try {
    return BigInt(value) > 0n;
  } catch {
    return false;
  }
}

export function hasValidMint(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length >= 32;
}

export function isValidDisplayAmount(value: string): boolean {
  if (!value.trim()) {
    return false;
  }

  if (!/^\d*\.?\d*$/.test(value.trim())) {
    return false;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}
