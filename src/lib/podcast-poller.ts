import { AppState, type AppStateStatus } from 'react-native';

import {
  ApiError,
  getPodcastMoments,
  getPodcastSourceStatus,
  podcastFailureToError,
  type PodcastMoment,
  type PodcastSourceStatus,
} from './api';

/**
 * Wait for a podcast analysis to land, without pinning the user to a screen.
 *
 * The old waiter was a bare timer loop with a ten-minute cap. Both were wrong
 * once the work became durable: the cap measured wall-clock including time
 * spent backgrounded (where iOS suspends the timer anyway), and it was shorter
 * than the server task's own hour-long ceiling — so the client routinely gave
 * up on work that went on to finish and persist.
 *
 * What replaces it:
 * - Ticks only while the app is foregrounded, and ticks IMMEDIATELY on the
 *   return to foreground rather than waiting out the interval.
 * - No timeout while the server reports a live status. The server is the
 *   authority on whether the job is still alive.
 * - Network errors back off instead of killing the job. A tunnel must not lose
 *   an analysis that is still running fine on the server.
 */

const DEFAULT_INTERVAL_MS = 3000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Beyond this, stop believing a non-terminal status.
 *
 * The one case that needs it: a cancelled Trigger run never fires `onFailure`,
 * so its source stays `pending` forever and no notification is ever sent. A
 * server-side sweeper is the real fix; until then this is what stops the banner
 * claiming an episode is still cooking tomorrow morning.
 */
export const PODCAST_STALE_AFTER_MS = 90 * 60 * 1000;

function abortError(): ApiError {
  return new ApiError('ABORTED', 'Podcast analysis was cancelled.');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Resolves now if foregrounded, else on the next return to foreground. */
function whenActive(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (AppState.currentState === 'active') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'active') return;
      signal?.removeEventListener('abort', onAbort);
      sub.remove();
      resolve();
    });
    const onAbort = () => {
      sub.remove();
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function retryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  if (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT') return true;
  if (error.code !== 'HTTP_ERROR') return false;
  return error.status === 408 || error.status === 429 || (error.status != null && error.status >= 500);
}

export async function pollPodcastUntilReady(
  sourceId: string,
  options: {
    onProgress?: (status: PodcastSourceStatus) => void;
    intervalMs?: number;
    /** Epoch ms the job began, for the staleness valve. Defaults to now. */
    startedAtMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<{ source: PodcastSourceStatus; moments: PodcastMoment[] }> {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const startedAtMs = options.startedAtMs ?? Date.now();
  let consecutiveErrors = 0;

  for (;;) {
    if (options.signal?.aborted) throw abortError();

    // Parked here for the whole time the app is backgrounded. Nothing polls,
    // nothing times out, and the push is what reaches the user meanwhile.
    await whenActive(options.signal);
    if (options.signal?.aborted) throw abortError();

    let status: PodcastSourceStatus;
    try {
      status = await getPodcastSourceStatus(sourceId, options.signal);
      consecutiveErrors = 0;
    } catch (error) {
      if (options.signal?.aborted) throw abortError();
      if (!retryable(error)) throw error;
      // Offline, or the request was cut off mid-flight. The analysis is still
      // running on the server; back off and ask again.
      consecutiveErrors += 1;
      await sleep(
        Math.min(MAX_BACKOFF_MS, intervalMs * 2 ** Math.min(consecutiveErrors, 4)),
        options.signal,
      );
      continue;
    }

    options.onProgress?.(status);

    if (status.status === 'ready') {
      try {
        const { moments } = await getPodcastMoments(sourceId, options.signal);
        return { source: status, moments };
      } catch (error) {
        if (options.signal?.aborted) throw abortError();
        if (!retryable(error)) throw error;
        consecutiveErrors += 1;
        await sleep(
          Math.min(MAX_BACKOFF_MS, intervalMs * 2 ** Math.min(consecutiveErrors, 4)),
          options.signal,
        );
        continue;
      }
    }
    if (status.status === 'failed') throw podcastFailureToError(status);

    if (Date.now() - startedAtMs > PODCAST_STALE_AFTER_MS) {
      throw new ApiError(
        'TIMEOUT',
        "This is taking longer than expected. Check back from the episode later.",
      );
    }

    await sleep(intervalMs, options.signal);
  }
}
