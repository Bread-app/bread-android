import { PublicKey, TransactionInstruction } from '@solana/web3.js';

export const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
export const USDC_DECIMALS = 6;

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvQ9ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111');

export function associatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

/** Whole-dollar string ("12.5") → base units, without float rounding. */
export function usdcToBaseUnits(amount: string): bigint {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error('Enter a valid amount');
  const [whole, frac = ''] = trimmed.split('.');
  if (frac.length > USDC_DECIMALS) throw new Error('USDC has at most 6 decimals');
  return BigInt(whole) * 10n ** BigInt(USDC_DECIMALS) + BigInt(frac.padEnd(USDC_DECIMALS, '0'));
}

/**
 * Instructions moving USDC from an external (MWA) wallet into the user's Bread
 * wallet. The destination ATA is created idempotently, paid by the sender, so
 * a brand-new Bread wallet can receive its first deposit.
 */
export function buildUsdcDepositInstructions(opts: {
  from: PublicKey;
  to: PublicKey;
  amount: bigint;
}): TransactionInstruction[] {
  const { from, to, amount } = opts;
  if (amount <= 0n) throw new Error('Amount must be greater than zero');

  const source = associatedTokenAddress(from, USDC_MINT);
  const destination = associatedTokenAddress(to, USDC_MINT);

  const createDestination = new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: from, isSigner: true, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: to, isSigner: false, isWritable: false },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    // 1 = CreateIdempotent
    data: Buffer.from([1]),
  });

  // 12 = TransferChecked: [ix, amount u64 LE, decimals u8]
  const data = Buffer.alloc(10);
  data.writeUInt8(12, 0);
  data.writeBigUInt64LE(amount, 1);
  data.writeUInt8(USDC_DECIMALS, 9);

  const transfer = new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: from, isSigner: true, isWritable: false },
    ],
    data,
  });

  return [createDestination, transfer];
}
