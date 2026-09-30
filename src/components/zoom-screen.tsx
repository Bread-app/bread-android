import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import type { SharedValue } from 'react-native-reanimated';

import type { ZoomSourceRect } from '@/lib/zoom-transition';

export type ZoomScreenRef = {
  /** Collapse back into the source rect, then call `onDismissed`. */
  dismiss: () => void;
};

type ZoomScreenProps = {
  /** Rect the pressed row occupied. Null presents from the bottom edge instead. */
  source: ZoomSourceRect | null;
  /** Fill of the growing card — match the destination's own background or the
   *  first frames show a hole where the row used to be. */
  backgroundColor: string;
  /** Called once the collapse has finished; pop the route from here. */
  onDismissed: () => void;
  /**
   * Fires true when the card has finished growing and false the moment a
   * dismissal starts. Hosts use it to hold back anything that cannot survive
   * being inside a transformed, clipped surface — native Liquid Glass paints no
   * fill in one (measured on iOS 26), so it must not switch on until then.
   */
  onSettledChange?: (settled: boolean) => void;
  /**
   * Whether the drag-to-collapse gesture is live. Hosts turn it off while an
   * overlay of their own is raised (a trade pad), so a downward drag closes
   * that overlay instead of throwing the whole screen away underneath it.
   */
  dismissEnabled?: boolean;
  /**
   * Set by an interactive child while it owns the current touch sequence.
   * Checked on the UI thread so a chart pinch cannot race a React state update
   * and accidentally become a downward screen dismissal.
   */
  dismissGestureLocked?: SharedValue<boolean>;
  /**
   * The destination's own scroll offset. The drag-to-collapse gesture spans the
   * WHOLE screen, so it has to know when the content underneath still has
   * scrolling left to do — a downward drag claims the screen only at the very
   * top, exactly as it does on a UIKit sheet. Omit it for content that does not
   * scroll.
   */
  contentOffset?: SharedValue<number>;
  /**
   * How many points at the TOP of the destination are chrome the source row has
   * no counterpart for — safe-area padding and the like.
   *
   * Without this the transition opens on a blank card: a row is ~74pt tall, so
   * at the first frame only the top ~82pt of the destination shows, and if the
   * first 75pt of that is padding there is nothing in it. The content is lifted
   * by this much at the start so the destination's own header lands where the
   * row's content was, and settles back as the card grows — which is what makes
   * the row look like it BECAME the screen rather than like a card opening and
   * then filling in.
   */
  contentLift?: number;
  children: React.ReactNode;
};

/** Past this much downward travel (or its velocity projection), release closes. */
const DISMISS_TRAVEL = 130;
/** Downward travel that claims the gesture from the content's scroll view. */
const CLAIM_TRAVEL = 10;
/** Sideways travel that hands it back (a chart scrub, a tab strip). */
const RELEASE_TRAVEL = 10;
/**
 * Collapse is deliberately faster than the open and clamped: a dismissal should
 * feel like the screen snapping back into its row, and any overshoot on the way
 * in reads as the card bouncing on a row it has already reached.
 */
const COLLAPSE_SPRING = {
  damping: 34,
  stiffness: 440,
  mass: 0.85,
  overshootClamping: true,
} as const;
/** How far a full-height drag shrinks the card back toward its source rect. */
const DRAG_SHRINK = 0.42;
/**
 * Roughly how far a list row insets its own content from its top edge. The
 * destination's header is lifted to sit at the same inset, so the two line up
 * on the first frame instead of the header starting a row-height too low.
 */
const SOURCE_CONTENT_INSET = 16;
/** The display's own corner radius, which a full-screen card ends flush with. */
const DISPLAY_CORNER_RADIUS = 44;

/**
 * The iOS 18 "zoom" presentation, rebuilt in JS.
 *
 * UIKit's real `preferredTransition = .zoom` is not reachable from React
 * Native: `react-native-screens` exposes no such `stackAnimation` and has no
 * way to name a source view across the bridge, and Reanimated 4 dropped
 * `sharedTransitionTag`. So this reproduces it — a card that grows out of the
 * tapped row's measured rect into the full screen, carrying a scaled-down
 * miniature of the destination inside it, and collapses back into that same
 * rect on an interactive downward drag.
 *
 * Two rules hold the illusion together:
 *
 * 1. **The child is laid out at full-screen size from the first frame** and
 *    scaled by the container's own growth factor, anchored top-left. Sizing the
 *    child to the container instead would re-run Yoga over the entire
 *    destination on every frame of the transition.
 * 2. **The drag shrinks the card toward the source**, it does not just slide it
 *    away. That is what makes a half-committed dismissal read as the screen
 *    returning to the row it came from.
 *
 * Mount it inside a `transparentModal` route so the list underneath stays
 * visible behind the growing card.
 */
export const ZoomScreen = forwardRef<ZoomScreenRef, ZoomScreenProps>(
  function ZoomScreen(
    {
      source,
      backgroundColor,
      onDismissed,
      onSettledChange,
      dismissEnabled = true,
      dismissGestureLocked,
      contentOffset,
      contentLift = 0,
      children,
    },
    ref,
  ) {
    const { width: screenW, height: screenH } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const progress = useSharedValue(0);
    const dragY = useSharedValue(0);
    const dismissing = useRef(false);
    // Where the current touch started, for the manual activation decision below.
    const touchStartX = useSharedValue(0);
    const touchStartY = useSharedValue(0);
    // Stands in for a host that reports no scroll offset: always at the top, so
    // a downward drag anywhere claims the screen.
    const staticOffset = useSharedValue(0);
    const offset = contentOffset ?? staticOffset;

    // No measurable source (a cold entry, a row that scrolled away): grow from
    // the bottom edge, which degrades to the sheet-like presentation this
    // screen replaced rather than to a jump cut.
    const rect = useMemo<ZoomSourceRect>(
      () =>
        source ?? {
          x: 0,
          y: screenH,
          width: screenW,
          height: Math.round(screenH * 0.08),
          borderRadius: 28,
        },
      [source, screenH, screenW],
    );

    const settle = useCallback(
      (settled: boolean) => onSettledChange?.(settled),
      [onSettledChange],
    );

    useEffect(() => {
      progress.value = withSpring(
        1,
        // Snappier and slightly tighter than a sheet's: UIKit's zoom arrives
        // quickly and settles, rather than easing the whole way in.
        { damping: 26, stiffness: 340, mass: 0.9 },
        (finished) => {
          'worklet';
          if (finished) runOnJS(settle)(true);
        },
      );
      // Runs once per presentation: the rect is fixed for the life of the route.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const dismiss = useCallback(() => {
      if (dismissing.current) return;
      dismissing.current = true;
      settle(false);
      // Both values ride the SAME spring. Running them on different curves made
      // the card travel back up and shrink as two visibly separate motions,
      // which is what read as a slow close.
      dragY.value = withSpring(0, COLLAPSE_SPRING);
      progress.value = withSpring(0, COLLAPSE_SPRING, (finished) => {
        'worklet';
        if (finished) runOnJS(onDismissed)();
      });
    }, [dragY, onDismissed, progress, settle]);

    useImperativeHandle(ref, () => ({ dismiss }), [dismiss]);

    /**
     * Drag to collapse, from anywhere on the screen.
     *
     * Manual activation is what lets this coexist with the destination's scroll
     * view instead of fighting it: the gesture watches the raw touches and only
     * claims them for a deliberate downward drag that begins with the content
     * already at its top. Anything else — a tap, an upward drag, a sideways
     * scrub — is failed outright, so the touch reaches the content untouched.
     */
    const pan = useMemo(
      () =>
        Gesture.Pan()
          .manualActivation(true)
          .onTouchesDown((event, manager) => {
            'worklet';
            // A screen collapse is deliberately one-finger. In particular, a
            // pinch-out moves one of its fingers downward and used to satisfy
            // the dismiss threshold before the chart could claim the pinch.
            if (event.allTouches.length > 1 || dismissGestureLocked?.value) {
              manager.fail();
              return;
            }
            const touch = event.allTouches[0];
            if (!touch) return;
            touchStartX.value = touch.absoluteX;
            touchStartY.value = touch.absoluteY;
          })
          .onTouchesMove((event, manager) => {
            'worklet';
            if (
              !dismissEnabled ||
              event.allTouches.length > 1 ||
              dismissGestureLocked?.value
            ) {
              manager.fail();
              return;
            }
            const touch = event.allTouches[0];
            if (!touch) return;
            const dx = touch.absoluteX - touchStartX.value;
            const dy = touch.absoluteY - touchStartY.value;
            if (Math.abs(dx) > Math.abs(dy)) {
              if (Math.abs(dx) > RELEASE_TRAVEL) manager.fail();
              return;
            }
            if (dy < 0) {
              // Upward: always the content's, whether it scrolls or not.
              manager.fail();
              return;
            }
            if (dy > CLAIM_TRAVEL) {
              if (offset.value <= 2) manager.activate();
              else manager.fail();
            }
          })
          .onUpdate((event) => {
            'worklet';
            if (event.translationY >= 0) {
              dragY.value = event.translationY;
            } else {
              // Rubber-band upward rather than hard-stopping at zero.
              const overshoot = -event.translationY;
              const dimension = 420;
              dragY.value =
                -(overshoot * dimension * 0.48) / (dimension + 0.48 * overshoot);
            }
          })
          .onEnd((event) => {
            'worklet';
            // Distance and release velocity decide together, so a fast flick
            // from anywhere closes and a slow drag only commits if it went far.
            const projected =
              event.translationY + Math.max(0, event.velocityY) * 0.18;
            if (projected > DISMISS_TRAVEL) {
              runOnJS(dismiss)();
            } else {
              dragY.value = withSpring(0, {
                velocity: event.velocityY,
                damping: 26,
                stiffness: 280,
                mass: 1,
              });
            }
          }),
      [
        dismiss,
        dismissEnabled,
        dismissGestureLocked,
        dragY,
        offset,
        touchStartX,
        touchStartY,
      ],
    );

    const backdropStyle = useAnimatedStyle(() => ({
      opacity:
        interpolate(progress.value, [0, 1], [0, 1], Extrapolation.CLAMP) *
        interpolate(dragY.value, [0, screenH * 0.5], [1, 0.1], Extrapolation.CLAMP),
    }));

    // One interpolation per geometry property, from the row's rect to the full
    // screen. Layout props (not transforms) because the card CLIPS its child:
    // the child keeps its full-screen layout box throughout, so nothing inside
    // the destination reflows while the frame travels.
    const cardStyle = useAnimatedStyle(() => {
      const dragT = interpolate(
        dragY.value,
        [0, screenH * 0.5],
        [0, 1],
        Extrapolation.CLAMP,
      );
      const p = progress.value * (1 - DRAG_SHRINK * dragT);
      return {
        left: interpolate(p, [0, 1], [rect.x, 0]),
        top: interpolate(p, [0, 1], [rect.y, 0]) + dragY.value * 0.35,
        width: interpolate(p, [0, 1], [rect.width, screenW]),
        height: interpolate(p, [0, 1], [rect.height, screenH]),
        // Eases continuously from the row's corners to the display's own, the
        // way UIKit's zoom does — the old curve held the row radius until 90%
        // and then snapped, which read as a cut at the end of the motion.
        borderRadius: interpolate(
          p,
          [0, 1],
          [rect.borderRadius, DISPLAY_CORNER_RADIUS],
          Extrapolation.CLAMP,
        ),
        // The card lifts off the list as it travels and sets back down on it.
        shadowOpacity: interpolate(p, [0, 0.25, 0.9, 1], [0, 0.18, 0.18, 0], Extrapolation.CLAMP),
      };
    });

    // The miniature: the destination rendered at full size, scaled by the card's
    // own width ratio and anchored top-left, then lifted so its header sits
    // exactly where the source row's logo and title were.
    // The grab handle has no counterpart on the source row, so it arrives once
    // the card is nearly a screen rather than being crammed into a row-sized
    // frame at the start.
    const grabberStyle = useAnimatedStyle(() => ({
      opacity: interpolate(progress.value, [0.65, 1], [0, 1], Extrapolation.CLAMP),
    }));

    const contentStyle = useAnimatedStyle(() => {
      const dragT = interpolate(
        dragY.value,
        [0, screenH * 0.5],
        [0, 1],
        Extrapolation.CLAMP,
      );
      const p = progress.value * (1 - DRAG_SHRINK * dragT);
      const startScale = screenW > 0 ? rect.width / screenW : 1;
      // Scale runs first, so this offset is already in screen points.
      const startLift = Math.max(
        contentLift * startScale - SOURCE_CONTENT_INSET,
        0,
      );
      return {
        // Visible from the first frame. Fading the destination up from nothing
        // is what made this read as "a card opens, then fills in" rather than
        // as the row itself becoming the screen.
        opacity: interpolate(p, [0, 0.1], [0.85, 1], Extrapolation.CLAMP),
        transform: [
          { translateY: interpolate(p, [0, 1], [-startLift, 0], Extrapolation.CLAMP) },
          {
            scale: interpolate(p, [0, 1], [startScale, 1], Extrapolation.CLAMP),
          },
        ],
      };
    });

    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Animated.View
          pointerEvents="none"
          style={[styles.backdrop, backdropStyle]}
        />
        {/* The gesture wraps the whole card, not a strip at the top: it claims
            touches manually (see `pan`), so it can span the screen without ever
            taking a tap or a scroll away from the content inside. */}
        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.card, { backgroundColor }, cardStyle]}>
            <Animated.View
              style={[
                styles.content,
                { width: screenW, height: screenH },
                contentStyle,
              ]}
            >
              {children}
            </Animated.View>
            {/* Affordance only — the drag works anywhere. */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.grabberRow,
                { top: Math.max(insets.top - 8, 0) },
                grabberStyle,
              ]}
            >
              <View style={styles.grabber} />
            </Animated.View>
          </Animated.View>
        </GestureDetector>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  card: {
    position: 'absolute',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  content: {
    // Top-left anchoring is what makes the scaled miniature line up with the
    // row: with the default centre origin the header would drift inward as the
    // card grows.
    transformOrigin: 'top left',
  },
  grabberRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(128,128,128,0.45)',
  },
});
