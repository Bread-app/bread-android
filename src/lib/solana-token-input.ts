const SOLANA_BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Pull a Solana mint out of the search field.
 *
 * People often copy either the bare address or a `CA: …` label from a post.
 * Keep the parser deliberately narrow: URLs and surrounding prose should stay
 * normal search queries rather than unexpectedly opening a trade surface.
 */
export function parseSolanaMintInput(value: string): string | null {
  const candidate = value.trim().replace(/^ca\s*:\s*/i, '');
  return SOLANA_BASE58_ADDRESS.test(candidate) ? candidate : null;
}

