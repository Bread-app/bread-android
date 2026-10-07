import * as WebBrowser from 'expo-web-browser';

import { completeXOauth2, startXOauth2, syncXFollowing } from '@/lib/api';

export type XLinkOutcome = Awaited<ReturnType<typeof completeXOauth2>>;

/**
 * Run Bread's own X OAuth 2.0 + PKCE grant (separate from Privy login). The
 * server requests `like.read` (Like to Buy) and `follows.read` (feed seeding)
 * in one consent screen. Resolves null when the user dismisses the browser.
 *
 * On success it kicks off the following-list import in the background — a
 * slow or failed import must never block the link itself.
 */
export async function linkXAccount(): Promise<XLinkOutcome | null> {
  const { authorizeUrl, callbackUrl } = await startXOauth2();
  const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, callbackUrl);
  if (result.type !== 'success' || !result.url) return null;

  const returned = new URL(result.url);
  const code = returned.searchParams.get('code');
  const state = returned.searchParams.get('state');
  if (returned.searchParams.get('error') || !code || !state) {
    throw new Error("X authorization didn't complete. Please try again.");
  }

  const outcome = await completeXOauth2({ code, state });
  if (outcome.connected) {
    void syncXFollowing().catch((err) => {
      console.warn('[x-link] following import failed', err);
    });
  }
  return outcome;
}
