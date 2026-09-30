import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Image,
  Linking,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';

import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { SandwichSource } from '@/lib/api';
import { useThemeStore } from '@/lib/theme-store';
import { HandleText } from '@/components/handle-text';
import { PressableScale } from '@/components/pressable-scale';

// The app's text face — the same `Fonts.rounded` every sandwich card uses.
const F = Fonts.rounded;

// Matches THESIS_COLLAPSED_LINES in the sandwich feed so an X post clamps at
// the same height as any other post.
const COMPACT_LINES = 5;
const DETAIL_LINES = 5;

export function isXPostSource(source: SandwichSource) {
  if (source.sourceType === 'x_summon' || source.sourceType === 'x_post') {
    return true;
  }
  return /^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i.test(source.sourceUrl ?? '');
}

/**
 * A web article a sandwich was built from. `article` is what the ingest writes,
 * but older rows can carry a bare link with a nonspecific type — so any http
 * source that isn't X or YouTube reads as an article too.
 */
export function isArticleSource(source: SandwichSource) {
  if (source.sourceType === 'article') return true;
  const url = source.sourceUrl ?? '';
  if (!/^https?:\/\//i.test(url)) return false;
  if (isXPostSource(source)) return false;
  return !/(?:youtube\.com|youtu\.be)/i.test(url);
}

/** "nytimes.com" — the publisher line on an article embed. */
function sourceDomain(url: string | null): string {
  if (!url) return '';
  const match = url.match(/^https?:\/\/([^/?#]+)/i);
  return match ? match[1].replace(/^www\./i, '') : '';
}

/**
 * An article has no author avatar, so the publisher's favicon stands in — it is
 * the mark readers actually recognize a publication by.
 */
function faviconUrl(url: string | null): string | null {
  const domain = sourceDomain(url);
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

/**
 * Article bodies are stored as "<commentary>\n\n<title>\n\n<body>", with the
 * title repeated at the head of `quote` as "<title> — <excerpt>". Split the
 * headline back out so the embed can lead with it the way a link card does.
 */
function articleParts(source: SandwichSource): { headline: string; excerpt: string } {
  const quote = decodeHtmlEntities((source.quote ?? '').trim());
  if (quote) {
    const [headline, ...rest] = quote.split(/\s+—\s+/);
    return { headline: headline.trim(), excerpt: rest.join(' — ').trim() };
  }
  const lines = decodeHtmlEntities(source.text.trim())
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return { headline: lines[0] ?? '', excerpt: lines.slice(1).join(' ') };
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * The post's own words. Skips a bare URL — an X source whose text is just the
 * link has nothing to quote, and printing the link back reads as a bug.
 *
 * Exported for the surfaces that render a post outside this file's themed
 * frame, like the trade receipt's fixed-light card.
 */
export function sourcePostText(source: SandwichSource) {
  const candidates = [source.text, source.quote, source.input];
  const value =
    candidates.find(
      (candidate) =>
        typeof candidate === 'string' &&
        candidate.trim().length > 0 &&
        !/^https?:\/\//i.test(candidate.trim()),
    ) ?? '';
  return decodeHtmlEntities(value.trim());
}

function formatPostDate(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

/**
 * A compact, native rendering of the X post that produced a sandwich. Long
 * posts stay clamped until the user explicitly taps More.
 */
export function XPostPreview({
  source,
  compact = false,
  hideIdentity = false,
  maxLines,
}: {
  source: SandwichSource;
  compact?: boolean;
  /** The parent already renders the source author and link above the post. */
  hideIdentity?: boolean;
  /**
   * Lines before the post clamps behind More. Overrides the compact/detail
   * default for surfaces with a tighter budget than a feed card — the buy pad,
   * where this sits between the amount and the keypad.
   */
  maxLines?: number;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const [expanded, setExpanded] = useState(false);
  const [lineCount, setLineCount] = useState<number | null>(null);
  const collapsedLines = maxLines ?? (compact ? COMPACT_LINES : DETAIL_LINES);
  const text = useMemo(() => sourcePostText(source), [source]);
  const date = useMemo(() => formatPostDate(source.publishedAt), [source.publishedAt]);
  const handle = source.authorHandle?.replace(/^@+/, '') ?? '';
  const displayName = source.authorName?.trim() || handle || 'X user';
  const initials =
    displayName
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'X';
  const isTruncatable = (lineCount ?? 0) > collapsedLines;

  useEffect(() => {
    setExpanded(false);
    setLineCount(null);
  }, [source.id]);

  const stop = (event: GestureResponderEvent) => {
    event.stopPropagation();
  };

  const openPost = (event: GestureResponderEvent) => {
    stop(event);
    if (!source.sourceUrl) return;
    void Linking.openURL(source.sourceUrl).catch(() => {});
  };

  const avatar = source.authorAvatarUrl ? (
    <Image
      source={{ uri: source.authorAvatarUrl }}
      style={[styles.avatar, compact && styles.avatarCompact]}
    />
  ) : (
    <View style={[styles.avatar, styles.avatarFallback, compact && styles.avatarCompact]}>
      <Text style={styles.avatarInitials}>{initials}</Text>
    </View>
  );

  const xButton = (
    <PressableScale
      accessibilityRole={source.sourceUrl ? 'link' : 'image'}
      accessibilityLabel={source.sourceUrl ? 'Open original post on X' : 'X post'}
      disabled={!source.sourceUrl}
      hitSlop={10}
      onPress={openPost}
      style={[styles.xButton, compact && styles.xButtonCompact]}
    >
      {/* 16 to sit level with VerifiedBadge's 15: the badge is an SVG whose
          shape fills its box, while an Ionicons glyph carries padding inside
          its em square, so equal numbers do not read as equal marks. */}
      <Ionicons name="logo-x" size={compact ? 16 : 19} color={colors.text} />
    </PressableScale>
  );

  const body = (
    <View style={styles.bodyWrap}>
      <Text
        style={[
          styles.body,
          compact && styles.bodyCompact,
          hideIdentity && styles.bodyWithoutIdentity,
        ]}
        numberOfLines={expanded ? undefined : collapsedLines}
      >
        {text}
      </Text>
      {lineCount === null ? (
        // Measure an invisible, unconstrained copy while the visible post is
        // clamped from its very first paint. This avoids a one-frame flash of
        // the full long post before we know whether More is needed.
        <Text
          accessible={false}
          pointerEvents="none"
          style={[
            styles.body,
            compact && styles.bodyCompact,
            hideIdentity && styles.bodyWithoutIdentity,
            styles.measureText,
          ]}
          onTextLayout={(event) => {
            setLineCount(event.nativeEvent.lines.length);
          }}
        >
          {text}
        </Text>
      ) : null}
    </View>
  );

  const moreButton = isTruncatable ? (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={expanded ? 'Show less of X post' : 'Show more of X post'}
      hitSlop={8}
      onPress={(event) => {
        stop(event);
        setExpanded((value) => !value);
      }}
      style={styles.moreButton}
    >
      <Text style={styles.moreText}>{expanded ? 'Show less' : 'More'}</Text>
    </PressableScale>
  ) : null;

  // Feed variant: lay out exactly like a native sandwich card — avatar column,
  // then "@handle" above the post text. No display name, no date, no box, so
  // the post body starts on the same left edge as every other card's thesis.
  if (compact) {
    return (
      <View style={styles.compactRow}>
        {avatar}
        <View style={styles.compactContent}>
          <View style={styles.compactIdentityRow}>
            <Text numberOfLines={1} style={styles.compactHandle}>
              <Text style={styles.compactHandleAt}>@</Text>
              {handle || displayName}
            </Text>
            {/* Sits where a normal card puts its verified badge — directly
                after the handle, as a mark on the identity rather than a
                control parked at the far edge. */}
            {xButton}
            <View style={styles.compactIdentitySpacer} />
          </View>
          {body}
          {moreButton}
        </View>
      </View>
    );
  }

  if (hideIdentity) {
    return (
      <View style={styles.card}>
        {body}
        {moreButton}
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        {avatar}

        <View style={styles.identity}>
          <Text numberOfLines={1} style={styles.displayName}>
            {displayName}
          </Text>
          <View style={styles.metaRow}>
            {handle ? (
              <Text numberOfLines={1} style={styles.handle}>
                @{handle}
              </Text>
            ) : null}
            {handle && date ? <Text style={styles.metaDot}>·</Text> : null}
            {date ? <Text style={styles.date}>{date}</Text> : null}
          </View>
        </View>

        {xButton}
      </View>

      {body}
      {moreButton}
    </View>
  );
}

/** How many lines of the post an embed shows before it asks for a tap. */
const EMBED_LINES = 8;

/**
 * The source post itself, rendered as a boxed embed the way X renders a quoted
 * post: avatar, name, @handle · date, the post's own words, and the platform
 * mark. The whole card is the link — tapping it leaves for the original.
 *
 * Articles reuse the exact same frame: the publisher stands in for the author
 * (favicon for avatar, domain for handle) and the headline leads the body, so a
 * cited link and a cited post read as one family instead of two designs.
 */
export function SourcePostCard({ source }: { source: SandwichSource }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const [expanded, setExpanded] = useState(false);
  const [lineCount, setLineCount] = useState<number | null>(null);

  const isArticle = isArticleSource(source) && !isXPostSource(source);
  const article = useMemo(
    () => (isArticle ? articleParts(source) : null),
    [isArticle, source],
  );
  const text = useMemo(
    () => (article ? article.excerpt : sourcePostText(source)),
    [article, source],
  );
  const date = useMemo(() => formatPostDate(source.publishedAt), [source.publishedAt]);
  const domain = useMemo(() => sourceDomain(source.sourceUrl), [source.sourceUrl]);
  const handle = source.authorHandle?.replace(/^@+/, '') ?? '';
  // The embed is the cited account's own object, so it carries that account's
  // identity — never the Bread creator's, who bylines the screen around it.
  const displayName =
    source.authorName?.trim() || handle || (isArticle ? domain : 'X user') || 'Source';
  const avatarUrl = source.authorAvatarUrl ?? (isArticle ? faviconUrl(source.sourceUrl) : null);
  const initials =
    displayName
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || (isArticle ? 'A' : 'X');
  // The second identity line: the @handle on a post, the publisher's domain on
  // an article.
  const subtitle = handle ? `@${handle}` : isArticle && domain !== displayName ? domain : '';
  const isTruncatable = (lineCount ?? 0) > EMBED_LINES;

  useEffect(() => {
    setExpanded(false);
    setLineCount(null);
  }, [source.id]);

  const openSource = () => {
    if (!source.sourceUrl) return;
    void Linking.openURL(source.sourceUrl).catch(() => {});
  };

  return (
    <PressableScale
      accessibilityRole={source.sourceUrl ? 'link' : 'summary'}
      accessibilityLabel={
        source.sourceUrl
          ? isArticle
            ? `Read the original article by ${displayName}`
            : `Open ${displayName}'s post on X`
          : `Post by ${displayName}`
      }
      disabled={!source.sourceUrl}
      onPress={openSource}
      style={styles.embedCard}
    >
      {/* The platform mark rides the card's top-right corner, the way X's own
          embed badges a quoted post — a stamp on the object, not a glyph
          competing with the identity line. */}
      {isArticle ? null : (
        <Ionicons
          name="logo-x"
          size={15}
          color={colors.text}
          style={styles.embedMark}
        />
      )}

      <View style={[styles.embedHeader, isArticle ? null : styles.embedHeaderWithMark]}>
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.embedAvatar} />
        ) : (
          <View style={[styles.embedAvatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>
        )}
        <View style={styles.identity}>
          <Text numberOfLines={1} style={styles.displayName}>
            {displayName}
          </Text>
          <View style={styles.metaRow}>
            {/* An article has no corner stamp, so its mark leads the address
                it belongs to — "doc, domain". */}
            {isArticle ? (
              <Ionicons name="document-text" size={13} color={colors.textSecondary} />
            ) : null}
            {subtitle ? (
              <HandleText numberOfLines={1} style={styles.handle}>
                {subtitle}
              </HandleText>
            ) : null}
            {subtitle && date ? <Text style={styles.metaDot}>·</Text> : null}
            {date ? <Text style={styles.date}>{date}</Text> : null}
          </View>
        </View>
      </View>

      {article?.headline ? (
        <Text numberOfLines={3} style={styles.embedHeadline}>
          {article.headline}
        </Text>
      ) : null}

      {text ? (
        <View style={styles.bodyWrap}>
          <Text
            style={[styles.body, article?.headline ? styles.embedBodyUnderHeadline : null]}
            numberOfLines={expanded ? undefined : EMBED_LINES}
          >
            {text}
          </Text>
          {lineCount === null ? (
            <Text
              accessible={false}
              pointerEvents="none"
              style={[
                styles.body,
                article?.headline ? styles.embedBodyUnderHeadline : null,
                styles.measureText,
              ]}
              onTextLayout={(event) => {
                setLineCount(event.nativeEvent.lines.length);
              }}
            >
              {text}
            </Text>
          ) : null}
        </View>
      ) : null}

      {isTruncatable ? (
        <PressableScale
          accessibilityRole={source.sourceUrl ? 'link' : 'button'}
          accessibilityLabel={
            source.sourceUrl
              ? isArticle
                ? 'Read the full article at the source'
                : 'Read the full post on X'
              : expanded
                ? 'Show less of the post'
                : 'Show more of the post'
          }
          hitSlop={8}
          // "More" is the rest of the post, and the rest of the post lives at
          // the source — so it goes there rather than unfolding a truncated
          // copy. Only a post with no link left to follow expands in place.
          onPress={(event) => {
            event.stopPropagation();
            if (source.sourceUrl) {
              openSource();
              return;
            }
            setExpanded((value) => !value);
          }}
          style={styles.moreButton}
        >
          <Text style={styles.moreText}>
            {source.sourceUrl ? 'More' : expanded ? 'Show less' : 'More'}
          </Text>
        </PressableScale>
      ) : null}
    </PressableScale>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    // Detail variant. No boxed chrome — the post reads as the screen's own
    // content, inside the hero's padding rather than a card within a card.
    card: {
      paddingVertical: 2,
    },
    // Feed variant: avatar column + content column, same 34/10 geometry as a
    // sandwich card, so the post text lines up with every other card's thesis.
    compactRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
    },
    compactContent: {
      flex: 1,
      minWidth: 0,
    },
    compactIdentityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      marginBottom: 3,
    },
    compactIdentitySpacer: {
      flex: 1,
    },
    // Type copied from the feed's own cardHandle / cardHandleAt, font family
    // included — the app renders in ui-rounded, and 15pt of system default
    // next to 15pt of rounded is what read as a different size.
    compactHandle: {
      flexShrink: 1,
      color: c.text,
      fontSize: 15,
      lineHeight: 19,
      fontWeight: '700',
      letterSpacing: 0,
      fontFamily: F,
    },
    // Rung 4 (quaternary): the "@" prefix is decoration around the handle.
    compactHandleAt: {
      color: c.textQuaternary,
      fontSize: 13,
      fontWeight: '600',
      fontFamily: F,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    avatar: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: c.surfaceAlt,
    },
    // Matches the feed card's own avatar (34 + 10 gutter) so the post text and
    // the action row below it start on the same vertical line.
    avatarCompact: {
      width: 34,
      height: 34,
      borderRadius: 17,
    },
    avatarFallback: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.text,
    },
    avatarInitials: {
      color: c.background,
      fontSize: 13,
      fontWeight: '800',
      fontFamily: F,
    },
    identity: {
      flex: 1,
      minWidth: 0,
    },
    displayName: {
      color: c.text,
      fontSize: 15,
      lineHeight: 19,
      fontWeight: '800',
      fontFamily: F,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minWidth: 0,
      gap: 4,
    },
    handle: {
      flexShrink: 1,
      color: c.textSecondary,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: '500',
      fontFamily: F,
    },
    metaDot: {
      color: c.textTertiary,
      fontSize: 13,
      fontFamily: F,
    },
    date: {
      color: c.textTertiary,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: '500',
      fontFamily: F,
    },
    xButton: {
      width: 30,
      height: 30,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'flex-start',
    },
    // Badge-sized and inline with the handle, so it must not out-height a
    // single line of text.
    xButtonCompact: {
      width: 17,
      height: 19,
      alignSelf: 'center',
      alignItems: 'center',
      justifyContent: 'center',
    },
    body: {
      marginTop: 12,
      color: c.text,
      fontSize: 16,
      lineHeight: 23,
      fontWeight: '500',
      fontFamily: F,
    },
    bodyWithoutIdentity: {
      marginTop: 0,
    },
    // Same type as the feed's own thesis text (cardThesisText).
    bodyCompact: {
      marginTop: 0,
      fontSize: 16,
      lineHeight: 23,
    },
    bodyWrap: {
      position: 'relative',
    },
    measureText: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      opacity: 0,
    },
    moreButton: {
      alignSelf: 'flex-start',
      marginTop: 5,
      paddingVertical: 2,
    },
    moreText: {
      color: c.accentBlue,
      fontSize: 14,
      lineHeight: 18,
      fontWeight: '600',
      fontFamily: F,
    },
    // Embed variant: the boxed quoted-post frame X itself uses, so a cited
    // post reads as a foreign object on the screen rather than our own copy.
    embedCard: {
      borderRadius: 16,
      backgroundColor: c.surface,
      paddingHorizontal: 14,
      paddingTop: 12,
      paddingBottom: 11,
      marginTop: 12,
      // Lifted rather than outlined: the card separates from the screen by
      // depth, so nothing draws a hard line around someone else's post.
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 14,
      elevation: 3,
    },
    // The corner stamp, and the room the header leaves for it so a long
    // display name truncates before it reaches the mark.
    embedMark: {
      position: 'absolute',
      // Inset from both edges so the stamp reads as placed in the corner
      // rather than pinned against it — a rounded corner needs the room.
      top: 17,
      right: 18,
    },
    embedHeaderWithMark: {
      paddingRight: 30,
    },
    embedHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    embedAvatar: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: c.surfaceAlt,
    },
    embedHeadline: {
      marginTop: 11,
      color: c.text,
      fontSize: 16,
      lineHeight: 21,
      fontWeight: '800',
      fontFamily: F,
    },
    // The excerpt already sits under a headline, so it drops the header gap.
    embedBodyUnderHeadline: {
      marginTop: 5,
      color: c.textSecondary,
      fontSize: 15,
      lineHeight: 21,
      fontWeight: '500',
    },
  });
