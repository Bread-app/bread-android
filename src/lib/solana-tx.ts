import { Buffer } from "buffer";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

/**
 * True when `value` is a well-formed Solana address (a valid base58 ed25519
 * public key). Used to validate a withdrawal destination before sending.
 */
export function isValidSolanaAddress(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    void new PublicKey(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decode a base64 transaction returned by the backend. Jupiter hands back
 * versioned transactions, but legacy ones are tolerated as a fallback.
 */
export function deserializeTransaction(
  base64Transaction: string,
): Transaction | VersionedTransaction {
  const bytes = Buffer.from(base64Transaction, "base64");

  try {
    return VersionedTransaction.deserialize(bytes);
  } catch {
    return Transaction.from(bytes);
  }
}

/** Re-encode a signed transaction to base64 for submission via /api/solana/send. */
export function serializeSignedTransaction(
  transaction: Transaction | VersionedTransaction,
): string {
  const bytes =
    transaction instanceof VersionedTransaction
      ? transaction.serialize()
      : transaction.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        });

  return Buffer.from(bytes).toString("base64");
}
