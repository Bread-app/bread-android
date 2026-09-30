import { Keypair } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import {
  associatedTokenAddress,
  buildUsdcDepositInstructions,
  USDC_MINT,
  usdcToBaseUnits,
} from './usdc-transfer';

describe('usdcToBaseUnits', () => {
  it('converts without float rounding', () => {
    expect(usdcToBaseUnits('100')).toBe(100_000_000n);
    expect(usdcToBaseUnits('0.1')).toBe(100_000n);
    expect(usdcToBaseUnits('12.345678')).toBe(12_345_678n);
  });

  it('rejects junk and over-precise amounts', () => {
    expect(() => usdcToBaseUnits('')).toThrow();
    expect(() => usdcToBaseUnits('1e3')).toThrow();
    expect(() => usdcToBaseUnits('-1')).toThrow();
    expect(() => usdcToBaseUnits('0.0000001')).toThrow();
  });
});

describe('buildUsdcDepositInstructions', () => {
  const from = Keypair.generate().publicKey;
  const to = Keypair.generate().publicKey;

  it('creates the destination ATA idempotently, then transferChecked', () => {
    const [create, transfer] = buildUsdcDepositInstructions({ from, to, amount: 5_000_000n });

    expect(create.data).toEqual(Buffer.from([1]));
    expect(create.keys[1].pubkey.equals(associatedTokenAddress(to, USDC_MINT))).toBe(true);
    expect(create.keys[2].pubkey.equals(to)).toBe(true);

    expect(transfer.data[0]).toBe(12);
    expect(transfer.data.readBigUInt64LE(1)).toBe(5_000_000n);
    expect(transfer.data[9]).toBe(6);
    expect(transfer.keys[0].pubkey.equals(associatedTokenAddress(from, USDC_MINT))).toBe(true);
    expect(transfer.keys[3]).toMatchObject({ isSigner: true });
    expect(transfer.keys[3].pubkey.equals(from)).toBe(true);
  });

  it('refuses a zero amount', () => {
    expect(() => buildUsdcDepositInstructions({ from, to, amount: 0n })).toThrow();
  });
});
