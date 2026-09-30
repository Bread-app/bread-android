import { shortAddress } from '@/lib/privy';

/** The fields any user-shaped payload needs to produce a label. */
type Nameable = {
  privyUserId: string;
  name?: string | null;
  username?: string | null;
  xHandle?: string | null;
  walletAddress?: string | null;
};

/**
 * The label to show for a user in a list row.
 *
 * Username first — that is the address people recognise each other by; the
 * display name is only the fallback. The privyUserId is deliberately NOT part
 * of the chain: it renders as "did:privy:cmr…", which is not a name and reads
 * as a bug. A wallet-less, nameless account gets a generic label instead.
 */
export function userDisplayName(user: Nameable): string {
  const username = user.username?.trim().replace(/^@+/, '');
  if (username) return username;

  const name = user.name?.trim();
  if (name) return name;

  const xHandle = user.xHandle?.trim().replace(/^@+/, '');
  if (xHandle) return xHandle;

  const wallet = user.walletAddress?.trim();
  if (wallet) return shortAddress(wallet);

  return 'Bread user';
}
