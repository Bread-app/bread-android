import { usePrivy } from '@privy-io/expo';
import { useLocalSearchParams } from 'expo-router';
import React from 'react';

import { appUserPayloadFromPrivyUser } from '@/lib/api';
import { UserProfileRouteScreen } from '@/screens/user-profile-screen';

/**
 * Another user's profile, as a stack screen so a Sandwich or asset opened from
 * it pushes on top and Back returns here. Opened through `UserProfileScreen`.
 */
export default function UserProfileRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user } = usePrivy();
  if (!id) return null;
  return (
    <UserProfileRouteScreen
      targetPrivyUserId={id}
      viewerPrivyUserId={user?.id ?? null}
      viewerPayload={user ? appUserPayloadFromPrivyUser(user) : null}
    />
  );
}
