import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class MockApiError extends Error {
    readonly code: string;
    readonly status?: number;

    constructor(code: string, message: string, status?: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }

  return {
    ApiError: MockApiError,
    getStatus: vi.fn(),
    getMoments: vi.fn(),
    failureToError: vi.fn(),
    appState: 'active' as 'active' | 'background',
    listeners: new Set<(state: 'active' | 'background') => void>(),
  };
});

vi.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return mocks.appState;
    },
    addEventListener: (_event: string, listener: (state: 'active' | 'background') => void) => {
      mocks.listeners.add(listener);
      return { remove: () => mocks.listeners.delete(listener) };
    },
  },
}));

vi.mock('./api', () => ({
  ApiError: mocks.ApiError,
  getPodcastSourceStatus: mocks.getStatus,
  getPodcastMoments: mocks.getMoments,
  podcastFailureToError: mocks.failureToError,
}));

// Vitest hoists the mocks above this import; keeping it here makes the mocked
// React Native AppState the module's first runtime dependency.
// eslint-disable-next-line import/first
import { pollPodcastUntilReady } from './podcast-poller';

const pending = { id: 'source-1', status: 'extracting', statusReason: null };
const ready = { id: 'source-1', status: 'ready', statusReason: null };
const moments = [{ id: 'moment-1' }];

function setAppState(state: 'active' | 'background') {
  mocks.appState = state;
  for (const listener of [...mocks.listeners]) listener(state);
}

describe('pollPodcastUntilReady', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.appState = 'active';
  });

  afterEach(() => vi.useRealTimers());

  it('polls live work and returns its moments when ready', async () => {
    mocks.getStatus.mockResolvedValueOnce(pending).mockResolvedValueOnce(ready);
    mocks.getMoments.mockResolvedValue({ moments });

    const result = pollPodcastUntilReady('source-1', { intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(100);

    await expect(result).resolves.toEqual({ source: ready, moments });
    expect(mocks.getStatus).toHaveBeenCalledTimes(2);
  });

  it('does not poll in the background and checks immediately on foreground', async () => {
    mocks.appState = 'background';
    mocks.getStatus.mockResolvedValue(ready);
    mocks.getMoments.mockResolvedValue({ moments });

    const result = pollPodcastUntilReady('source-1', { intervalMs: 10_000 });
    await Promise.resolve();
    expect(mocks.getStatus).not.toHaveBeenCalled();

    setAppState('active');

    await expect(result).resolves.toEqual({ source: ready, moments });
    expect(mocks.getStatus).toHaveBeenCalledTimes(1);
  });

  it('retries a transient moments fetch instead of losing a ready job', async () => {
    mocks.getStatus.mockResolvedValue(ready);
    mocks.getMoments
      .mockRejectedValueOnce(new mocks.ApiError('NETWORK_ERROR', 'offline'))
      .mockResolvedValueOnce({ moments });

    const result = pollPodcastUntilReady('source-1', { intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(200);

    await expect(result).resolves.toEqual({ source: ready, moments });
    expect(mocks.getMoments).toHaveBeenCalledTimes(2);
  });

  it('aborts a background wait and removes its AppState listener', async () => {
    mocks.appState = 'background';
    const controller = new AbortController();
    const result = pollPodcastUntilReady('source-1', { signal: controller.signal });
    await Promise.resolve();
    expect(mocks.listeners.size).toBe(1);

    controller.abort();

    await expect(result).rejects.toMatchObject({ code: 'ABORTED' });
    expect(mocks.listeners.size).toBe(0);
  });

  it('fails fast for a permanent missing-source response', async () => {
    mocks.getStatus.mockRejectedValue(new mocks.ApiError('HTTP_ERROR', 'Not found', 404));

    await expect(pollPodcastUntilReady('missing')).rejects.toMatchObject({ status: 404 });
  });
});
