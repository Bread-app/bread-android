import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

import { Colors, Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { withAlpha } from '@/lib/color-utils';
import { useThemeStore } from '@/lib/theme-store';
import { formatLeverage } from '@/lib/phoenix-position-leverage';

const F = Fonts.rounded;

/**
 * Reanimated can only drive text through a TextInput's `text` prop, and the
 * slim readout has to update on the UI thread — see `readoutProps`.
 */
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

const TICK_WIDTH = 2;
/** Crops the moving ruler into a compact, centred window spanning the sheet width. */
const SCRUBBER_SIDE_INSET = 28;
const BUBBLE_WIDTH = 62;
/** Wide enough for "100.0x" at the slim readout's size, without tail ellipsis. */
const SLIM_VALUE_WIDTH = 150;
/**
 * Floor between two selection taps. A fast flick crosses a mark every couple of
 * frames; firing one haptic per crossing both blurs the individual detents into
 * a buzz and puts a main-thread feedback-generator call inside frames the drag
 * needs. A drag slow enough to feel each mark still gets every mark.
 */
const HAPTIC_MIN_GAP_MS = 45;
/** How far a flick's speed carries the rail past the finger, in seconds. */
const FLICK_PROJECTION_S = 0.07;
/**
 * Ceiling on that carry, in whole x. Most of the momentum a flick reads as
 * comes from the settle spring inheriting the finger's velocity; letting the
 * projection itself run unbounded meant a hard flick could hand someone 4x
 * more leverage than they were anywhere near.
 */
const FLICK_MAX_CARRY_X = 1.5;
/** Fraction of the finger the rail still travels past 1x and the ceiling. */
const OVERSCROLL_RESISTANCE = 0.22;
const SETTLE_SPRING = { damping: 24, stiffness: 200, mass: 0.55 };
/** Horizontal distance between two whole-x marks, and the width of each number cell. */
const DEFAULT_SLOT = 74;
const DEFAULT_HEIGHT = 96;
/** Number size at the default frame height; smaller frames scale proportionally. */
const NUMBER_FONT_RATIO = 34 / DEFAULT_HEIGHT;

export type LeverageRulerProps = {
  value: number;
  /** Highest selectable whole-x. At or below 1 the ruler degrades to a static "1x". */
  max: number;
  accent: string;
  onChange: (next: number) => void;
  /** Frame height. Defaults to the perp order pad's 96. */
  height?: number;
  /** Distance between whole-x detents. Shrink it to fit a tighter pad. */
  slot?: number;
  /** Drops the "Leverage" caption when the label already lives elsewhere. */
  hideCaption?: boolean;
  /**
   * `scale` is the compact trading ruler used by the stock-detail order ticket;
   * `carousel` preserves the larger centred-number picker used by Sandwiches;
   * `slim` is the minimal one-line slider the perp ticket uses under the
   * amount, where every point of height belongs to the keypad.
   */
  appearance?: 'carousel' | 'scale' | 'slim';
  /** Optional theme override when rendered on a fixed-scheme surface (e.g. Light glass). */
  forceScheme?: 'light' | 'dark';
  /**
   * Written with the mark under the pointer as the rail moves, before React
   * hears anything. Give the slim rail one of these to drive a readout of your
   * own — a size or a fee that has to track the drag rather than the commit.
   */
  liveValue?: SharedValue<number>;
};

/**
 * Memoised: the pads that host it re-render on every keypad tap, and the
 * carousel mounts an animated cell per whole-x. Its props only change when
 * the leverage itself does.
 */
export const LeverageRuler = React.memo(function LeverageRuler(props: LeverageRulerProps) {
  if (props.appearance === 'slim') return <SlimLeverageSlider {...props} />;
  return props.appearance === 'scale'
    ? <ScaleLeverageRuler {...props} />
    : <CarouselLeverageRuler {...props} />;
});

/**
 * Spacing between marks on the slim rail, in leverage units. Halves, not
 * quarters: leverage is stored and formatted at 0.1 resolution, so a 1.25x
 * detent rendered as "1.3x" over a pointer parked on the 1.25 mark.
 */
function slimStep(max: number): number {
  return max <= 20 ? 0.5 : 1;
}

/** Index of the mark nearest `value`, clamped to the rail's ends. */
function detentIndex(value: number, max: number): number {
  return Math.min(
    Math.round((max - 1) / slimStep(max)),
    Math.max(0, Math.round((value - 1) / slimStep(max))),
  );
}

/**
 * Minimal leverage scrubber with a fixed centre marker, like a mechanical
 * weight scale. The user's drag moves the conceptual scale beneath the marker;
 * the marker and readout never chase the finger.
 *
 * Because the rail is the thing that moves, it is DIRECTLY MANIPULATED: it
 * travels point-for-point with the finger, so dragging left pulls the higher
 * marks — the ones sitting to the right of the pointer — underneath it. The
 * earlier version mapped the finger across the track the way a thumb slider
 * does, which ran the rail backwards and about 1.25x too fast, and made a tap
 * on the mark labelled "3" select something else entirely.
 *
 * Every selectable value is a mark, so the pointer never rests in a gap.
 */
function SlimLeverageSlider({
  value,
  max,
  accent,
  onChange,
  forceScheme,
  liveValue,
}: LeverageRulerProps) {
  const styles = useThemedStyles(makeStyles, forceScheme);
  const [width, setWidth] = useState(0);
  const slide = useSharedValue(value);
  const grabbed = useSharedValue(value);
  const dragging = useSharedValue(0);
  // Raised while the rail springs onto a mark. Without it the controlled-value
  // effect below fires on the commit that starts the spring and snaps the rail
  // straight to its destination, so the settle is never seen.
  const settling = useSharedValue(0);
  // Mark index of the committed value, so a drag only calls back when the rail
  // actually crosses onto a different mark.
  const lastStep = useSharedValue(detentIndex(value, max));
  const lastHapticAt = useSharedValue(0);
  // Translation already spent activating the pan, so the rail doesn't start
  // with a jump. See the gesture's `onStart`.
  const slack = useSharedValue(0);
  const scaleTicks = useMemo(() => {
    // Half steps keep the scale useful without the dense, measuring-tape look
    // of ten marks between every whole leverage value.
    const step = slimStep(max);
    const count = Math.max(1, Math.round((max - 1) / step));
    const majorEvery = Math.round(1 / step);
    return {
      step,
      majorEvery,
      // ~42pt per whole x on the fine rail, 32 on the coarse one.
      gap: step === 0.5 ? 21 : 32,
      items: Array.from({ length: count + 1 }, (_, index) => index),
    };
  }, [max]);

  useEffect(() => {
    if (liveValue) liveValue.value = value;
    if (dragging.value || settling.value) return;
    if (Math.abs(slide.value - value) < 1e-6) return;
    slide.value = value;
    lastStep.value = detentIndex(value, max);
  }, [dragging, lastStep, liveValue, max, settling, slide, value]);

  const commit = useCallback(
    (next: number) => {
      onChange(next);
    },
    [onChange],
  );

  /**
   * One selection tap per mark the rail crosses. Fired straight from the
   * gesture rather than off the committed value, so the feel of the detent
   * never waits on a React render.
   */
  const tickHaptic = useCallback(() => {
    void Haptics.selectionAsync();
  }, []);

  const gesture = useMemo(() => {
    const step = scaleTicks.step;
    const pxPerX = scaleTicks.gap / step;
    const lastIndex = Math.round((max - 1) / step);

    const clamp = (next: number) => {
      'worklet';
      return Math.min(max, Math.max(1, next));
    };
    const detent = (next: number) => {
      'worklet';
      return Math.min(lastIndex, Math.max(0, Math.round((next - 1) / step)));
    };
    const detentValue = (index: number) => {
      'worklet';
      return Math.min(max, Math.round((1 + index * step) * 100) / 100);
    };

    /**
     * Beyond the ends the rail keeps moving, but at a fraction of the finger.
     * A hard clamp is the one place a direct-manipulation control can feel
     * like it snagged on something: the finger keeps going and the marks just
     * stop dead. Release springs it back inside.
     */
    const resist = (next: number) => {
      'worklet';
      if (next > max) return max + (next - max) * OVERSCROLL_RESISTANCE;
      if (next < 1) return 1 - (1 - next) * OVERSCROLL_RESISTANCE;
      return next;
    };

    /**
     * Crossing a mark mid-drag. This is deliberately the cheapest thing that
     * can happen per mark: a throttled haptic and nothing else.
     *
     * Nothing is reported to React until the finger lifts. The rail is drawn
     * from `slide` on the UI thread, but every `onChange` re-renders the pad
     * that owns the leverage — keypad, glass confirm button, leg rows — and
     * under the new architecture that tree is mounted on the main thread, so
     * each one stole frames from the very gesture that caused it. That was the
     * stutter that survived throttling: fewer hitches is not no hitches.
     */
    const cross = (next: number) => {
      'worklet';
      const index = detent(next);
      if (index === lastStep.value) return;
      lastStep.value = index;
      if (liveValue) liveValue.value = detentValue(index);
      const now = Date.now();
      if (now - lastHapticAt.value < HAPTIC_MIN_GAP_MS) return;
      lastHapticAt.value = now;
      runOnJS(tickHaptic)();
    };

    /**
     * Springs the rail onto a mark and reports it. `velocity` carries the
     * finger's speed into the spring, so a flick keeps travelling and eases
     * out instead of stopping the instant the touch ends.
     */
    const settle = (target: number, velocity: number) => {
      'worklet';
      if (liveValue) liveValue.value = target;
      if (detent(target) !== lastStep.value) {
        lastStep.value = detent(target);
        lastHapticAt.value = Date.now();
        runOnJS(tickHaptic)();
      }
      settling.value = 1;
      slide.value = withSpring(target, { ...SETTLE_SPRING, velocity }, () => {
        settling.value = 0;
      });
      runOnJS(commit)(target);
    };

    const pan = Gesture.Pan()
      .activeOffsetX([-4, 4])
      .failOffsetY([-14, 14])
      .onBegin(() => {
        'worklet';
        dragging.value = 1;
        cancelAnimation(slide);
        settling.value = 0;
        grabbed.value = slide.value;
      })
      .onStart((event) => {
        'worklet';
        // The pan only activates after 4pt of travel, and `translationX` counts
        // from the touch down — so without this the rail jumps those 4pt in a
        // single frame the moment the drag begins.
        slack.value = event.translationX;
      })
      .onUpdate((event) => {
        'worklet';
        // The rail travels with the finger, like the drum of a weighing scale:
        // dragging left carries the higher marks that sat to the right of the
        // pointer underneath it.
        const next = resist(grabbed.value - (event.translationX - slack.value) / pxPerX);
        slide.value = next;
        cross(next);
      })
      .onEnd((event) => {
        'worklet';
        // Where the flick would have carried the rail, in leverage units.
        const velocity = -event.velocityX / pxPerX;
        const carry = velocity * FLICK_PROJECTION_S;
        const projected =
          slide.value + Math.max(-FLICK_MAX_CARRY_X, Math.min(FLICK_MAX_CARRY_X, carry));
        settle(detentValue(detent(clamp(projected))), velocity);
      })
      .onFinalize(() => {
        'worklet';
        dragging.value = 0;
      });

    const tap = Gesture.Tap()
      .maxDistance(10)
      .onEnd((event) => {
        'worklet';
        if (width <= 0) return;
        // Tapping a mark brings that mark to the pointer, so the number under
        // the finger is the number selected. Treating the track as an absolute
        // slider instead meant tapping "3" could hand back 7x.
        settle(detentValue(detent(clamp(slide.value + (event.x - width / 2) / pxPerX))), 0);
      });

    return Gesture.Race(pan, tap);
    // Rebuilt only on the things that change the rail itself. Notably NOT on
    // `value`: a gesture object swapped underneath an in-flight drag is
    // re-attached by the detector mid-gesture, which is its own source of
    // stutter.
  }, [
    commit,
    dragging,
    grabbed,
    lastHapticAt,
    lastStep,
    liveValue,
    max,
    scaleTicks,
    settling,
    slack,
    slide,
    tickHaptic,
    width,
  ]);

  /**
   * The readout is driven from the rail, not from React state: at the throttled
   * commit cadence a JS-rendered number visibly trails the marks under the
   * pointer. It shows the detent, so it snaps mark to mark while the rail
   * glides continuously beneath it.
   */
  const readoutProps = useAnimatedProps(() => {
    const step = scaleTicks.step;
    const index = Math.min(
      Math.round((max - 1) / step),
      Math.max(0, Math.round((slide.value - 1) / step)),
    );
    const shown = Math.min(max, Math.round((1 + index * step) * 10) / 10);
    const text = `${Number.isInteger(shown) ? shown : shown.toFixed(1)}x`;
    // `text` is a TextInput-only animated prop and isn't in its public props.
    return { text, defaultValue: text } as unknown as TextInputProps;
  });

  const scaleStyle = useAnimatedStyle(() => {
    const selectedTick = (slide.value - 1) / scaleTicks.step;
    return {
      transform: [{ translateX: -selectedTick * scaleTicks.gap }],
    };
  });

  if (max <= 1) {
    return (
      <View style={styles.slimStatic}>
        <Text style={[styles.slimValue, styles.slimStaticValue, { color: accent }]}>1x</Text>
      </View>
    );
  }

  return (
    <View style={styles.slimRow}>
      <GestureDetector gesture={gesture}>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Leverage"
          accessibilityValue={{ min: 1, max, now: value, text: formatLeverage(value) }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => {
            const nudge = scaleTicks.step;
            const direction = event.nativeEvent.actionName === 'increment' ? nudge : -nudge;
            const next = Math.min(max, Math.max(1, Math.round((value + direction) * 100) / 100));
            void Haptics.selectionAsync();
            onChange(next);
          }}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          style={styles.slimTrackArea}
          hitSlop={{ top: 12, bottom: 12 }}
        >
          <AnimatedTextInput
            editable={false}
            pointerEvents="none"
            numberOfLines={1}
            defaultValue={formatLeverage(value)}
            animatedProps={readoutProps}
            style={[styles.slimValue, styles.slimCenteredValue, { color: accent }]}
          />
          <View style={styles.slimTrack} />
          <View pointerEvents="none" style={styles.slimScaleViewport}>
            <Animated.View style={[styles.slimScale, scaleStyle]}>
              {scaleTicks.items.map((tick) => {
                const major = tick % scaleTicks.majorEvery === 0;
                return (
                  <React.Fragment key={tick}>
                    <View
                      style={[
                        major ? styles.slimMajorTick : styles.slimMinorTick,
                        { left: tick * scaleTicks.gap },
                      ]}
                    />
                    {major ? (
                      <Text
                        style={[
                          styles.slimTickLabel,
                          { left: tick * scaleTicks.gap - 17 },
                        ]}
                      >
                        {Math.round(1 + tick * scaleTicks.step)}
                      </Text>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </Animated.View>
          </View>
          <View
            pointerEvents="none"
            style={[styles.slimPointer, { borderTopColor: accent }]}
          />
        </View>
      </GestureDetector>
    </View>
  );
}

/**
 * Fine-grained ruler used by the stock-detail perp ticket. The rail stays put
 * while the value bubble and active needle follow the finger, matching the
 * visual hierarchy of a physical measuring scale rather than a generic slider.
 */
function ScaleLeverageRuler({
  value,
  max,
  accent,
  onChange,
  height = 88,
  hideCaption = false,
  forceScheme,
}: LeverageRulerProps) {
  const styles = useThemedStyles(makeStyles, forceScheme);
  const { colors: currentColors } = useThemeStore();
  const colors = forceScheme ? Colors[forceScheme] : currentColors;
  const [width, setWidth] = useState(0);
  const scaleValue = useSharedValue(value);
  const dragging = useSharedValue(0);
  const lastStep = useSharedValue(Math.round(value * 10));
  const sideInset = 10;

  useEffect(() => {
    if (dragging.value) return;
    scaleValue.value = withSpring(value, { damping: 24, stiffness: 230, mass: 0.65 });
    lastStep.value = Math.round(value * 10);
  }, [dragging, lastStep, scaleValue, value]);

  const commit = (next: number, haptic: boolean) => {
    if (haptic) void Haptics.selectionAsync();
    onChange(next);
  };

  const valueForX = (x: number) => {
    'worklet';
    const usable = Math.max(1, width - sideInset * 2);
    const progress = Math.min(1, Math.max(0, (x - sideInset) / usable));
    return 1 + progress * (max - 1);
  };

  const report = (next: number) => {
    'worklet';
    const step = Math.round(next * 10);
    if (step === lastStep.value) return;
    lastStep.value = step;
    runOnJS(commit)(step / 10, step % 10 === 0);
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-5, 5])
    .failOffsetY([-12, 12])
    .onBegin(() => {
      'worklet';
      dragging.value = 1;
      cancelAnimation(scaleValue);
    })
    .onUpdate((event) => {
      'worklet';
      const next = valueForX(event.x);
      scaleValue.value = next;
      report(next);
    })
    .onEnd(() => {
      'worklet';
      const target = Math.round(scaleValue.value * 10) / 10;
      scaleValue.value = withSpring(target, { damping: 24, stiffness: 240, mass: 0.65 });
      report(target);
    })
    .onFinalize(() => {
      'worklet';
      dragging.value = 0;
    });

  const tap = Gesture.Tap()
    .maxDistance(12)
    .onEnd((event) => {
      'worklet';
      const target = Math.round(valueForX(event.x) * 10) / 10;
      scaleValue.value = withSpring(target, { damping: 24, stiffness: 240, mass: 0.65 });
      report(target);
    });

  const gesture = Gesture.Race(pan, tap);
  const usableWidth = Math.max(1, width - sideInset * 2);
  /**
   * The rail is pinned a fixed distance off the BOTTOM of the frame, not at a
   * hard-coded 48pt: the same ruler has to fit under the perp pad's amount at
   * ~80pt and under the stock ticket's caption at 88pt, and a fixed top would
   * push the tick labels straight out of the shorter frame.
   */
  const railTop = Math.max(36, height - 40);
  const markerStyle = useAnimatedStyle(() => {
    const progress = max <= 1 ? 0 : (scaleValue.value - 1) / (max - 1);
    return {
      transform: [{ translateX: sideInset + progress * usableWidth - 1.5 }],
    };
  });
  const bubbleStyle = useAnimatedStyle(() => {
    const progress = max <= 1 ? 0 : (scaleValue.value - 1) / (max - 1);
    const center = sideInset + progress * usableWidth;
    const left = Math.min(Math.max(0, center - BUBBLE_WIDTH / 2), Math.max(0, width - BUBBLE_WIDTH));
    return { transform: [{ translateX: left }] };
  });

  const tickModel = useMemo(() => {
    // Preserve the reference's dense 0.1x ruler on small ranges, then reduce
    // decorative tick density as the market range grows so a 100x market does
    // not mount a thousand tiny Views that are closer than a physical pixel.
    const subdivisions = max <= 6 ? 10 : max <= 12 ? 5 : max <= 25 ? 2 : 1;
    const count = Math.max(0, Math.round((max - 1) * subdivisions));
    return {
      subdivisions,
      steps: Array.from({ length: count + 1 }, (_, index) => index),
    };
  }, [max]);
  const labelValues = useMemo(() => {
    if (max <= 6) {
      return Array.from({ length: Math.max(1, Math.floor(max)) }, (_, index) => index + 1);
    }
    return Array.from(
      new Set(Array.from({ length: 5 }, (_, index) => Math.round(1 + ((max - 1) * index) / 4))),
    );
  }, [max]);

  const accessibilityStep = (direction: -1 | 1) => {
    const next = Math.min(max, Math.max(1, Math.round((value + direction * 0.1) * 10) / 10));
    void Haptics.selectionAsync();
    onChange(next);
  };

  return (
    <View style={styles.scaleBlock}>
      <GestureDetector gesture={gesture}>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Leverage"
          accessibilityValue={{ min: 1, max, now: value, text: formatLeverage(value) }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'increment') accessibilityStep(1);
            if (event.nativeEvent.actionName === 'decrement') accessibilityStep(-1);
          }}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          style={[styles.scaleFrame, { height }]}
        >
          {hideCaption ? null : <Text style={styles.scaleCaption}>Leverage</Text>}

          {width > 0 ? (
            <>
              <Animated.View style={[styles.scaleBubble, { backgroundColor: accent }, bubbleStyle]}>
                <Text style={styles.scaleBubbleText}>{formatLeverage(value)}</Text>
                <View style={[styles.scaleBubblePointer, { borderTopColor: accent }]} />
              </Animated.View>

              <View
                style={[
                  styles.scaleRail,
                  {
                    top: railTop,
                    left: sideInset,
                    right: sideInset,
                    backgroundColor: withAlpha(accent, 0.12),
                  },
                ]}
              />

              {tickModel.steps.map((step) => {
                const major = step % tickModel.subdivisions === 0;
                const progress = tickModel.steps.length <= 1
                  ? 0
                  : step / (tickModel.steps.length - 1);
                return (
                  <View
                    key={step}
                    style={[
                      major ? styles.scaleMajorTick : styles.scaleMinorTick,
                      {
                        top: railTop - (major ? 9 : 3),
                        left: sideInset + progress * usableWidth - (major ? 1 : 0.5),
                        backgroundColor: withAlpha(accent, major ? 0.72 : 0.22),
                      },
                    ]}
                  />
                );
              })}

              <Animated.View
                pointerEvents="none"
                style={[
                  styles.scaleActiveTick,
                  { top: railTop - 13, backgroundColor: accent },
                  markerStyle,
                ]}
              />

              {labelValues.map((label) => {
                const progress = max <= 1 ? 0 : (label - 1) / (max - 1);
                return (
                  <Text
                    key={label}
                    style={[
                      styles.scaleTickLabel,
                      {
                        top: railTop + 16,
                        left: sideInset + progress * usableWidth - 14,
                        color: colors.textTertiary,
                      },
                    ]}
                  >
                    {label}
                  </Text>
                );
              })}
            </>
          ) : null}
        </View>
      </GestureDetector>
    </View>
  );
}

/**
 * Leverage picker — a centred number strip framed by tick rails. The selected
 * whole-x sits large and coloured in the middle; neighbours shrink and fade
 * toward the edges. Dragging horizontally slides the strip (the frame stays
 * put), snapping to whole-x with a detent tick; tapping a number jumps to it.
 *
 * The pan claims the gesture only once the finger moves sideways
 * (`activeOffsetX`), so a vertical drag still scrolls the parent.
 *
 * Shared by the single-market perp order pad and the perp Sandwich buy pad —
 * hence `height`/`slot`, which let the same control fit the Sandwich pad's much
 * tighter vertical budget without a second implementation to keep in sync.
 */
function CarouselLeverageRuler({
  value,
  max: rawMax,
  accent,
  onChange,
  height = DEFAULT_HEIGHT,
  slot = DEFAULT_SLOT,
  hideCaption = false,
  forceScheme,
  liveValue,
}: LeverageRulerProps) {
  const styles = useThemedStyles(makeStyles, forceScheme);
  const { colors: currentColors } = useThemeStore();
  const colors = forceScheme ? Colors[forceScheme] : currentColors;

  // The strip only draws whole-x cells, so the top of the range has to be one
  // of them. A fractional ceiling (a basket's binding 7.5x) used to let the
  // rail settle half way into a cell that was never drawn and report 7.5x
  // under a half-lit "7x".
  const max = Math.max(1, Math.floor(rawMax));
  const [width, setWidth] = useState(0);
  const centerX = width / 2;
  // Captured as plain numbers before the gesture builders below: the worklets
  // close over these, and reading them off props inside a worklet would not.
  const SLOT = slot;
  const numberFontSize = Math.round(height * NUMBER_FONT_RATIO);
  const committed = Math.min(max, Math.max(1, Math.round(value)));

  // The whole animation is driven off a single UI-thread value: the leverage
  // sitting at the centre line. The strip translates from it, and each number
  // reads it to scale/fade/tint — so dragging never touches the JS thread.
  const centerPos = useSharedValue(committed);
  const dragging = useSharedValue(0);
  // Raised while the rail springs onto a mark after release. The commit that
  // starts that spring re-renders us, and without this flag the effect below
  // replaced the velocity-matched spring with a cold one — the hitch at the
  // end of every flick.
  const settling = useSharedValue(0);
  const startPos = useSharedValue(committed);
  const slack = useSharedValue(0);
  // Mark under the centre as the rail moves (haptics) vs. the value the owner
  // last accepted (commits). Keeping them apart is what lets a drag back to a
  // number the owner had re-clamped away from still report it.
  const lastDetent = useSharedValue(committed);
  const lastCommitted = useSharedValue(committed);
  const lastHapticAt = useSharedValue(0);

  // Keep the picker parked on the controlled value when the owner changes it
  // (e.g. margin edits that re-clamp leverage) and we're not mid-gesture.
  useEffect(() => {
    lastCommitted.value = committed;
    if (dragging.value || settling.value) return;
    lastDetent.value = committed;
    if (Math.abs(centerPos.value - committed) < 1e-3) return;
    centerPos.value = withSpring(committed, SETTLE_SPRING);
  }, [centerPos, committed, dragging, lastCommitted, lastDetent, settling]);

  const tickHaptic = useCallback(() => {
    void Haptics.selectionAsync();
  }, []);

  // The mark currently under the centre marker, republished as the rail moves.
  // Callers hand this in to drive a readout of their own — the perp panel's
  // position size — which would otherwise only update at commit time and
  // visibly lag the rail. Writes the DETENT rather than the continuous
  // position, so the readout snaps mark to mark like the selection it mirrors.
  useAnimatedReaction(
    () => Math.min(max, Math.max(1, Math.round(centerPos.value))),
    (detentNow, previous) => {
      'worklet';
      if (liveValue && detentNow !== previous) liveValue.value = detentNow;
    },
    [liveValue, max],
  );

  const stripStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: centerX - (centerPos.value - 1) * SLOT }],
  }));

  const gesture = useMemo(() => {
    const clamp = (next: number) => {
      'worklet';
      return Math.min(max, Math.max(1, next));
    };
    // Past either end the strip keeps following at a fraction of the finger
    // instead of stopping dead, and springs back on release.
    const resist = (next: number) => {
      'worklet';
      if (next > max) return max + (next - max) * OVERSCROLL_RESISTANCE;
      if (next < 1) return 1 - (1 - next) * OVERSCROLL_RESISTANCE;
      return next;
    };
    // Mid-drag a crossing is only a throttled haptic. Reporting to React here
    // re-rendered the whole order pad once per mark, under the finger.
    const cross = (next: number) => {
      'worklet';
      const settled = Math.round(clamp(next));
      if (settled === lastDetent.value) return;
      lastDetent.value = settled;
      const now = Date.now();
      if (now - lastHapticAt.value < HAPTIC_MIN_GAP_MS) return;
      lastHapticAt.value = now;
      runOnJS(tickHaptic)();
    };
    const settle = (target: number, velocity: number) => {
      'worklet';
      if (target !== lastDetent.value) {
        lastDetent.value = target;
        runOnJS(tickHaptic)();
      }
      settling.value = 1;
      centerPos.value = withSpring(target, { ...SETTLE_SPRING, velocity }, (finished) => {
        if (finished) settling.value = 0;
      });
      if (target !== lastCommitted.value) {
        lastCommitted.value = target;
        runOnJS(onChange)(target);
      }
    };

    const pan = Gesture.Pan()
      .activeOffsetX([-6, 6])
      .failOffsetY([-12, 12])
      .onBegin(() => {
        'worklet';
        dragging.value = 1;
        settling.value = 0;
        cancelAnimation(centerPos);
        startPos.value = centerPos.value;
      })
      .onStart((event) => {
        'worklet';
        // Activation spends 6pt of travel; start from there so the strip
        // doesn't jump by it on the first frame.
        slack.value = event.translationX;
      })
      .onUpdate((event) => {
        'worklet';
        const next = resist(startPos.value - (event.translationX - slack.value) / SLOT);
        centerPos.value = next;
        cross(next);
      })
      .onEnd((event) => {
        'worklet';
        // Momentum projection with a ceiling, so a hard flick eases into a
        // nearby mark instead of launching several x past where it was aimed.
        const velocity = -event.velocityX / SLOT;
        const carry = Math.max(-FLICK_MAX_CARRY_X, Math.min(FLICK_MAX_CARRY_X, velocity * 0.09));
        settle(Math.round(clamp(centerPos.value + carry)), velocity);
      })
      .onFinalize(() => {
        'worklet';
        dragging.value = 0;
      });

    const tap = Gesture.Tap()
      .maxDistance(12)
      .onEnd((event) => {
        'worklet';
        if (centerX <= 0) return;
        settle(Math.round(clamp(centerPos.value + (event.x - centerX) / SLOT)), 0);
      });

    return Gesture.Race(pan, tap);
  }, [
    SLOT,
    centerPos,
    centerX,
    dragging,
    lastCommitted,
    lastDetent,
    lastHapticAt,
    max,
    onChange,
    settling,
    slack,
    startPos,
    tickHaptic,
  ]);

  const integers = useMemo(() => {
    const list: number[] = [];
    for (let i = 1; i <= max; i += 1) list.push(i);
    return list;
  }, [max]);

  if (max <= 1) {
    return (
      <View style={styles.leverageBlock}>
        <View style={styles.bubbleLane}>
          <View style={[styles.bubble, styles.bubbleCentered, { backgroundColor: accent }]}>
            <Text style={styles.bubbleText}>1x</Text>
          </View>
        </View>
        {hideCaption ? null : <Text style={styles.leverageCaption}>Leverage</Text>}
      </View>
    );
  }

  const tickColor = withAlpha(colors.textTertiary, 0.5);

  return (
    <View style={styles.leverageBlock}>
      <GestureDetector gesture={gesture}>
        <View
          accessibilityRole="adjustable"
          accessibilityLabel="Leverage"
          accessibilityValue={{ min: 1, max, now: value }}
          style={[styles.leverageFrame, { height }]}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        >
          {/* Rails and the sliding strip fade out toward both sides instead of
              being cut off by the frame edge mid-number. */}
          <MaskedView
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            maskElement={
              <LinearGradient
                colors={['transparent', '#000', '#000', 'transparent']}
                locations={[0, 0.38, 0.62, 1]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={StyleSheet.absoluteFill}
              />
            }
          >
            {/* Static rails. */}
            <View style={[styles.railLineTop, { backgroundColor: colors.border }]} />
            <View style={[styles.railLineBottom, { backgroundColor: colors.border }]} />

            {/* Sliding scale: neutral ticks + numbers, all moved by one transform.

                A tick marks the BOUNDARY between two marks, half a slot to the
                left of the number it precedes, so every number reads as sitting
                inside its own cell. Placing them under the numbers instead put a
                line through the middle of the selected value. */}
            <Animated.View style={[styles.stripFill, stripStyle]}>
              {width > 0
                ? integers.map((i) => (
                    <React.Fragment key={i}>
                      <View
                        style={[
                          styles.railTickTop,
                          {
                            left: (i - 1) * SLOT - SLOT / 2 - TICK_WIDTH / 2,
                            backgroundColor: tickColor,
                          },
                        ]}
                      />
                      <View
                        style={[
                          styles.railTickBottom,
                          {
                            left: (i - 1) * SLOT - SLOT / 2 - TICK_WIDTH / 2,
                            backgroundColor: tickColor,
                          },
                        ]}
                      />
                      <LeverageNumber
                        index={i}
                        centerPos={centerPos}
                        accent={accent}
                        muted={colors.textSecondary}
                        slot={SLOT}
                        fontSize={numberFontSize}
                        styles={styles}
                      />
                    </React.Fragment>
                  ))
                : null}
              {/* Closing boundary for the last mark — the map only draws the tick
                  that PRECEDES each number, so the top of the range would
                  otherwise sit in an open-ended cell. */}
              {width > 0 ? (
                <>
                  <View
                    style={[
                      styles.railTickTop,
                      {
                        left: (max - 1) * SLOT + SLOT / 2 - TICK_WIDTH / 2,
                        backgroundColor: tickColor,
                      },
                    ]}
                  />
                  <View
                    style={[
                      styles.railTickBottom,
                      {
                        left: (max - 1) * SLOT + SLOT / 2 - TICK_WIDTH / 2,
                        backgroundColor: tickColor,
                      },
                    ]}
                  />
                </>
              ) : null}
            </Animated.View>
          </MaskedView>

          {/* Fixed centre marker — the selection always sits here. Just a tick
              down each side of the selected cell: the accent brackets the
              number without drawing a line over or under it. */}
          {width > 0 ? (
            <>
              <View
                style={[
                  styles.centerTickTop,
                  { left: centerX - SLOT / 2 - 1.5, backgroundColor: accent },
                ]}
              />
              <View
                style={[
                  styles.centerTickTop,
                  { left: centerX + SLOT / 2 - 1.5, backgroundColor: accent },
                ]}
              />
              <View
                style={[
                  styles.centerTickBottom,
                  { left: centerX - SLOT / 2 - 1.5, backgroundColor: accent },
                ]}
              />
              <View
                style={[
                  styles.centerTickBottom,
                  { left: centerX + SLOT / 2 - 1.5, backgroundColor: accent },
                ]}
              />
            </>
          ) : null}
        </View>
      </GestureDetector>

      {hideCaption ? null : <Text style={styles.leverageCaption}>Leverage</Text>}
    </View>
  );
}

/**
 * One number in the leverage strip. It reads the shared centre position on the
 * UI thread and interpolates its scale, opacity and colour by distance — so the
 * emphasis glides continuously instead of snapping between discrete states.
 */
function LeverageNumber({
  index,
  centerPos,
  accent,
  muted,
  slot,
  fontSize,
  styles,
}: {
  index: number;
  centerPos: SharedValue<number>;
  accent: string;
  muted: string;
  slot: number;
  fontSize: number;
  styles: ReturnType<typeof makeStyles>;
}) {
  const cellStyle = useAnimatedStyle(() => {
    const distance = Math.abs(index - centerPos.value);
    return {
      opacity: interpolate(distance, [0, 1, 2, 3], [1, 0.55, 0.32, 0.18], Extrapolation.CLAMP),
      transform: [
        { scale: interpolate(distance, [0, 1, 2], [1, 0.8, 0.68], Extrapolation.CLAMP) },
      ],
    };
  });
  // The selected tint is a second, accent copy of the number cross-faded over
  // the muted one. Animating `color` directly goes through a layout commit on
  // every frame for every number on the strip — the drag's remaining jank —
  // while opacity and transform stay on the compositor.
  const accentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(Math.abs(index - centerPos.value), [0, 1], [1, 0], Extrapolation.CLAMP),
  }));
  const textStyle = [
    styles.numberText,
    { fontSize: index >= 100 ? fontSize * 0.82 : fontSize },
  ];

  return (
    // The cell is wider than the slot: a centred "10x" at full size is wider
    // than a narrow slot and used to tail-ellipsize to "1…". Neighbours are
    // scaled down, so the extra width never collides with them.
    <Animated.View
      style={[
        styles.numberCell,
        { width: slot * 1.4, left: (index - 1) * slot - slot * 0.7 },
        cellStyle,
      ]}
    >
      <Text numberOfLines={1} style={[textStyle, { color: muted }]}>
        {`${index}x`}
      </Text>
      <Animated.View style={[styles.numberAccentLayer, accentStyle]}>
        <Text numberOfLines={1} style={[textStyle, { color: accent }]}>
          {`${index}x`}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    // 90pt of stacked bands, all of them absolute inside `slimTrackArea`:
    // readout 0-38, pointer 40-51, then the rail from 56 down. The gap under
    // the pointer's apex is deliberate — sitting it on the marks made it read
    // as one more tick rather than the thing selecting them.
    slimRow: { alignSelf: 'stretch', height: 90 },
    slimStatic: { height: 90, alignItems: 'center', justifyContent: 'flex-start' },
    slimStaticValue: {
      left: '50%',
      marginLeft: -SLIM_VALUE_WIDTH / 2,
      width: SLIM_VALUE_WIDTH,
      lineHeight: 38,
    },
    slimCenteredValue: {
      left: '50%',
      marginLeft: -SLIM_VALUE_WIDTH / 2,
      width: SLIM_VALUE_WIDTH,
    },
    slimTrackArea: { flex: 1, height: 90, position: 'relative' },
    slimTrack: {
      position: 'absolute',
      top: 70,
      left: 0,
      right: 0,
      height: 1,
      marginHorizontal: SCRUBBER_SIDE_INSET,
      backgroundColor: withAlpha(c.text, 0.35),
    },
    slimScaleViewport: {
      position: 'absolute',
      top: 56,
      left: SCRUBBER_SIDE_INSET,
      right: SCRUBBER_SIDE_INSET,
      // 34 = 14 of tick + 17 of label, or the labels clip against the bottom.
      height: 34,
      overflow: 'hidden',
      borderRadius: 2,
    },
    slimScale: {
      position: 'absolute',
      top: 0,
      left: '50%',
      height: 34,
    },
    slimMinorTick: {
      position: 'absolute',
      top: 6,
      width: 1.5,
      height: 8,
      backgroundColor: c.text,
      opacity: 0.35,
      borderRadius: 0.5,
    },
    slimMajorTick: {
      position: 'absolute',
      top: 0,
      width: 2,
      height: 14,
      borderRadius: 1,
      backgroundColor: c.text,
      opacity: 0.75,
    },
    slimTickLabel: {
      position: 'absolute',
      top: 17,
      width: 34,
      textAlign: 'center',
      fontFamily: F,
      color: c.textSecondary,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    // A fixed index like the pointer on an analogue weighing scale. A tiny gap
    // keeps its apex visually distinct from the rail moving beneath it.
    slimPointer: {
      position: 'absolute',
      top: 40,
      left: '50%',
      marginLeft: -7,
      width: 0,
      height: 0,
      borderLeftWidth: 7,
      borderRightWidth: 7,
      borderTopWidth: 11,
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
      borderStyle: 'solid',
      zIndex: 10,
      elevation: 10,
    },
    // Rendered into a TextInput so Reanimated can drive it (see `readoutProps`),
    // hence the explicit height and zeroed padding: a TextInput centres its
    // text in its own box instead of sitting on a line box like Text does.
    slimValue: {
      position: 'absolute',
      top: 0,
      left: 0,
      height: 38,
      padding: 0,
      fontFamily: F,
      fontSize: 34,
      letterSpacing: -0.8,
      fontWeight: '900',
      width: SLIM_VALUE_WIDTH,
      textAlign: 'center',
      fontVariant: ['tabular-nums'],
      includeFontPadding: false,
    },
    // ── Leverage picker (centred number strip framed by tick rails) ──────────
    leverageBlock: { marginTop: 4, gap: 8 },
    leverageFrame: { overflow: 'hidden' },
    railLineTop: {
      position: 'absolute',
      top: 0,
      left: 4,
      right: 4,
      height: StyleSheet.hairlineWidth,
    },
    railLineBottom: {
      position: 'absolute',
      bottom: 0,
      left: 4,
      right: 4,
      height: StyleSheet.hairlineWidth,
    },
    // The sliding scale fills the frame; its children are absolutely placed and
    // the whole layer is translated by one animated transform.
    stripFill: { ...StyleSheet.absoluteFillObject },
    railTickTop: { position: 'absolute', top: 0, width: TICK_WIDTH, height: 7, borderRadius: 1 },
    railTickBottom: {
      position: 'absolute',
      bottom: 0,
      width: TICK_WIDTH,
      height: 7,
      borderRadius: 1,
    },
    // Fixed accent marker at the centre line — the resting selection. A tick
    // down each edge of the selected cell, and nothing joining them.
    centerTickTop: { position: 'absolute', top: 0, width: 3, height: 13, borderRadius: 2 },
    centerTickBottom: { position: 'absolute', bottom: 0, width: 3, height: 13, borderRadius: 2 },
    numberCell: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    numberAccentLayer: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    numberText: {
      fontFamily: F,
      fontWeight: '900',
      fontVariant: ['tabular-nums'],
    },
    leverageCaption: {
      textAlign: 'center',
      fontFamily: F,
      color: c.textTertiary,
      fontSize: 14,
      fontWeight: '700',
    },

    // Static fallback for a market that only offers 1x.
    bubbleLane: { height: 30, justifyContent: 'flex-end' },
    bubble: {
      width: BUBBLE_WIDTH,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The needle is fixed at the centre, so the readout sits above it.
    bubbleCentered: { alignSelf: 'center' },
    bubbleText: {
      fontFamily: F,
      color: '#FFFFFF',
      fontSize: 13,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },

    // ── Stock-detail scale ruler ────────────────────────────────────────────
    scaleBlock: { alignSelf: 'stretch', marginTop: 2 },
    scaleFrame: { alignSelf: 'stretch', position: 'relative', overflow: 'visible' },
    scaleCaption: {
      position: 'absolute',
      top: 5,
      left: 0,
      fontFamily: F,
      color: c.textSecondary,
      fontSize: 15,
      fontWeight: '700',
    },
    scaleBubble: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: BUBBLE_WIDTH,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000000',
      shadowOpacity: 0.14,
      shadowRadius: 5,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
      zIndex: 3,
    },
    scaleBubbleText: {
      fontFamily: F,
      color: '#FFFFFF',
      fontSize: 14,
      lineHeight: 18,
      fontWeight: '900',
      fontVariant: ['tabular-nums'],
    },
    scaleBubblePointer: {
      position: 'absolute',
      bottom: -5,
      width: 0,
      height: 0,
      borderLeftWidth: 5,
      borderRightWidth: 5,
      borderTopWidth: 6,
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
    },
    scaleRail: {
      position: 'absolute',
      height: StyleSheet.hairlineWidth,
    },
    scaleMinorTick: {
      position: 'absolute',
      width: 1,
      height: 8,
      borderRadius: 1,
    },
    scaleMajorTick: {
      position: 'absolute',
      width: 2,
      height: 21,
      borderRadius: 1,
    },
    scaleActiveTick: {
      position: 'absolute',
      left: 0,
      width: 3,
      height: 31,
      borderRadius: 2,
      zIndex: 2,
    },
    scaleTickLabel: {
      position: 'absolute',
      width: 28,
      textAlign: 'center',
      fontFamily: F,
      fontSize: 10,
      lineHeight: 13,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
  });
