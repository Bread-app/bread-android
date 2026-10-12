import { useIsFocused } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { InteractionManager, View } from 'react-native';

import { useThemeStore } from '@/lib/theme-store';
import { ProfileScreen } from '@/screens/profile-screen';

/** How long after launch Profile waits before warming itself in the background. */
const BACKGROUND_MOUNT_DELAY_MS = 2500;

/**
 * Every tab mounts at launch, and Profile's mount fires ~20 requests that used
 * to compete with Home for the network and the JS thread on the first frames.
 * It now mounts on its first focus, or once the app has settled after launch —
 * still warm before most people tap it, without slowing Home's first paint.
 */
export default function ProfileRoute() {
  const { colors } = useThemeStore();
  const isFocused = useIsFocused();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (isFocused) setReady(true);
  }, [isFocused]);

  useEffect(() => {
    let task: { cancel: () => void } | null = null;
    const timer = setTimeout(() => {
      task = InteractionManager.runAfterInteractions(() => setReady(true));
    }, BACKGROUND_MOUNT_DELAY_MS);
    return () => {
      clearTimeout(timer);
      task?.cancel();
    };
  }, []);

  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  return <ProfileScreen />;
}
