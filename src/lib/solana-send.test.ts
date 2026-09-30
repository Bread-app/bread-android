import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  sendSignedSolanaTransaction,
  setAuthTokenProvider,
} from './api';

const response = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('sendSignedSolanaTransaction', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
    setAuthTokenProvider(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rechecks a fast pending submission with the exact same signed transaction', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ signature: 'sig-1', status: 'pending' }))
      .mockResolvedValueOnce(response({ signature: 'sig-1', status: 'confirmed' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      sendSignedSolanaTransaction('signed-base64', {
        skipSimulation: true,
        fastConfirm: true,
        requireConfirmed: true,
      }),
    ).resolves.toEqual({ signature: 'sig-1', status: 'confirmed' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(firstBody).toMatchObject({
      signedTransaction: 'signed-base64',
      skipSimulation: true,
      fastConfirm: true,
    });
    expect(secondBody).toEqual({
      signedTransaction: 'signed-base64',
      skipSimulation: true,
    });
  });

  it('does not make a second request when the fast response already landed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      signature: 'sig-processed',
      status: 'processed',
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      sendSignedSolanaTransaction('signed-base64', {
        fastConfirm: true,
        requireConfirmed: true,
      }),
    ).resolves.toEqual({ signature: 'sig-processed', status: 'processed' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves the signature when normal confirmation still reports pending', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ signature: 'sig-pending', status: 'pending' }))
      .mockResolvedValueOnce(response({ signature: 'sig-pending', status: 'pending' }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = sendSignedSolanaTransaction('signed-base64', {
      fastConfirm: true,
      requireConfirmed: true,
    });

    await expect(promise).rejects.toMatchObject({
      code: 'TRANSACTION_PENDING',
      body: { signature: 'sig-pending', status: 'pending' },
    } satisfies Partial<ApiError>);
  });

  it('preserves the accepted signature when the confirmation request fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ signature: 'sig-accepted', status: 'pending' }))
      .mockRejectedValueOnce(new Error('confirmation network failed'));
    vi.stubGlobal('fetch', fetchMock);

    const promise = sendSignedSolanaTransaction('signed-base64', {
      fastConfirm: true,
      requireConfirmed: true,
    });

    await expect(promise).rejects.toMatchObject({
      code: 'TRANSACTION_PENDING',
      body: { signature: 'sig-accepted', status: 'pending' },
    } satisfies Partial<ApiError>);
  });
});
