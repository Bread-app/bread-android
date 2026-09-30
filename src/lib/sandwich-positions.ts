import * as SecureStore from 'expo-secure-store';

import type { PublicSandwichPosition, Sandwich, SandwichBuyLeg } from './api';

const STORAGE_PREFIX = 'sandwich_positions_v1';
/**
 * Sandwiches this device has exited in full, and when.
 *
 * {@link seedFromBackend} treats the backend as canonical for what *exists*, so
 * a full exit — which deletes the local row — was resurrected by the very next
 * portfolio fetch: the backend has not indexed the exit yet, the app sees a
 * position it has no local counterpart for, and re-adds it. The user sells, the
 * row comes back.
 *
 * A tombstone closes that window. It suppresses a backend row only while that
 * row is *older* than the exit; the moment the backend reports something newer
 * (the exit landed, or the sandwich was bought again) the tombstone is dropped
 * and the backend wins again, so this can never hide a real position for long.
 */
const SOLD_PREFIX = 'sandwich_sold_v1';
/**
 * How long a tombstone can outlive its backend row.
 *
 * The normal exit is the pruning in {@link seedFromBackend} — the backend stops
 * reporting the sandwich and the tombstone goes with it. The TTL is only for
 * the case where that never happens (the backend keeps a row this device sold
 * on a path the server never learned about), so a stale marker cannot hide a
 * position the user really does hold forever.
 */
const SOLD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SECURE_STORE_KEY_RE = /[^A-Za-z0-9._-]/g;

export type SandwichPositionLegKind = 'swap' | 'prediction';

export type SandwichPositionLeg = {
  legId: string;
  kind?: SandwichPositionLegKind;
  mint: string; // for prediction legs this stores marketId for compatibility
  marketId?: string | null;
  positionPubkey?: string | null;
  isYes?: boolean | null;
  symbol: string | null;
  label: string;
  imageUrl: string | null;
  weightBps: number;
  inputAmount: string | null;
  investedUsd: number | null;
  /** Token base units attributed to this position's entry. */
  outputAmount?: string | null;
  /** Decimals for `outputAmount`; retained to avoid a metadata RPC on render. */
  decimals?: number | null;
};

export type SandwichPosition = {
  id: string;
  sandwichId: string;
  name: string;
  summary: string;
  investedUsd: number | null;
  createdAt: string;
  updatedAt: string;
  pendingSync: boolean;
  /** Timestamp/YouTube baskets use the fail-closed one-transaction exit path. */
  strictAtomic: boolean;
  legs: SandwichPositionLeg[];
};

function storageKey(walletAddress: string) {
  return `${STORAGE_PREFIX}.${walletKeyFor(walletAddress)}`;
}

function soldStorageKey(walletAddress: string) {
  return `${SOLD_PREFIX}.${walletKeyFor(walletAddress)}`;
}

function walletKeyFor(walletAddress: string) {
  return walletAddress.trim().replace(SECURE_STORE_KEY_RE, '_') || 'unknown';
}

/** sandwichId → ISO timestamp of the exit this device recorded. */
type SoldMarks = Record<string, string>;

async function readSoldMarks(walletAddress: string): Promise<SoldMarks> {
  const raw = await SecureStore.getItemAsync(soldStorageKey(walletAddress));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const marks: SoldMarks = {};
    const cutoff = Date.now() - SOLD_TTL_MS;
    for (const [sandwichId, soldAt] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof soldAt !== 'string') continue;
      const at = Date.parse(soldAt);
      if (!Number.isFinite(at) || at < cutoff) continue;
      marks[sandwichId] = soldAt;
    }
    return marks;
  } catch {
    return {};
  }
}

async function writeSoldMarks(walletAddress: string, marks: SoldMarks): Promise<void> {
  await SecureStore.setItemAsync(soldStorageKey(walletAddress), JSON.stringify(marks));
}

/** Marks a sandwich as exited on this device, as of now. */
async function markSold(walletAddress: string, sandwichId: string): Promise<void> {
  const marks = await readSoldMarks(walletAddress);
  marks[sandwichId] = new Date().toISOString();
  await writeSoldMarks(walletAddress, marks);
}

/** Drops the tombstone — the position is being held again. */
async function clearSold(walletAddress: string, sandwichId: string): Promise<void> {
  const marks = await readSoldMarks(walletAddress);
  if (!(sandwichId in marks)) return;
  delete marks[sandwichId];
  await writeSoldMarks(walletAddress, marks);
}

function isPositionLeg(value: unknown): value is SandwichPositionLeg {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.legId === 'string' &&
    typeof candidate.mint === 'string' &&
    typeof candidate.label === 'string' &&
    typeof candidate.weightBps === 'number' &&
    (typeof candidate.symbol === 'string' || candidate.symbol === null) &&
    (typeof candidate.imageUrl === 'string' || candidate.imageUrl === null) &&
    (typeof candidate.inputAmount === 'string' || typeof candidate.inputAmount === 'undefined' || candidate.inputAmount === null) &&
    (typeof candidate.investedUsd === 'number' || typeof candidate.investedUsd === 'undefined' || candidate.investedUsd === null)
  );
}

function normalizePosition(value: unknown): SandwichPosition | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id === 'string' &&
    typeof candidate.sandwichId === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.summary === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string' &&
    Array.isArray(candidate.legs) &&
    candidate.legs.every(isPositionLeg)
  ) {
    const legs = candidate.legs.map((leg): SandwichPositionLeg => ({
      legId: leg.legId,
      kind: leg.kind === 'prediction' ? 'prediction' : 'swap',
      mint: leg.mint,
      marketId: leg.marketId,
      positionPubkey: leg.positionPubkey,
      isYes: leg.isYes,
      symbol: leg.symbol,
      label: leg.label,
      imageUrl: leg.imageUrl,
      weightBps: leg.weightBps,
      inputAmount: typeof leg.inputAmount === 'string' ? leg.inputAmount : null,
      investedUsd: typeof leg.investedUsd === 'number' ? leg.investedUsd : null,
      outputAmount: typeof leg.outputAmount === 'string' ? leg.outputAmount : null,
      decimals: typeof leg.decimals === 'number' ? leg.decimals : null,
    }));

    return {
      id: candidate.id,
      sandwichId: candidate.sandwichId,
      name: candidate.name,
      summary: candidate.summary,
      investedUsd: typeof candidate.investedUsd === 'number' ? candidate.investedUsd : null,
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
      pendingSync: candidate.pendingSync === true,
      strictAtomic: candidate.strictAtomic === true,
      legs,
    };
  }

  return null;
}

async function readPositions(walletAddress: string): Promise<SandwichPosition[]> {
  const raw = await SecureStore.getItemAsync(storageKey(walletAddress));
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.map(normalizePosition).filter((position): position is SandwichPosition => position !== null)
      : [];
  } catch {
    return [];
  }
}

async function writePositions(walletAddress: string, positions: SandwichPosition[]): Promise<void> {
  await SecureStore.setItemAsync(storageKey(walletAddress), JSON.stringify(positions));
}

export async function getStoredSandwichPositions(walletAddress: string): Promise<SandwichPosition[]> {
  return readPositions(walletAddress);
}

export type ExecutedSandwichLeg =
  | {
      kind: 'swap';
      legId: string;
      mint: string;
      inputAmount: string;
      outputAmount?: string | null;
      decimals?: number | null;
    }
  | {
      kind: 'prediction';
      legId: string;
      marketId: string;
      positionPubkey: string | null;
      isYes: boolean;
      inputAmount: string;
    };

export async function recordSandwichBuy(
  walletAddress: string,
  sandwich: Sandwich,
  executedLegs: ExecutedSandwichLeg[] | SandwichBuyLeg[],
): Promise<void> {
  const executedByLegId = new Map<string, ExecutedSandwichLeg>();
  for (const raw of executedLegs as (ExecutedSandwichLeg | SandwichBuyLeg)[]) {
    const r = raw as Record<string, unknown> & { legId: string };
    const kind = typeof r.kind === 'string' ? r.kind : null;
    if (kind === 'prediction') {
      executedByLegId.set(r.legId, {
        kind: 'prediction',
        legId: r.legId,
        marketId: String(r.marketId ?? ''),
        positionPubkey:
          typeof r.positionPubkey === 'string' ? r.positionPubkey : null,
        isYes: Boolean(r.isYes),
        inputAmount: String(r.inputAmount ?? '0'),
      });
    } else if (typeof r.mint === 'string' && r.mint) {
      executedByLegId.set(r.legId, {
        kind: 'swap',
        legId: r.legId,
        mint: r.mint,
        inputAmount: String(r.inputAmount ?? '0'),
        outputAmount: typeof r.outputAmount === 'string' ? r.outputAmount : null,
        decimals: typeof r.decimals === 'number' ? r.decimals : null,
      });
    }
  }

  const legs = sandwich.legs
    .filter((leg) => executedByLegId.has(leg.id))
    .sort((a, b) => a.order - b.order)
    .map((leg): SandwichPositionLeg => {
      const executed = executedByLegId.get(leg.id)!;
      const inputAmount = executed.inputAmount;
      const investedUsd = inputAmount ? Number(inputAmount) / 1_000_000 : null;

      if (executed.kind === 'prediction') {
        return {
          legId: leg.id,
          kind: 'prediction',
          mint: executed.marketId,
          marketId: executed.marketId,
          positionPubkey: executed.positionPubkey,
          isYes: executed.isYes,
          symbol: leg.symbol,
          label: leg.label,
          imageUrl: leg.imageUrl,
          weightBps: leg.weightBps,
          inputAmount,
          investedUsd,
          outputAmount: null,
          decimals: null,
        };
      }

      return {
        legId: leg.id,
        kind: 'swap',
        mint: executed.mint,
        symbol: leg.symbol,
        label: leg.label,
        imageUrl: leg.imageUrl,
        weightBps: leg.weightBps,
        inputAmount,
        investedUsd,
        outputAmount: executed.outputAmount ?? null,
        decimals: executed.decimals ?? null,
      };
    });

  if (legs.length === 0) return;

  const now = new Date().toISOString();
  const current = await readPositions(walletAddress);
  const existingIndex = current.findIndex((position) => position.sandwichId === sandwich.id);
  const existing = existingIndex >= 0 ? current[existingIndex] : null;
  // A top-up is one position, so retain both entry quantities and both cost
  // bases. Replacing the prior legs made a second buy look like it owned only
  // the newest fill.
  const mergedLegs = existing
    ? legs.map((leg) => {
        const previous = existing.legs.find((candidate) => candidate.legId === leg.legId);
        if (!previous) return leg;
        const outputAmount =
          typeof previous.outputAmount === 'string' && typeof leg.outputAmount === 'string'
            ? (BigInt(previous.outputAmount) + BigInt(leg.outputAmount)).toString()
            : null;
        return {
          ...leg,
          inputAmount: (BigInt(previous.inputAmount ?? '0') + BigInt(leg.inputAmount ?? '0')).toString(),
          investedUsd: (previous.investedUsd ?? 0) + (leg.investedUsd ?? 0),
          outputAmount,
          decimals: leg.decimals ?? previous.decimals,
        };
      })
    : legs;
  const investedUsd = mergedLegs.reduce((sum, leg) => sum + (leg.investedUsd ?? 0), 0);
  const nextPosition: SandwichPosition = {
    id: sandwich.id,
    sandwichId: sandwich.id,
    name: sandwich.name,
    summary: sandwich.summary,
    investedUsd,
    createdAt: existingIndex >= 0 ? current[existingIndex].createdAt : now,
    updatedAt: now,
    pendingSync: true,
    strictAtomic: sandwich.source.sourceType === 'youtube',
    legs: mergedLegs,
  };

  const next =
    existingIndex >= 0
      ? current.map((position, index) => (index === existingIndex ? nextPosition : position))
      : [nextPosition, ...current];

  await writePositions(walletAddress, next);
}

export async function recordSandwichPositionBuy(
  walletAddress: string,
  position: SandwichPosition,
  executedLegs: { mint: string; inputAmount: string; outputAmount?: string | null; decimals?: number | null }[],
): Promise<void> {
  const executedByMint = new Map(executedLegs.map((leg) => [leg.mint, leg]));
  const now = new Date().toISOString();
  // Held again: whatever this device exited earlier is no longer the truth.
  await clearSold(walletAddress, position.sandwichId);
  const current = await readPositions(walletAddress);
  const existingIndex = current.findIndex((row) => row.id === position.id);
  const basePosition = existingIndex >= 0 ? current[existingIndex] : position;
  const legs = basePosition.legs.map((leg) => {
    const executedLeg = executedByMint.get(leg.mint);
    if (!executedLeg) return leg;

    const previousInputAmount = BigInt(leg.inputAmount ?? '0');
    const nextInputAmount = previousInputAmount + BigInt(executedLeg.inputAmount);
    const addedUsd = Number(executedLeg.inputAmount) / 1_000_000;

    return {
      ...leg,
      inputAmount: nextInputAmount.toString(),
      investedUsd: (leg.investedUsd ?? 0) + addedUsd,
      outputAmount:
        typeof leg.outputAmount === 'string' && typeof executedLeg.outputAmount === 'string'
          ? (BigInt(leg.outputAmount) + BigInt(executedLeg.outputAmount)).toString()
          : null,
      decimals: executedLeg.decimals ?? leg.decimals,
    };
  });
  const nextPosition: SandwichPosition = {
    ...basePosition,
    investedUsd: legs.reduce((sum, leg) => sum + (leg.investedUsd ?? 0), 0),
    updatedAt: now,
    pendingSync: true,
    strictAtomic: basePosition.strictAtomic,
    legs,
  };
  const next =
    existingIndex >= 0
      ? current.map((row, index) => (index === existingIndex ? nextPosition : row))
      : [nextPosition, ...current];

  await writePositions(walletAddress, next);
}

export async function recordSandwichPositionSell(
  walletAddress: string,
  positionId: string,
  soldFraction: number,
): Promise<void> {
  const current = await readPositions(walletAddress);
  const normalizedFraction = Math.max(0, Math.min(1, soldFraction));

  if (normalizedFraction >= 0.995) {
    const sold = current.find((position) => position.id === positionId);
    await writePositions(
      walletAddress,
      current.filter((position) => position.id !== positionId),
    );
    // Deleting the row is not enough on its own: the backend has not indexed
    // the exit yet, and the next merge would read its stale row as a position
    // this device simply hasn't heard about and add it straight back.
    if (sold) await markSold(walletAddress, sold.sandwichId);
    return;
  }

  const remainingFraction = 1 - normalizedFraction;
  await writePositions(
    walletAddress,
    current.map((position) => {
      if (position.id !== positionId) return position;

      const legs = position.legs.map((leg) => {
        const inputAmount = leg.inputAmount ? BigInt(leg.inputAmount) : null;
        const outputAmount = leg.outputAmount ? BigInt(leg.outputAmount) : null;
        const nextInputAmount = inputAmount !== null ? (inputAmount * BigInt(Math.round(remainingFraction * 10000))) / 10000n : null;

        return {
          ...leg,
          inputAmount: nextInputAmount?.toString() ?? null,
          outputAmount:
            outputAmount !== null
              ? (outputAmount * BigInt(Math.round(remainingFraction * 10000)) / 10000n).toString()
              : null,
          investedUsd: leg.investedUsd !== null ? leg.investedUsd * remainingFraction : null,
        };
      });

      return {
        ...position,
        investedUsd: position.investedUsd !== null ? position.investedUsd * remainingFraction : null,
        updatedAt: new Date().toISOString(),
        pendingSync: true,
        legs,
      };
    }),
  );
}

export async function removeStoredSandwichPosition(walletAddress: string, positionId: string): Promise<void> {
  const current = await readPositions(walletAddress);
  const removed = current.find((position) => position.id === positionId);
  await writePositions(
    walletAddress,
    current.filter((position) => position.id !== positionId),
  );
  // Both callers remove a position the wallet no longer holds — an exit whose
  // legs are gone, or the prune against live balances. Either way the backend
  // must not put it back on the next merge.
  if (removed) await markSold(walletAddress, removed.sandwichId);
}

/**
 * Merges backend portfolio into local SecureStore. Backend is the canonical source
 * of truth for what positions exist. Local positions with pendingSync=true are kept
 * even if the backend doesn't know about them yet (not yet synced). Once a position
 * is confirmed by the backend, pendingSync is cleared to false — so if it later
 * disappears from the backend (sold on another device), it will be dropped here.
 */
export async function seedFromBackend(
  walletAddress: string,
  backendPositions: PublicSandwichPosition[],
): Promise<SandwichPosition[]> {
  const local = await readPositions(walletAddress);
  const localBySandwichId = new Map(local.map((p) => [p.sandwichId, p]));
  const sold = await readSoldMarks(walletAddress);
  const merged: SandwichPosition[] = [];
  const handledIds = new Set<string>();
  // Tombstones only survive while the backend is still behind. One it no longer
  // reports has served its purpose; one whose row is newer than the exit has
  // been overtaken by the server and must not suppress anything.
  const keptSold: SoldMarks = {};

  for (const pos of backendPositions) {
    const soldAt = sold[pos.sandwichId];
    if (soldAt !== undefined) {
      if (pos.updatedAt <= soldAt) {
        // Exited here, and this is the pre-exit row coming back. Skip it and
        // keep the marker until the backend catches up.
        keptSold[pos.sandwichId] = soldAt;
        handledIds.add(pos.sandwichId);
        continue;
      }
      // The backend has moved past the exit — it wins from here on.
    }

    const localPos = localBySandwichId.get(pos.sandwichId);
    if (localPos && localPos.updatedAt >= pos.updatedAt) {
      // Local wins, but a leg the device lost its quantity for (an older merge
      // dropped it) is repaired from the backend's record of the buy.
      const backendQty = new Map(pos.legs.map((leg) => [leg.legId, leg.outputAmount ?? null]));
      merged.push({
        ...localPos,
        pendingSync: false,
        legs: localPos.legs.map((leg) =>
          leg.outputAmount ? leg : { ...leg, outputAmount: backendQty.get(leg.legId) ?? null },
        ),
      });
    } else {
      merged.push({
        id: pos.sandwichId,
        sandwichId: pos.sandwichId,
        name: pos.name,
        summary: pos.summary,
        investedUsd: pos.investedUsd,
        createdAt: pos.updatedAt,
        updatedAt: pos.updatedAt,
        pendingSync: false,
        strictAtomic: localPos?.strictAtomic ?? false,
        legs: pos.legs.map((leg) => {
          // The backend row carries no decimals, and older backends no quantity
          // either. Dropping the device's own figures here is what made a leg
          // fall back to valuing the wallet's WHOLE balance of its mint — a $5
          // buy with a SOL leg showed $5.39 because the swap-rent SOL left in the
          // wallet was counted as part of it. The device's quantity wins: it
          // sums every buy made here, where the backend reports only the latest.
          const localLeg = localPos?.legs.find((l) => l.legId === leg.legId);
          return {
            legId: leg.legId,
            mint: leg.mint,
            symbol: leg.symbol,
            label: leg.label,
            imageUrl: leg.imageUrl,
            weightBps: leg.weightBps,
            inputAmount: leg.inputAmount,
            investedUsd: leg.investedUsd,
            outputAmount: localLeg?.outputAmount ?? leg.outputAmount ?? null,
            decimals: localLeg?.decimals ?? null,
          };
        }),
      });
    }
    handledIds.add(pos.sandwichId);
  }

  for (const localPos of local) {
    if (!handledIds.has(localPos.sandwichId) && localPos.pendingSync) {
      merged.push(localPos);
    }
  }

  merged.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  await writePositions(walletAddress, merged);
  await writeSoldMarks(walletAddress, keptSold);
  return merged;
}
