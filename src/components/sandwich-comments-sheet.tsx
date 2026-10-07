import {
  BottomSheetFlatList,
  BottomSheetFooter,
  type BottomSheetFooterProps,
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { SheetModal } from '@/components/sheet-modal';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  type LayoutChangeEvent,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BlurBackdrop } from '@/components/blur-backdrop';
import { HandleText } from '@/components/handle-text';
import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import {
  commentThreadFor,
  deleteThreadComment,
  getThreadComments,
  humanizeErrorMessage,
  postThreadComment,
  type SandwichComment,
  type CommentThread,
  type Sandwich,
} from '@/lib/api';
import { useThemeStore } from '@/lib/theme-store';
import { useToast } from '@/lib/toast-store';
import { PressableScale } from '@/components/pressable-scale';

const MAX_COMMENT_LENGTH = 500;

export type SandwichCommentsSheetRef = {
  /**
   * Open the CARD's thread. An episode has ONE thread rather than one per
   * market: the markets render as a single card, and threads keyed to them
   * could not see each other. The market the reader had open rides along as the
   * anchor for whatever they write.
   */
  open: (card: CommentTarget, initialCount?: number) => void;
  close: () => void;
};

/** Enough of a market to find its thread and report a count back. */
export type CommentTarget = Pick<Sandwich, 'id' | 'postId'>;

type Props = {
  /**
   * Reports the thread's new total. Keyed by post id where the card has one,
   * and by market id otherwise — the same key the caller opened with.
   */
  onCountChange?: (threadKey: string, count: number) => void;
};

function relativeTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  // Anything under a minute is "now" — rounding 50s down to `0m` was the label
  // every freshly posted comment wore for its first minute.
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function authorLabel(comment: SandwichComment): string {
  return comment.author.username?.replace(/^@+/, '') || comment.author.name || 'bread user';
}

function initials(comment: SandwichComment): string {
  return authorLabel(comment)
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'B';
}

export const SandwichCommentsSheet = forwardRef<SandwichCommentsSheetRef, Props>(
  function SandwichCommentsSheet({ onCountChange }, ref) {
    const sheetRef = useRef<BottomSheetModal>(null);
    const listRef = useRef<React.ComponentRef<typeof BottomSheetFlatList>>(null);
    const requestIdRef = useRef(0);
    const { colors } = useThemeStore();
    const styles = useThemedStyles(makeStyles);
    const insets = useSafeAreaInsets();
    const toast = useToast();
    const snapPoints = useMemo(() => ['60%', '94%'], []);

    // The thread being shown, and the key the opener knows it by.
    const [threadKey, setThreadKey] = useState<string | null>(null);
    const threadRef = useRef<CommentThread | null>(null);
    const [comments, setCommentsState] = useState<SandwichComment[]>([]);
    // Mirrors `comments` for the same reason `knownCountRef` mirrors the count:
    // post/delete need the live list inside async callbacks.
    const commentsRef = useRef<SandwichComment[]>([]);
    const [knownCount, setKnownCountState] = useState(0);
    // Mirrors `knownCount`. Post/delete run in async callbacks and need the
    // live total right away; a state updater does not run synchronously.
    const knownCountRef = useRef(0);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [draft, setDraft] = useState('');
    const [submitting, setSubmitting] = useState(false);
    // The composer floats over the list, so the list has to reserve exactly its
    // height — a hard-coded guess either clipped the last comment or left a gap.
    const [composerHeight, setComposerHeight] = useState(72);
    const [keyboardVisible, setKeyboardVisible] = useState(false);

    // `keyboardBehavior="interactive"` lifts the whole sheet to sit on top of
    // the keyboard, which already clears the home indicator. Keeping the safe
    // area padding on top of that left a dead 34pt band under the input.
    useEffect(() => {
      const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
      const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
      const show = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
      const hide = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
      return () => {
        show.remove();
        hide.remove();
      };
    }, []);

    const onComposerLayout = useCallback((event: LayoutChangeEvent) => {
      const next = Math.round(event.nativeEvent.layout.height);
      setComposerHeight((current) => (Math.abs(current - next) > 1 ? next : current));
    }, []);

    const setComments = useCallback(
      (next: SandwichComment[] | ((current: SandwichComment[]) => SandwichComment[])) => {
        const resolved = typeof next === 'function' ? next(commentsRef.current) : next;
        commentsRef.current = resolved;
        setCommentsState(resolved);
        return resolved;
      },
      [],
    );

    const setKnownCount = useCallback((next: number) => {
      const normalized = Math.max(0, next);
      knownCountRef.current = normalized;
      setKnownCountState(normalized);
      return normalized;
    }, []);

    const loadFirstPage = useCallback(async (thread: CommentThread, key: string) => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const page = await getThreadComments(thread);
        if (requestId !== requestIdRef.current) return;
        setComments(page.comments);
        setNextCursor(page.nextCursor);
        setKnownCount(page.totalCount);
        onCountChange?.(key, page.totalCount);
      } catch (cause) {
        if (requestId !== requestIdRef.current) return;
        setError(humanizeErrorMessage(cause, "Couldn't load comments."));
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    }, [onCountChange, setComments, setKnownCount]);

    useImperativeHandle(ref, () => ({
      open(card, initialCount = 0) {
        const key = (card.postId ?? card.id).trim();
        if (!key) return;
        const thread = commentThreadFor(card);
        Keyboard.dismiss();
        setThreadKey(key);
        threadRef.current = thread;
        setComments([]);
        setKnownCount(Math.max(0, initialCount));
        setNextCursor(null);
        setDraft('');
        setError(null);
        sheetRef.current?.present();
        void loadFirstPage(thread, key);
      },
      close() {
        sheetRef.current?.dismiss();
      },
    }), [loadFirstPage, setComments, setKnownCount]);

    const loadMore = useCallback(async () => {
      const thread = threadRef.current;
      if (!thread || !nextCursor || loading || loadingMore) return;
      setLoadingMore(true);
      try {
        const page = await getThreadComments(thread, nextCursor);
        setComments((current) => {
          const existing = new Set(current.map((comment) => comment.id));
          return [...current, ...page.comments.filter((comment) => !existing.has(comment.id))];
        });
        setNextCursor(page.nextCursor);
      } catch (cause) {
        toast.showToast(humanizeErrorMessage(cause, "Couldn't load more comments."), 'error');
      } finally {
        setLoadingMore(false);
      }
    }, [loading, loadingMore, nextCursor, setComments, toast]);

    const submit = useCallback(async () => {
      const body = draft.trim();
      const thread = threadRef.current;
      if (!threadKey || !thread || !body || submitting) return;
      setSubmitting(true);
      try {
        const created = await postThreadComment(thread, body);
        setComments((current) => [created, ...current.filter((row) => row.id !== created.id)]);
        setDraft('');
        // Newest-first list: the comment lands at the top, so a list scrolled
        // down would swallow it and the post would read as a no-op.
        requestAnimationFrame(() => {
          listRef.current?.scrollToOffset({ offset: 0, animated: true });
        });
        const count = setKnownCount(knownCountRef.current + 1);
        onCountChange?.(threadKey, count);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (cause) {
        toast.showToast(humanizeErrorMessage(cause, "Couldn't post comment."), 'error');
      } finally {
        setSubmitting(false);
      }
    }, [draft, onCountChange, threadKey, setComments, setKnownCount, submitting, toast]);

    const confirmDelete = useCallback((comment: SandwichComment) => {
      const thread = threadRef.current;
      if (!threadKey || !thread || !comment.viewerCanDelete) return;
      Alert.alert('Delete comment?', 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const removedIndex = commentsRef.current.findIndex((row) => row.id === comment.id);
            const previousCount = knownCountRef.current;
            setComments((current) => current.filter((row) => row.id !== comment.id));
            const nextCount = setKnownCount(previousCount - 1);
            onCountChange?.(threadKey, nextCount);
            void deleteThreadComment(thread, comment.id).catch((cause: unknown) => {
              // Put it back where it was, not at the top — a failed delete that
              // reordered the thread looked like the comment had been reposted.
              setComments((current) => {
                if (current.some((row) => row.id === comment.id)) return current;
                const restored = [...current];
                restored.splice(removedIndex < 0 ? restored.length : removedIndex, 0, comment);
                return restored;
              });
              setKnownCount(previousCount);
              onCountChange?.(threadKey, previousCount);
              toast.showToast(humanizeErrorMessage(cause, "Couldn't delete comment."), 'error');
            });
          },
        },
      ]);
    }, [onCountChange, threadKey, setComments, setKnownCount, toast]);

    const renderComment = useCallback(({ item }: { item: SandwichComment }) => (
      <View style={styles.commentRow}>
        {item.author.avatarUrl ? (
          <Image source={{ uri: item.author.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarText}>{initials(item)}</Text>
          </View>
        )}
        <View style={styles.commentBody}>
          <View style={styles.commentMetaRow}>
            <HandleText numberOfLines={1} style={styles.author}>{`@${authorLabel(item)}`}</HandleText>
            <Text style={styles.timestamp}>{relativeTime(item.createdAt)}</Text>
            {item.viewerCanDelete ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Delete comment"
                hitSlop={10}
                onPress={() => confirmDelete(item)}
                style={styles.deleteButton}
              >
                <Ionicons name="trash-outline" size={15} color={colors.textTertiary} />
              </PressableScale>
            ) : null}
          </View>
          <Text selectable style={styles.commentText}>{item.body}</Text>
        </View>
      </View>
    ), [colors.textTertiary, confirmDelete, styles]);

    const remaining = MAX_COMMENT_LENGTH - draft.length;
    const canSubmit = !!draft.trim() && !submitting;

    // The composer is the sheet's FOOTER, not a child of the content view. The
    // content view is laid out at the tallest snap point, so a bar pinned to
    // its bottom sat below the screen at the 60% detent — the sheet opened with
    // no input at all. The footer tracks the visible bottom at every detent and
    // rides the keyboard.
    const renderFooter = useCallback(
      (props: BottomSheetFooterProps) => (
        <BottomSheetFooter {...props}>
          <View
            onLayout={onComposerLayout}
            style={[
              styles.composerWrap,
              { paddingBottom: keyboardVisible ? 10 : Math.max(insets.bottom, 12) },
            ]}
          >
            <View style={styles.composer}>
              <BottomSheetTextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Add a comment…"
                placeholderTextColor={colors.textTertiary}
                maxLength={MAX_COMMENT_LENGTH}
                multiline
                autoCapitalize="sentences"
                style={styles.input}
                editable={!submitting}
              />
              {remaining <= 50 ? <Text style={styles.remaining}>{remaining}</Text> : null}
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Post comment"
                accessibilityState={{ disabled: !canSubmit }}
                disabled={!canSubmit}
                onPress={() => void submit()}
                style={[styles.sendButton, !canSubmit && styles.sendButtonDisabled]}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color={colors.actionPrimaryText} />
                ) : (
                  <Ionicons name="arrow-up" size={18} color={colors.actionPrimaryText} />
                )}
              </PressableScale>
            </View>
          </View>
        </BottomSheetFooter>
      ),
      [canSubmit, colors, draft, insets.bottom, keyboardVisible, onComposerLayout, remaining, styles, submit, submitting],
    );

    return (
      <SheetModal
        ref={sheetRef}
        index={0}
        snapPoints={snapPoints}
        topInset={insets.top}
        enableDynamicSizing={false}
        enablePanDownToClose
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
        backdropComponent={BlurBackdrop}
        footerComponent={renderFooter}
        backgroundStyle={styles.sheetBackground}
        // Grab pill hidden app-wide; the handle area still drags.
        handleIndicatorStyle={styles.handleHidden}
        onDismiss={() => {
          requestIdRef.current += 1;
          setThreadKey(null);
          threadRef.current = null;
          setDraft('');
        }}
      >
        <BottomSheetView style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerSide} />
            <View style={styles.headerTitleRow}>
              <Text style={styles.title}>Comments</Text>
              {knownCount > 0 ? <Text style={styles.count}>{knownCount}</Text> : null}
            </View>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Close comments"
              onPress={() => sheetRef.current?.dismiss()}
              hitSlop={10}
              style={styles.headerSide}
            >
              <Ionicons name="close" size={22} color={colors.text} />
            </PressableScale>
          </View>

          {loading ? (
            <View style={[styles.centerState, { paddingBottom: composerHeight }]}>
              <ActivityIndicator color={colors.accentBlue} />
            </View>
          ) : error ? (
            <View style={[styles.centerState, { paddingBottom: composerHeight }]}>
              <Ionicons name="chatbubble-ellipses-outline" size={30} color={colors.textTertiary} />
              <Text style={styles.stateText}>{error}</Text>
              <PressableScale
                accessibilityRole="button"
                onPress={() =>
                  threadRef.current &&
                  threadKey &&
                  void loadFirstPage(threadRef.current, threadKey)
                }
                style={styles.retryButton}
              >
                <Text style={styles.retryText}>Try again</Text>
              </PressableScale>
            </View>
          ) : (
            <BottomSheetFlatList
              ref={listRef}
              style={styles.commentsList}
              data={comments}
              keyExtractor={(item) => item.id}
              renderItem={renderComment}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              contentContainerStyle={[
                comments.length === 0 ? styles.emptyList : styles.listContent,
                { paddingBottom: composerHeight + 16 },
              ]}
              ListEmptyComponent={(
                <View style={styles.emptyState}>
                  <Ionicons
                    name="chatbubble-ellipses-outline"
                    size={30}
                    color={colors.textTertiary}
                  />
                  <Text style={styles.emptyTitle}>No comments yet</Text>
                  <Text style={styles.emptyText}>Be the first to say something.</Text>
                </View>
              )}
              ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.moreSpinner} color={colors.accentBlue} /> : null}
              onEndReached={() => void loadMore()}
              onEndReachedThreshold={0.35}
            />
          )}

        </BottomSheetView>
      </SheetModal>
    );
  },
);

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    sheetBackground: { backgroundColor: c.background, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
    handleHidden: { backgroundColor: 'transparent' },
    // `BottomSheetView` layers its own `{ position: 'absolute', top/left/right: 0 }`
    // over whatever it is given, with no `bottom` — so the view sizes to its
    // content and `flex: 1` never applies. `bottom: 0` stretches it to the
    // sheet's full height, which is what the absolutely-positioned composer
    // below anchors against; without it the composer floats mid-sheet.
    sheet: { flex: 1, bottom: 0 },
    header: {
      minHeight: 48,
      paddingHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headerSide: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    title: { color: c.text, fontFamily: Fonts.rounded, fontSize: 17, fontWeight: '800' },
    count: { color: c.textTertiary, fontFamily: Fonts.rounded, fontSize: 13, fontWeight: '700' },
    // Content is laid out at the TALLEST detent, so a vertically centred state
    // sat behind the composer at 60%. Top-anchored reads the same at both.
    centerState: { flex: 1, alignItems: 'center', gap: 12, paddingHorizontal: 28, paddingTop: 72 },
    stateText: { color: c.textSecondary, fontFamily: Fonts.rounded, fontSize: 14, textAlign: 'center' },
    retryButton: { borderRadius: 999, backgroundColor: c.surfaceAlt, paddingHorizontal: 16, paddingVertical: 9 },
    retryText: { color: c.text, fontFamily: Fonts.rounded, fontWeight: '800', fontSize: 13 },
    commentsList: { flex: 1 },
    listContent: { paddingHorizontal: 18, paddingTop: 8 },
    emptyList: { flexGrow: 1 },
    emptyState: { flex: 1, alignItems: 'center', gap: 8, paddingHorizontal: 30, paddingTop: 72 },
    emptyTitle: { color: c.text, fontFamily: Fonts.rounded, fontSize: 15, fontWeight: '800' },
    emptyText: { color: c.textTertiary, fontFamily: Fonts.rounded, fontSize: 13, fontWeight: '500', textAlign: 'center' },
    commentRow: { flexDirection: 'row', gap: 11, paddingVertical: 12 },
    avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: c.surfaceAlt },
    avatarFallback: { width: 38, height: 38, borderRadius: 19, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: c.textSecondary, fontFamily: Fonts.rounded, fontSize: 12, fontWeight: '800' },
    commentBody: { flex: 1, minWidth: 0 },
    commentMetaRow: { minHeight: 20, flexDirection: 'row', alignItems: 'center', gap: 7 },
    author: { flexShrink: 1, color: c.text, fontFamily: Fonts.rounded, fontSize: 13, fontWeight: '800' },
    timestamp: { color: c.textTertiary, fontFamily: Fonts.rounded, fontSize: 12 },
    deleteButton: { width: 28, height: 28, marginLeft: 'auto', alignItems: 'center', justifyContent: 'center' },
    commentText: { color: c.text, fontFamily: Fonts.rounded, fontSize: 15, lineHeight: 21 },
    moreSpinner: { marginVertical: 16 },
    composerWrap: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      backgroundColor: c.background,
      paddingHorizontal: 12,
      paddingTop: 10,
    },
    composer: { minHeight: 46, maxHeight: 118, borderRadius: 12, backgroundColor: c.surfaceAlt, flexDirection: 'row', alignItems: 'flex-end', paddingLeft: 15, paddingRight: 5, paddingVertical: 5 },
    input: { flex: 1, minHeight: 36, maxHeight: 96, paddingTop: 8, paddingBottom: 7, color: c.text, fontFamily: Fonts.rounded, fontSize: 15, lineHeight: 20 },
    remaining: { color: c.textTertiary, fontFamily: Fonts.rounded, fontSize: 11, paddingBottom: 11, paddingHorizontal: 6 },
    sendButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.actionPrimary, alignItems: 'center', justifyContent: 'center' },
    sendButtonDisabled: { opacity: 0.35 },
  });
}
