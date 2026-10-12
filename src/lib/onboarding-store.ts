import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_PREFIX = 'bread_onboarding_v2_';

export type OnboardingStep = 'x' | 'username' | 'avatar';

// The X link is no longer part of onboarding; users connect X later from Like
// to Buy. `x` stays in the type so a saved state that lists it still parses.
const STEPS: OnboardingStep[] = ['username', 'avatar'];

type OnboardingState = {
  completedSteps: OnboardingStep[];
  completedAt?: string;
};

function emptyState(): OnboardingState {
  return { completedSteps: [] };
}

function sanitizeKey(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${sanitizeKey(userId)}`;
}

async function loadState(userId: string): Promise<OnboardingState> {
  const raw = await SecureStore.getItemAsync(storageKey(userId));
  if (!raw) return emptyState();
  try {
    return JSON.parse(raw) as OnboardingState;
  } catch {
    return emptyState();
  }
}

async function persistState(userId: string, state: OnboardingState) {
  await SecureStore.setItemAsync(storageKey(userId), JSON.stringify(state));
}

export function useOnboardingStatus(userId: string | null) {
  const [state, setState] = useState<OnboardingState>(emptyState());
  const [isLoaded, setIsLoaded] = useState(false);
  const currentUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) {
      // No user yet — reset to empty so we don't leak a previous user's state
      setState(emptyState());
      setIsLoaded(false);
      currentUserIdRef.current = null;
      return;
    }

    // If user changed, reset and reload
    if (currentUserIdRef.current !== userId) {
      setIsLoaded(false);
      currentUserIdRef.current = userId;
    }

    loadState(userId).then((s) => {
      setState(s);
      setIsLoaded(true);
    });
  }, [userId]);

  const isComplete = !!state.completedAt;

  const currentStep: OnboardingStep | null = isComplete
    ? null
    : STEPS.find((s) => !state.completedSteps.includes(s)) ?? null;

  /** Marks `step` done and returns the next incomplete step, if any. */
  const markStepComplete = useCallback(
    async (step: OnboardingStep): Promise<OnboardingStep | null> => {
      const completedSteps = [...new Set([...state.completedSteps, step])];
      const nextStep = STEPS.find((s) => !completedSteps.includes(s)) ?? null;
      if (!userId) return nextStep;
      const next: OnboardingState = { ...state, completedSteps };
      setState(next);
      await persistState(userId, next);
      return nextStep;
    },
    [state, userId],
  );

  const markAllComplete = useCallback(async () => {
    if (!userId) return;
    const next: OnboardingState = {
      completedSteps: [...STEPS],
      completedAt: new Date().toISOString(),
    };
    setState(next);
    await persistState(userId, next);
  }, [userId]);

  const markCompleteFromServer = useCallback(
    async (serverCompletedAt: string | null) => {
      if (!userId) return;
      if (serverCompletedAt && !state.completedAt) {
        const next: OnboardingState = {
          completedSteps: [...STEPS],
          completedAt: serverCompletedAt,
        };
        setState(next);
        await persistState(userId, next);
      }
    },
    [state.completedAt, userId],
  );

  const reset = useCallback(async () => {
    if (!userId) return;
    const next = emptyState();
    setState(next);
    await SecureStore.deleteItemAsync(storageKey(userId));
  }, [userId]);

  return { isLoaded, isComplete, currentStep, markStepComplete, markAllComplete, markCompleteFromServer, reset };
}
