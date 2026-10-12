import nacl from 'tweetnacl';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@privy-io/expo', () => ({ useLoginWithSiws: vi.fn() }));
vi.mock('@wallet-ui/react-native-web3js', () => ({ toUint8Array: vi.fn(), transact: vi.fn() }));

import { detachedSignature } from './use-solana-wallet-login';

describe('detachedSignature', () => {
  const keys = nacl.sign.keyPair();
  const message = new TextEncoder().encode('breadapp.fun wants you to sign in');
  const sig = nacl.sign.detached(message, keys.secretKey);

  it('passes a bare 64-byte signature through', () => {
    expect(detachedSignature(message, sig, keys.publicKey)).toEqual(sig);
  });

  it('extracts the signature from message||signature', () => {
    const signed = new Uint8Array([...message, ...sig]);
    expect(detachedSignature(message, signed, keys.publicKey)).toEqual(sig);
  });

  it('extracts the signature from signature||message (nacl.sign layout)', () => {
    const signed = nacl.sign(message, keys.secretKey);
    expect(detachedSignature(message, signed, keys.publicKey)).toEqual(sig);
  });

  it('throws when nothing verifies', () => {
    expect(() => detachedSignature(message, new Uint8Array(64), keys.publicKey)).toThrow(/does not verify/);
  });
});
