import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { completeXOauth2, startXOauth2, syncXFollowing } from '@/lib/api';

export type XLinkOutcome = Awaited<ReturnType<typeof completeXOauth2>>;

type XRedirect = { code: string | null; state: string | null; error: string | null };

/**
 * How long a dismissed Android browser waits for X's redirect to arrive. Chrome
 * Custom Tabs reports "closed" and the app receives `bread://x-oauth2` as two
 * separate events, and the close can land first.
 */
const ANDROID_REDIRECT_GRACE_MS = 3000;

let waitingForRedirect: ((redirect: XRedirect) => void) | null = null;
let earlyRedirect: { redirect: XRedirect; at: number } | null = null;
let linkInFlight = false;

/**
 * Called by the `x-oauth2` route when X's redirect opens the app. Returns true
 * when a `linkXAccount` call in this process takes it from here; false means
 * nobody is waiting (Android killed the app while the browser was open), so
 * the caller has to finish the link itself.
 */
export function deliverXOauthRedirect(redirect: XRedirect): boolean {
  if (waitingForRedirect) {
    waitingForRedirect(redirect);
    return true;
  }
  earlyRedirect = { redirect, at: Date.now() };
  return linkInFlight;
}

function waitForDeliveredRedirect(timeoutMs: number): Promise<XRedirect | null> {
  if (earlyRedirect && Date.now() - earlyRedirect.at < timeoutMs * 4) {
    const { redirect } = earlyRedirect;
    earlyRedirect = null;
    return Promise.resolve(redirect);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waitingForRedirect = null;
      resolve(null);
    }, timeoutMs);
    waitingForRedirect = (redirect) => {
      clearTimeout(timer);
      waitingForRedirect = null;
      resolve(redirect);
    };
  });
}

function redirectFromUrl(url: string): XRedirect {
  const params = new URL(url).searchParams;
  return { code: params.get('code'), state: params.get('state'), error: params.get('error') };
}

/** Exchange X's redirect for a connection; kicks off the following import. */
export async function completeXRedirect(redirect: XRedirect): Promise<XLinkOutcome> {
  if (redirect.error || !redirect.code || !redirect.state) {
    throw new Error("X authorization didn't complete. Please try again.");
  }
  const outcome = await completeXOauth2({ code: redirect.code, state: redirect.state });
  if (outcome.connected) {
    void syncXFollowing().catch((err) => {
      console.warn('[x-link] following import failed', err);
    });
  }
  return outcome;
}

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
  linkInFlight = true;
  earlyRedirect = null;
  try {
    const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, callbackUrl);
    let redirect = result.type === 'success' && result.url ? redirectFromUrl(result.url) : null;
    if (!redirect && Platform.OS === 'android') {
      redirect = await waitForDeliveredRedirect(ANDROID_REDIRECT_GRACE_MS);
    }
    if (!redirect) return null;
    return await completeXRedirect(redirect);
  } finally {
    linkInFlight = false;
    earlyRedirect = null;
  }
}
