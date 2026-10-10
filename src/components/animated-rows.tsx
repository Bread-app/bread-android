import React, { useRef } from 'react';
import Animated, {
  LayoutAnimationConfig,
  LinearTransition,
  ReduceMotion,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

// A leaf module on purpose (no app imports), so any list can use it without
// adding an edge to the screen import graph.

const SPRING = { damping: 22, stiffness: 260, mass: 0.7, reduceMotion: ReduceMotion.System };
/** Rows that already exist glide to their new slot instead of jumping. */
export const ROW_LAYOUT = LinearTransition.springify()
  .damping(24)
  .stiffness(260)
  .mass(0.7)
  .reduceMotion(ReduceMotion.System);
/** Per-row stagger for a batch arriving together, capped so long lists don't drag. */
const STAGGER_MS = 28;
const MAX_STAGGER_STEPS = 8;

/** A row arriving: rises a few points and fades up, after its place in the batch. */
export function rowEntering(delayMs = 0) {
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ translateY: 10 }, { scale: 0.98 }] },
      animations: {
        opacity: withDelay(delayMs, withTiming(1, { duration: 200, reduceMotion: ReduceMotion.System })),
        transform: [
          { translateY: withDelay(delayMs, withSpring(0, SPRING)) },
          { scale: withDelay(delayMs, withSpring(1, SPRING)) },
        ],
      },
    };
  };
}

/** A row leaving: fades and shrinks a touch in place while its neighbours close the gap. */
export function rowExiting() {
  'worklet';
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }] },
    animations: {
      opacity: withTiming(0, { duration: 140, reduceMotion: ReduceMotion.System }),
      transform: [{ scale: withTiming(0.96, { duration: 160, reduceMotion: ReduceMotion.System }) }],
    },
  };
}

/**
 * Flattens fragments (and arrays) into keyed rows. Keys come from
 * `Children.toArray`, which prefixes by position, so a row keeps its identity
 * across renders as long as it stays in the same branch of the JSX — and gets a
 * new one (exit + enter) when it moves to a different branch, e.g. Open ↔ Closed.
 */
function flattenRows(children: React.ReactNode, prefix = ''): { key: string; node: React.ReactElement }[] {
  const rows: { key: string; node: React.ReactElement }[] = [];
  for (const child of React.Children.toArray(children)) {
    if (!React.isValidElement(child)) continue;
    const key = `${prefix}${String(child.key)}`;
    if (child.type === React.Fragment) {
      rows.push(...flattenRows((child.props as { children?: React.ReactNode }).children, `${key}/`));
    } else {
      rows.push({ key, node: child });
    }
  }
  return rows;
}

/**
 * Wraps each row of a mapped list (fragments flattened) so the list changes
 * like a physical stack, Family-style: rows that arrive rise in (a batch
 * staggers), rows that leave fade out, and everything that stays glides to its
 * new place — filtering, sorting, a removed bookmark, skeletons → content.
 *
 * Only for lists that render every row (a ScrollView + `.map`). A virtualized
 * list mounts rows as they scroll into view, which would replay the entrance;
 * use `useFreshRowIds` there instead.
 *
 * What is on screen when this first mounts appears as-is.
 */
export function AnimatedRows({ children }: { children: React.ReactNode }) {
  const rows = flattenRows(children);

  // Stagger only the rows that are new in THIS render, by their order among
  // the new ones — so a page appended at the bottom staggers from zero rather
  // than from row 30.
  const seen = useRef<Set<string> | null>(null);
  const previous = seen.current;
  let freshIndex = 0;
  const rendered = rows.map(({ key, node }) => {
    const isFresh = previous !== null && !previous.has(key);
    const delay = isFresh ? Math.min(freshIndex++, MAX_STAGGER_STEPS) * STAGGER_MS : 0;
    return (
      <Animated.View key={key} entering={rowEntering(delay)} exiting={rowExiting} layout={ROW_LAYOUT}>
        {node}
      </Animated.View>
    );
  });
  seen.current = new Set(rows.map((row) => row.key));

  return <LayoutAnimationConfig skipEntering>{rendered}</LayoutAnimationConfig>;
}

/**
 * For virtualized lists (FlatList): the ids that appeared since the last render
 * that changed `ids`, so only genuinely new items animate in — a row scrolling
 * back into the render window is not new. The first batch counts as seen.
 */
export function useFreshRowIds(ids: readonly string[]): ReadonlySet<string> {
  const known = useRef<Set<string> | null>(null);
  const fresh = useRef<ReadonlySet<string>>(new Set());
  const signature = useRef<string>('');
  const nextSignature = ids.join('|');
  if (nextSignature !== signature.current) {
    signature.current = nextSignature;
    if (known.current === null) {
      known.current = new Set(ids);
      fresh.current = new Set();
    } else {
      const added = ids.filter((id) => !known.current!.has(id));
      for (const id of ids) known.current.add(id);
      fresh.current = new Set(added);
    }
  }
  return fresh.current;
}
