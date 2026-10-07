import {
  BottomSheetModal,
  type BottomSheetModalProps,
} from '@gorhom/bottom-sheet';
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { BackHandler, Platform } from 'react-native';

/**
 * `BottomSheetModal` that closes on Android's hardware/gesture Back.
 *
 * gorhom's sheets are plain views, so Back falls straight through to the
 * navigator and pops the SCREEN underneath an open sheet — the opposite of
 * every Android app, where Back dismisses the topmost surface first. While the
 * sheet is open this registers a Back listener; React Native calls the most
 * recently registered one first, so with stacked sheets the top one closes.
 *
 * A sheet the user can't swipe away (`enablePanDownToClose={false}`, e.g. while
 * a trade is in flight) swallows Back instead, so it can't be bypassed by
 * popping the screen out from under it.
 *
 * Drop-in: same props and the same ref as `BottomSheetModal`.
 */
export const SheetModal = forwardRef<BottomSheetModal, BottomSheetModalProps>(
  function SheetModal({ onChange, onDismiss, enablePanDownToClose = true, ...props }, ref) {
    const sheetRef = useRef<BottomSheetModal>(null);
    useImperativeHandle(ref, () => sheetRef.current as BottomSheetModal, []);

    const [open, setOpen] = useState(false);

    const handleChange = useCallback<NonNullable<BottomSheetModalProps['onChange']>>(
      (index, position, type) => {
        setOpen(index >= 0);
        onChange?.(index, position, type);
      },
      [onChange],
    );

    const handleDismiss = useCallback(() => {
      setOpen(false);
      onDismiss?.();
    }, [onDismiss]);

    useEffect(() => {
      if (Platform.OS !== 'android' || !open) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (enablePanDownToClose) sheetRef.current?.dismiss();
        return true;
      });
      return () => sub.remove();
    }, [enablePanDownToClose, open]);

    return (
      <BottomSheetModal
        ref={sheetRef}
        {...props}
        enablePanDownToClose={enablePanDownToClose}
        onChange={handleChange}
        onDismiss={handleDismiss}
      />
    );
  },
);
