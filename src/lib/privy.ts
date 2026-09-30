export const privyConfig = {
  appId: process.env.EXPO_PUBLIC_PRIVY_APP_ID ?? '',
  clientId: process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID ?? '',
};

export function shortAddress(address: string): string {
  if (address.length < 12) {
    return address;
  }

  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
