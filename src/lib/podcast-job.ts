import {
  createPodcastSource,
  getPodcastMoments,
  youTubeVideoId,
  type AppUserPayload,
  type PodcastSourceStatus,
} from './api';
import type { ComposerJobResult, RunSpec } from './composer-progress-store';
import type { PersistedComposerJob } from './composer-job-store';
import { pollPodcastUntilReady } from './podcast-poller';
import { fetchCaptions } from './youtube-captions';

/**
 * The two ways a podcast job can begin: a fresh paste, and a resume.
 *
 * They differ only in their first few seconds. Everything from the `sourceId`
 * onward is the same wait, so it lives in one place — and keeping both here,
 * rather than in the composer screen, is what lets the app-wide progress
 * provider restart a job at launch without importing the composer.
 */

const TITLE = 'Reading the episode';
const READY_STAGE = 'Calls are ready';

/** Stage copy for a server status, so the fresh and resumed paths agree. */
function stageForStatus(status: PodcastSourceStatus): string {
  if (status.status === 'extracting') return 'Listening to the podcast…';
  if (status.status === 'resolving') return 'Matching calls to markets…';
  return 'Queued for analysis…';
}

async function waitAndCollect(
  sourceId: string,
  onStage: (stage: string) => void,
  startedAtMs: number,
  signal?: AbortSignal,
): Promise<ComposerJobResult> {
  const { source, moments } = await pollPodcastUntilReady(sourceId, {
    startedAtMs,
    signal,
    onProgress: (status) => onStage(stageForStatus(status)),
  });
  // Unrouted ideas count as content: the feed shows them with the reason each
  // was turned down, which is far more useful than "nothing found". An episode
  // with nothing at all in it is the one real failure.
  if (moments.length === 0) {
    throw new Error('No investable calls were found in this video.');
  }
  return { kind: 'podcast', source, moments };
}

/**
 * A pasted YouTube link.
 *
 * The captions step is the one part that genuinely cannot be backgrounded:
 * YouTube serves captions to a phone and refuses the server's datacenter IP,
 * so the app fetches them and posts them up. Until `createPodcastSource`
 * returns an id there is nothing on the server to come back to — which is
 * exactly why `markDurable` is called the instant it does.
 */
export function startPodcastSpec(input: { url: string; appUser: AppUserPayload | null }): RunSpec {
  return {
    kind: 'podcast',
    title: TITLE,
    stage: 'Reading captions…',
    readyStage: READY_STAGE,
    run: async (onStage, handle) => {
      const startedAtMs = Date.now();
      const videoId = youTubeVideoId(input.url);
      const transcript = videoId ? await fetchCaptions(videoId) : null;
      onStage('Fetching podcast…');
      // Dev builds skip the analyze-once cache so prompt changes can be
      // re-tested against an already-analyzed episode; prod keeps the cache.
      const created = await createPodcastSource(input.url, input.appUser, transcript, __DEV__);

      // A cache hit is already finished — there is nothing to wait for and
      // nothing to persist, so the overlay simply stays up for one more
      // request and lands straight on the moments.
      if (created.status === 'ready') {
        const { source: cached, moments } = await getPodcastMoments(created.id);
        if (moments.length === 0) {
          throw new Error('No investable calls were found in this video.');
        }
        return { kind: 'podcast', source: cached ?? created, moments };
      }

      // From here the work outlives the app. Everything after this point is
      // recoverable from the id alone.
      handle.markDurable({
        sourceId: created.id,
        title: TITLE,
        readyStage: READY_STAGE,
        startedAtMs,
      });

      onStage('Listening to the podcast…');
      return waitAndCollect(created.id, onStage, startedAtMs, handle.signal);
    },
  };
}

/**
 * A job found on disk at launch — the app was killed while an episode cooked.
 *
 * Starts already durable: no captions, no create, just the wait it was in the
 * middle of. `startedAtMs` is carried over from the original paste so the
 * staleness valve and the banner's progress bar both measure the real age of
 * the work rather than the age of this process.
 */
export function resumePodcastSpec(stored: PersistedComposerJob): RunSpec {
  const startedAtMs = Date.parse(stored.startedAt);
  return {
    kind: 'podcast',
    title: stored.title || TITLE,
    stage: stored.stage || 'Listening to the podcast…',
    readyStage: stored.readyStage || READY_STAGE,
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : Date.now(),
    resume: { sourceId: stored.sourceId },
    run: async (onStage, handle) =>
      waitAndCollect(
        stored.sourceId,
        onStage,
        Number.isFinite(startedAtMs) ? startedAtMs : Date.now(),
        handle.signal,
      ),
  };
}
