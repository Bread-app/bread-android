import { describe, expect, it } from 'vitest';

import { parseSolanaMintInput } from './solana-token-input';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

describe('parseSolanaMintInput', () => {
  it('accepts a pasted bare Solana mint', () => {
    expect(parseSolanaMintInput(`  ${USDC_MINT}\n`)).toBe(USDC_MINT);
  });

  it('accepts the common CA label copied from a post', () => {
    expect(parseSolanaMintInput(`CA: ${USDC_MINT}`)).toBe(USDC_MINT);
  });

  it('leaves regular searches and malformed base58 alone', () => {
    expect(parseSolanaMintInput('bonk')).toBeNull();
    expect(parseSolanaMintInput('0'.repeat(44))).toBeNull();
    expect(parseSolanaMintInput(`buy ${USDC_MINT}`)).toBeNull();
  });
});

