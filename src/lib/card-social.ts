import type { CardSocial, Sandwich, SandwichPost } from '@/lib/api';

/**
 * Likes and comments belong to the CARD, not to the markets on it.
 *
 * A YouTube episode is N sandwiches on one Post. The server reports that Post's
 * counts on every one of them, so reading the card's state is reading any single
 * market's — and aggregating across the group is always wrong: `max` and `every`
 * existed only to undo the old per-market fan-out, and summing comment counts
 * now multiplies one thread by the number of markets.
 *
 * See stock-backend/docs/post-as-social-unit.md.
 */

/** Comments are hidden on posts for now; flip back on to restore the button. */
export const POST_COMMENTS_ENABLED = false;

export const EMPTY_CARD_SOCIAL: CardSocial = {
  likeCount: 0,
  commentCount: 0,
  viewerHasLiked: false,
};

/** The card's social state, read off whichever market came first. */
export function cardSocial(sandwiches: readonly Sandwich[]): CardSocial {
  const first = sandwiches[0];
  if (!first) return EMPTY_CARD_SOCIAL;
  return {
    likeCount: first.likeCount,
    commentCount: first.commentCount,
    viewerHasLiked: first.viewerHasLiked,
  };
}

/** True when two markets are on the same card. Never true for unbacked rows. */
export function isSameCard(a: Sandwich, b: Sandwich): boolean {
  return a.postId !== null && a.postId === b.postId;
}

/** One market, carrying its card's social state. */
export function withCardSocial(sandwich: Sandwich, social: CardSocial): Sandwich {
  return { ...sandwich, ...social };
}

/**
 * The state a heart tap predicts, before the server answers. Kept here so the
 * optimistic number and the server's mean the same thing.
 */
export function toggledCardSocial(social: CardSocial): CardSocial {
  return {
    ...social,
    viewerHasLiked: !social.viewerHasLiked,
    likeCount: Math.max(0, social.likeCount + (social.viewerHasLiked ? -1 : 1)),
  };
}

/**
 * Write a card's social state onto every market of that card, leaving the rest
 * of the list alone.
 *
 * This is what keeps an episode's markets agreeing with each other: liking from
 * the feed card and opening the episode screen must not show two different
 * numbers, and the feed holds each market as a separate row.
 *
 * A market with no card yet — a row created before the Post backfill — matches
 * on its own id instead, so its like still lands somewhere visible.
 */
export function applyCardSocial(
  rows: readonly Sandwich[],
  card: Pick<Sandwich, 'id' | 'postId'>,
  social: CardSocial,
): Sandwich[] {
  const onCard = (row: Sandwich) =>
    card.postId ? row.postId === card.postId : row.id === card.id;
  return rows.map((row) => (onCard(row) ? withCardSocial(row, social) : row));
}

/**
 * The same write, against the card feed's own shape.
 *
 * A post carries its counts twice: once on the post, and once on each market
 * (grafted there by `normalizePost` so every existing per-market reader keeps
 * working). Both have to move together, or the feed card and the episode screen
 * read the same card and show different numbers.
 */
export function applyCardSocialToPosts(
  posts: readonly SandwichPost[],
  card: Pick<Sandwich, 'id' | 'postId'>,
  social: CardSocial,
): SandwichPost[] {
  const onCard = (post: SandwichPost) =>
    card.postId
      ? post.id === card.postId
      : post.sandwiches.some((market) => market.id === card.id);

  return posts.map((post) =>
    onCard(post)
      ? {
          ...post,
          ...social,
          // Spread only the social fields onto each market: keeping the rest of
          // the object (and its `legs` array) identical is what lets memoised
          // cards skip a re-render.
          sandwiches: post.sandwiches.map((market) => ({ ...market, ...social })),
        }
      : post,
  );
}
