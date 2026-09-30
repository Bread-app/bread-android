import * as SecureStore from 'expo-secure-store';

/**
 * The one in-flight composer job, on disk.
 *
 * A podcast analysis runs for minutes on the server and finishes whether or
 * not this app is alive. Everything else about the job — stage labels, the
 * moments, the built markets — is refetchable from the `sourceId`, so that id
 * is the entire durable payload. Persisting it is what turns "don't leave the
 * screen" into "we'll notify you".
 *
 * Deliberately NOT persisted: the transcript. It can be megabytes and the iOS
 * keychain is not a blob store.
 */

const STORAGE_PREFIX = 'composer_job_v1';
const SECURE_STORE_KEY_RE = /[^A-Za-z0-9._-]/g;
const storageOperations = new Map<string, Promise<void>>();

export type PersistedComposerJob = {
  v: 1;
  /** Only podcast jobs are resumable — a text thesis has no durable server id. */
  kind: 'podcast';
  sourceId: string;
  title: string;
  stage: string;
  readyStage: string;
  /** ISO. The banner needs the job's age to draw an honest progress bar. */
  startedAt: string;
};

// Scoped per identity: an account switch must not rehydrate someone else's
// episode into the banner. `did:privy:…` contains colons, which SecureStore
// keys cannot hold.
function storageKey(privyUserId: string | null | undefined) {
  const userKey = (privyUserId ?? '').trim().replace(SECURE_STORE_KEY_RE, '_');
  return `${STORAGE_PREFIX}.${userKey || 'anonymous'}`;
}

/**
 * SecureStore calls are asynchronous and may finish out of order. Serialize
 * writes per identity so a slow stage save cannot land after the terminal
 * clear and resurrect a job that already finished.
 */
function enqueueStorageOperation(key: string, operation: () => Promise<void>): Promise<void> {
  const previous = storageOperations.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  const settled = next.catch(() => {});
  storageOperations.set(key, settled);
  void settled.then(() => {
    if (storageOperations.get(key) === settled) storageOperations.delete(key);
  });
  return next;
}

function isPersistedJob(value: unknown): value is PersistedComposerJob {
  if (!value || typeof value !== 'object') return false;
  const job = value as Record<string, unknown>;
  return (
    job.v === 1 &&
    job.kind === 'podcast' &&
    typeof job.sourceId === 'string' &&
    job.sourceId.length > 0 &&
    typeof job.title === 'string' &&
    typeof job.stage === 'string' &&
    typeof job.readyStage === 'string' &&
    typeof job.startedAt === 'string' &&
    Number.isFinite(Date.parse(job.startedAt))
  );
}

/** Best-effort: failing to remember a job costs a resume, never the job. */
export async function saveComposerJob(
  privyUserId: string | null | undefined,
  job: PersistedComposerJob,
): Promise<void> {
  const key = storageKey(privyUserId);
  await enqueueStorageOperation(key, async () => {
    try {
      await SecureStore.setItemAsync(key, JSON.stringify(job));
    } catch {
      // Ignored — the in-memory job is still running.
    }
  });
}

/** A corrupt or unreadable record is non-fatal: there is simply nothing to resume. */
export async function readComposerJob(
  privyUserId: string | null | undefined,
): Promise<PersistedComposerJob | null> {
  const key = storageKey(privyUserId);
  try {
    await storageOperations.get(key);
    const raw = await SecureStore.getItemAsync(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPersistedJob(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearComposerJob(privyUserId: string | null | undefined): Promise<void> {
  const key = storageKey(privyUserId);
  await enqueueStorageOperation(key, async () => {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // Ignored.
    }
  });
}

/**
 * Drop the stored job if it is the one for `sourceId`.
 *
 * Used by the push-tap handler: once the user is reading the episode, a banner
 * still reporting "listening to the podcast" behind it is stale news. Takes the
 * id rather than the job so the notification hook needs no composer context.
 */
export async function clearComposerJobForSource(
  privyUserId: string | null | undefined,
  sourceId: string,
): Promise<boolean> {
  const stored = await readComposerJob(privyUserId);
  if (!stored || stored.sourceId !== sourceId) return false;
  await clearComposerJob(privyUserId);
  return true;
}
