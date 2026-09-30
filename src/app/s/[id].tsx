import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';

/**
 * Lands the Universal Link / App Link `https://breadapp.fun/s/{id}` inside the
 * app. Expo Router maps that path here; we forward the id to the Sandwich tab as
 * `sandwichId`, which `SandwichScreen` reads to open the matching detail sheet.
 * Routing through the tab (rather than rendering the screen here) keeps the tab
 * bar + auth boundary intact. Signed-out users hit the (app) AuthBoundary and
 * are sent to sign-in; the existing https web page handles non-app visitors.
 */
export default function SandwichLinkRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();

  if (!id) {
    return <Redirect href="/home" />;
  }

  return (
    <Redirect href={{ pathname: '/sandwich', params: { sandwichId: id } }} />
  );
}
