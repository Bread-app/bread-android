import * as Haptics from 'expo-haptics';
import { ActionSheetIOS, Alert, Platform } from 'react-native';

import {
  type ModerationUserRef,
  type ReportReason,
  type ReportTargetType,
  blockUser,
  humanizeErrorMessage,
  reportContent,
  unblockUser,
} from '@/lib/api';

/**
 * Report + block flows (App Review 1.2). Plain system sheets on purpose: they
 * work from any screen, including inside gorhom sheets that are portalled
 * above every provider.
 */

type ShowToast = (message: string, kind: 'success' | 'error' | 'info') => unknown;

const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'scam', label: 'Scam or fraud' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'hate', label: 'Hate speech' },
  { value: 'sexual', label: 'Sexual content' },
  { value: 'violence', label: 'Violence or threats' },
  { value: 'other', label: 'Something else' },
];

// Android's Alert caps out at three buttons.
const ANDROID_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam or scam' },
  { value: 'harassment', label: 'Abusive or hateful' },
  { value: 'other', label: 'Something else' },
];

const NOUN: Record<ReportTargetType, string> = {
  user: 'account',
  sandwich: 'Sandwich',
  comment: 'comment',
};

function pickReason(title: string, onPick: (reason: ReportReason) => void): void {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        message: 'Reports are anonymous. We review them within 24 hours.',
        options: [...REASONS.map((r) => r.label), 'Cancel'],
        cancelButtonIndex: REASONS.length,
      },
      (index) => {
        const reason = REASONS[index];
        if (reason) onPick(reason.value);
      },
    );
    return;
  }
  Alert.alert(title, 'Reports are anonymous. We review them within 24 hours.', [
    ...ANDROID_REASONS.map((r) => ({ text: r.label, onPress: () => onPick(r.value) })),
  ], { cancelable: true });
}

export function openReportFlow(args: {
  targetType: ReportTargetType;
  targetId: string;
  showToast: ShowToast;
}): void {
  pickReason(`Why are you reporting this ${NOUN[args.targetType]}?`, (reason) => {
    void (async () => {
      try {
        await reportContent({ targetType: args.targetType, targetId: args.targetId, reason });
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        args.showToast("Thanks — we'll review this within 24 hours", 'success');
      } catch (error) {
        args.showToast(humanizeErrorMessage(error, "Couldn't send the report. Try again."), 'error');
      }
    })();
  });
}

/** Asks first: a block also removes any follow between the two accounts. */
export function confirmBlock(args: {
  ref: ModerationUserRef;
  handle: string;
  showToast: ShowToast;
  onBlocked?: () => void;
}): void {
  Alert.alert(
    `Block ${args.handle}?`,
    "You won't see each other's Sandwiches or comments, and any follow between you is removed. They won't be told.",
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await blockUser(args.ref);
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              args.showToast(`Blocked ${args.handle}`, 'success');
              args.onBlocked?.();
            } catch (error) {
              args.showToast(humanizeErrorMessage(error, "Couldn't block. Try again."), 'error');
            }
          })();
        },
      },
    ],
  );
}

export async function unblock(args: {
  ref: ModerationUserRef;
  handle: string;
  showToast: ShowToast;
}): Promise<boolean> {
  try {
    await unblockUser(args.ref);
    args.showToast(`Unblocked ${args.handle}`, 'success');
    return true;
  } catch (error) {
    args.showToast(humanizeErrorMessage(error, "Couldn't unblock. Try again."), 'error');
    return false;
  }
}

/**
 * The "…" menu on someone else's content: report the thing, and block its
 * author when there is one.
 */
export function openModerationMenu(args: {
  report: { targetType: ReportTargetType; targetId: string };
  author?: { ref: ModerationUserRef; handle: string; isBlocked?: boolean } | null;
  showToast: ShowToast;
  onBlocked?: () => void;
  onUnblocked?: () => void;
}): void {
  const { report, author, showToast } = args;
  const actions: { label: string; destructive?: boolean; run: () => void }[] = [
    {
      label: `Report ${NOUN[report.targetType]}`,
      destructive: true,
      run: () => openReportFlow({ ...report, showToast }),
    },
  ];
  if (author) {
    actions.push(
      author.isBlocked
        ? {
            label: `Unblock ${author.handle}`,
            run: () => {
              void unblock({ ref: author.ref, handle: author.handle, showToast }).then((ok) => {
                if (ok) args.onUnblocked?.();
              });
            },
          }
        : {
            label: `Block ${author.handle}`,
            destructive: true,
            run: () => confirmBlock({ ref: author.ref, handle: author.handle, showToast, onBlocked: args.onBlocked }),
          },
    );
  }

  void Haptics.selectionAsync();
  if (Platform.OS === 'ios') {
    const destructiveButtonIndex = actions.flatMap((a, i) => (a.destructive ? [i] : []));
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...actions.map((a) => a.label), 'Cancel'],
        cancelButtonIndex: actions.length,
        destructiveButtonIndex,
      },
      (index) => actions[index]?.run(),
    );
    return;
  }
  Alert.alert('', undefined, [
    ...actions.map((a) => ({ text: a.label, style: a.destructive ? ('destructive' as const) : undefined, onPress: a.run })),
    { text: 'Cancel', style: 'cancel' as const },
  ]);
}
