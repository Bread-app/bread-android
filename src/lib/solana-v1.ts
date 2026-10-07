import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";

/**
 * Solana Transaction V1 (SIMD-0385, live on mainnet 2026-09-15) without a
 * library upgrade.
 *
 * web3.js can't serialize a V1 message, but Privy never parses one: its
 * embedded `signTransaction` calls `message.serialize()` on the object it is
 * handed, signs those bytes, and calls `addSignature`. So a thin wrapper over
 * the wire bytes is all a V1 transaction needs to be signed here.
 *
 * Wire layout: the message, then one 64-byte signature per required signer in
 * address order, with no count prefix. Inside the message, byte 1 is
 * num_required_signatures, byte 41 is NumAddresses, and the addresses start at
 * byte 42 (version 1 + header 3 + config mask 4 + blockhash 32 + numIx 1 + numAddr 1).
 */
export const V1_VERSION_BYTE = 0x81;
const ADDRESSES_OFFSET = 42;

export function isV1Wire(bytes: Uint8Array): boolean {
  return bytes.length > ADDRESSES_OFFSET && bytes[0] === V1_VERSION_BYTE;
}

export type V1Transaction = {
  readonly version: 1;
  readonly message: { staticAccountKeys: PublicKey[]; serialize: () => Uint8Array };
  addSignature: (publicKey: PublicKey, signature: Uint8Array) => void;
  serialize: () => Uint8Array;
};

export function wrapV1Transaction(wire: Uint8Array): V1Transaction {
  if (!isV1Wire(wire)) throw new Error("Not a V1 transaction.");
  const bytes = Uint8Array.from(wire);
  const signerCount = bytes[1];
  const messageLength = bytes.length - signerCount * 64;
  const addressCount = bytes[41];
  if (messageLength < ADDRESSES_OFFSET + addressCount * 32 || signerCount > addressCount) {
    throw new Error("Malformed V1 transaction.");
  }
  const keys = Array.from({ length: addressCount }, (_, i) => {
    const start = ADDRESSES_OFFSET + i * 32;
    return new PublicKey(bytes.subarray(start, start + 32));
  });
  const messageBytes = bytes.slice(0, messageLength);
  return {
    version: 1,
    message: { staticAccountKeys: keys, serialize: () => messageBytes },
    addSignature(publicKey, signature) {
      const index = keys.findIndex((key) => key.equals(publicKey));
      if (index < 0 || index >= signerCount) throw new Error("Key is not a signer of this transaction.");
      if (signature.length !== 64) throw new Error("Signature must be 64 bytes.");
      bytes.set(signature, messageLength + index * 64);
    },
    serialize: () => bytes,
  };
}

const CONFIG_COMPUTE_UNIT_LIMIT = 1 << 2;
const CONFIG_LOADED_ACCOUNTS_DATA_SIZE = 1 << 3;

/**
 * A one-instruction V1 transaction: `programId` invoked with `signer` as its
 * only (read-only, signing) account. Exists for the dev V1 probe — production
 * V1 transactions are built server-side.
 */
export function buildV1SingleInstruction(opts: {
  signer: PublicKey;
  programId: PublicKey;
  data: Uint8Array;
  recentBlockhash: PublicKey;
  computeUnitLimit: number;
  loadedAccountsDataSizeLimit: number;
}): Uint8Array {
  const u32 = (value: number) => {
    const out = Buffer.alloc(4);
    out.writeUInt32LE(value, 0);
    return out;
  };
  const u16 = (value: number) => {
    const out = Buffer.alloc(2);
    out.writeUInt16LE(value, 0);
    return out;
  };
  const message = Buffer.concat([
    Buffer.from([V1_VERSION_BYTE, 1, 0, 1]), // 1 signer (fee payer), 1 read-only program
    u32(CONFIG_COMPUTE_UNIT_LIMIT | CONFIG_LOADED_ACCOUNTS_DATA_SIZE),
    opts.recentBlockhash.toBuffer(),
    Buffer.from([1, 2]), // 1 instruction, 2 addresses
    opts.signer.toBuffer(),
    opts.programId.toBuffer(),
    u32(opts.computeUnitLimit),
    u32(opts.loadedAccountsDataSizeLimit),
    Buffer.from([1, 1]), u16(opts.data.length), // program index 1, 1 account
    Buffer.from([0]), Buffer.from(opts.data), // account index 0 (signer)
  ]);
  return Uint8Array.from(Buffer.concat([message, Buffer.alloc(64)]));
}
