import { usePrivy } from "@privy-io/expo";
import { useRouter } from "expo-router";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  appUserPayloadFromPrivyUser,
  getUserProfile,
  type AppUserPayload,
  type DailyPrompt,
  type Sandwich,
} from "@/lib/api";
import { getAnonymousSocialId } from "@/lib/social-identity";

type OpenOptions = {
  /**
   * Fired with the freshly created sandwich so the originating list (the feed)
   * can prepend it and surface the success toast — mirroring the old
   * `onCreated` host prop on the bottom-sheet composer.
   */
  onCreated?: (sandwich: Sandwich) => void;
  /**
   * Open straight at review with this sandwich's basket copied in, published
   * as the viewer's own with a link back ("I'd do this differently").
   */
  remixOf?: Sandwich;
  /** Open with this daily question above the input; the result answers it. */
  prompt?: DailyPrompt;
  /**
   * Open straight on the text prompt with this thesis typed in — a news
   * headline the reader wants to trade. Editable before it cooks.
   */
  seedText?: string;
};

type SandwichComposerContextValue = {
  appUser: AppUserPayload | null;
  anonymousId: string | null;
  avatarUrl: string | null;
  /** Push the full-screen "New sandwich" composer route. */
  open: (options?: OpenOptions) => void;
  /**
   * Push the composer again without touching the registered `onCreated` — what
   * the background-progress banner uses to bring the user back to a job that
   * finished while they were somewhere else, with the feed still listening.
   */
  reopen: () => void;
  /** Pop the composer route. */
  close: () => void;
  /** Hand the created sandwich back to whoever opened the composer. */
  notifyCreated: (sandwich: Sandwich) => void;
  /**
   * The sandwich the composer was opened to remix, or null. Read, not taken:
   * it's a ref the screen reads while seeding its first render, and a plain
   * `open()` / `reopen()` is what clears it.
   */
  getRemixSource: () => Sandwich | null;
  /** The daily question the composer was opened with, or null. Same rules. */
  getPromptSource: () => DailyPrompt | null;
  /** Text the composer was opened pre-filled with, or null. Same rules. */
  getSeedText: () => string | null;
};

const SandwichComposerContext =
  createContext<SandwichComposerContextValue | null>(null);

/**
 * Owns the single, app-wide "New sandwich" composer *screen* (the route at
 * `(app)/sandwich-composer`). The feed FAB calls {@link useSandwichComposer}().
 * open({ onCreated }) to push it; this provider resolves the viewer identity
 * (appUser + anonymousId) once and routes the created sandwich back to the
 * opener — replacing the prop-threading the old `ComposerSheet` needed.
 *
 * Mounted in `(app)/_layout` *inside* the wallet/toast providers and *above* the
 * router Stack, so both the tab screens (callers) and the composer route consume
 * the same context.
 */
export function SandwichComposerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user } = usePrivy();
  const appUser = useMemo(() => appUserPayloadFromPrivyUser(user), [user]);
  const onCreatedRef = useRef<OpenOptions["onCreated"]>(undefined);
  const remixRef = useRef<Sandwich | null>(null);
  const promptRef = useRef<DailyPrompt | null>(null);
  const seedTextRef = useRef<string | null>(null);
  const [anonymousId, setAnonymousId] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAnonymousId(null);
    void getAnonymousSocialId(appUser?.privyUserId).then((value) => {
      if (!cancelled) setAnonymousId(value);
    });
    return () => {
      cancelled = true;
    };
  }, [appUser?.privyUserId]);

  useEffect(() => {
    setAvatarUrl(null);
    if (!appUser?.privyUserId) return;
    let cancelled = false;
    void getUserProfile(appUser.privyUserId).then((profile) => {
      if (!cancelled && profile?.avatarUrl) setAvatarUrl(profile.avatarUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [appUser?.privyUserId]);

  const open = useCallback(
    (options?: OpenOptions) => {
      onCreatedRef.current = options?.onCreated;
      remixRef.current = options?.remixOf ?? null;
      promptRef.current = options?.prompt ?? null;
      seedTextRef.current = options?.seedText?.trim() || null;
      router.push("/sandwich-composer");
    },
    [router],
  );

  const reopen = useCallback(() => {
    // The banner reopens a running generation job, never a remix. The prompt is
    // kept: a job started from a question still answers it when it lands.
    remixRef.current = null;
    seedTextRef.current = null;
    router.push("/sandwich-composer");
  }, [router]);

  const getRemixSource = useCallback(() => remixRef.current, []);
  const getPromptSource = useCallback(() => promptRef.current, []);
  const getSeedText = useCallback(() => seedTextRef.current, []);

  const close = useCallback(() => {
    router.back();
  }, [router]);

  const notifyCreated = useCallback((sandwich: Sandwich) => {
    onCreatedRef.current?.(sandwich);
  }, []);

  const value = useMemo(
    () => ({
      appUser,
      anonymousId,
      avatarUrl,
      open,
      reopen,
      close,
      notifyCreated,
      getRemixSource,
      getPromptSource,
      getSeedText,
    }),
    [appUser, anonymousId, avatarUrl, open, reopen, close, notifyCreated, getRemixSource, getPromptSource, getSeedText],
  );

  return (
    <SandwichComposerContext.Provider value={value}>
      {children}
    </SandwichComposerContext.Provider>
  );
}

export function useSandwichComposer(): SandwichComposerContextValue {
  const ctx = useContext(SandwichComposerContext);
  if (!ctx) {
    throw new Error(
      "useSandwichComposer must be used within a SandwichComposerProvider",
    );
  }
  return ctx;
}

/**
 * The composer, or null outside its provider. For components that may render
 * inside a portalled sheet (the feed card in the stock detail sheet), where the
 * context is out of reach and the throwing hook would be a render error.
 */
export function useOptionalSandwichComposer(): SandwichComposerContextValue | null {
  return useContext(SandwichComposerContext);
}
