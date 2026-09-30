/**
 * Runtime guards for the two-step Phoenix Sandwich open flow.
 *
 * A quote contains a recent Solana blockhash, so it is not durable UI state.
 * Keep the local lifetime deliberately shorter than the chain's blockhash
 * window: the user still needs time to approve the wallet prompt and submit.
 */
export const PERP_QUOTE_MAX_AGE_MS = 15_000;

export type TimedPerpQuote<T> = {
  key: string;
  quote: T;
  receivedAtMs: number;
};

export function freshPerpQuote<T>(
  entry: TimedPerpQuote<T> | null,
  key: string,
  nowMs = Date.now(),
): T | null {
  if (!entry || entry.key !== key) return null;
  if (nowMs - entry.receivedAtMs >= PERP_QUOTE_MAX_AGE_MS) return null;
  return entry.quote;
}

export function isPerpSetupQuote(quote: { preview?: unknown }): boolean {
  const preview = quote.preview;
  return (
    typeof preview === 'object' &&
    preview !== null &&
    'setupRequired' in preview &&
    preview.setupRequired === true
  );
}

/**
 * Newly confirmed isolated children can take a few moments to appear in Phoenix's
 * read API. Poll for the actual entry transaction instead of treating that
 * normal indexing delay as a failed Short.
 *
 * Only the first setup transaction is signed. Setup-shaped responses received
 * while polling are discarded and rebuilt until Phoenix reports the children.
 */
export async function entryQuoteAfterRegistration<T extends { preview?: unknown }>(options: {
  initialQuote: T;
  signAndSubmit: (quote: T) => Promise<void>;
  requestFreshQuote: () => Promise<T>;
  beforeRetry?: () => void;
  retryDelaysMs?: readonly number[];
  sleep?: (delayMs: number) => Promise<void>;
}): Promise<T> {
  if (!isPerpSetupQuote(options.initialQuote)) return options.initialQuote;

  await options.signAndSubmit(options.initialQuote);
  const delays = options.retryDelaysMs ?? [400, 800, 1_200, 2_000];
  const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  }));

  for (const delayMs of delays) {
    options.beforeRetry?.();
    await sleep(delayMs);
    const quote = await options.requestFreshQuote();
    if (!isPerpSetupQuote(quote)) return quote;
  }

  throw new Error("Phoenix isolated-account setup is still settling. Try again in a moment.");
}
