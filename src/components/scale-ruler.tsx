import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { Fonts, type ThemeColors } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import {
  fractionToValue,
  logSnapStep,
  majorTickInterval,
  valueToFraction,
} from '@/lib/ruler-scale';
import { withAlpha } from '@/lib/color-utils';

const F = Fonts.rounded;

const TICK_WIDTH = 2;
const BUBBLE_HEIGHT = 26;
const BUBBLE_WIDTH = 62;
/** Ticks sit inside the frame by this much so edge ticks and the needle don't clip. */
const EDGE = 10;
/** The needle is the one line that has to read at a glance, so it is the heaviest. */
const NEEDLE_WIDTH = 5;
/** Nominal gap between minor hatch ticks. Actual gap is snapped to fit the width. */
const MINOR_GAP = 7;
/**
 * Closest two major ticks may sit, in pixels.
 *
 * `majorEvery` is a *value* interval, so the same 1% grid draws 36 majors on a
 * stop ruler and 100 on a take-profit one — at which point the majors land on
 * top of the minor hatch and the whole scale reads as a solid comb, next to a
 * neighbouring ruler that reads as sparse bars. Two rulers doing the same job
 * must look the same whatever range they happen to span, so the interval is
 * scaled up until the ticks are at least this far apart.
 */
const MIN_MAJOR_GAP = 36;


export type ScaleRulerProps = {
  value: number;
  min: number;
  max: number;
  /** Value distance between two steps — the resolution of the control. */
  step: number;
  /** Value distance between two labelled, full-height ticks. */
  majorEvery: number;
  /**
   * Legacy prop from the old scrolling ruler. The scale is now a fixed-width
   * control, so tick spacing is derived from the layout — kept only so existing
   * call sites don't need to change.
   */
  pixelsPerStep?: number;
  accent: string;
  /** Pill above the needle. */
  formatValue: (value: number) => string;
  /** Label under a major tick. Return null to draw the tick unlabelled. */
  formatTick?: (value: number) => string | null;
  /** Fires continuously while the needle moves. */
  onChange: (value: number) => void;
  /** Fires once the drag settles (finger up). */
  onCommit?: (value: number) => void;
  /**
   * `log` spreads the track by ratio rather than by absolute size.
   *
   * For a range whose useful settings all sit near the bottom — a stop between
   * 0.2% and 36%, a target between 1% and 1000% — a linear track wastes almost
   * its whole length on values nobody picks. A log track gives each *multiple*
   * equal room, and because it is a fixed mapping the scale never has to resize
   * while the finger is down. `step` is ignored in this mode; resolution comes
   * from {@link logSnapStep}. Requires `min > 0`.
   */
  scale?: 'linear' | 'log';
  /** Drops the value pill — for rows that show the value elsewhere. */
  hideBubble?: boolean;
  /**
   * Draws the minor hatch only. The majors still set the drag detents — this
   * hides the taller, full-colour ticks so the track reads as an even hatch.
   */
  hideMajorTicks?: boolean;
  height?: number;
  /** Drag from the current needle value without jumping to the touch location. */
  relativeDrag?: boolean;
  /** Track linear ruler drags on the UI thread, independently of React updates. */
  smoothDrag?: boolean;
  /** Optional value interval for haptic detents, independent of tick labels. */
  hapticEvery?: number;
};

/**
 * A fixed scale: the ruler stays put and the needle slides along it, rather
 * than the whole scale scrolling under a centred needle. That keeps it steady
 * inside a scrolling sheet — the pan claims the gesture only once the finger
 * moves horizontally (`activeOffsetX`), so a vertical drag still scrolls the
 * parent — while looking the same as before (minor hatch + major ticks +
 * labels + value pill).
 *
 * Everything the caller needs to vary (range, resolution, tick labels, colour)
 * is a prop, so the leverage scale and the take-profit / stop-loss scales
 * behave identically.
 *
 * `onChange` fires at drag rate, so keep the handler cheap; commit expensive
 * work in `onCommit`.
 */
export function ScaleRuler({
  value,
  min,
  max,
  step,
  majorEvery,
  accent,
  formatValue,
  formatTick,
  onChange,
  onCommit,
  scale = 'linear',
  hideBubble = false,
  hideMajorTicks = false,
  height = 34,
  relativeDrag = false,
  smoothDrag = false,
  hapticEvery,
}: ScaleRulerProps) {
  const styles = useThemedStyles(makeStyles);
  const [trackWidth, setTrackWidth] = useState(0);
  // Detents fire on the ticks the user can actually see go past.
  const lastMajorRef = useRef<number | null>(null);
  const dragOriginX = useRef(0);
  const lastAppliedValue = useRef(value);
  const dragActive = useRef(false);

  const range = Math.max(max - min, 1e-9);
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  const round = useCallback(
    (next: number) => Number(next.toFixed(decimals)),
    [decimals],
  );
  const clampValue = useCallback(
    (next: number) => Math.min(max, Math.max(min, next)),
    [max, min],
  );

  const usable = Math.max(1, trackWidth - EDGE * 2);
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  const log = scale === 'log' && min > 0 && max > min;
  const fractionOf = useCallback(
    (v: number) => (log ? valueToFraction(v, min, max) : clamp01((v - min) / range)),
    [log, max, min, range],
  );
  const valueOf = useCallback(
    (f: number) => (log ? fractionToValue(f, min, max) : min + clamp01(f) * range),
    [log, max, min, range],
  );
  const xForValue = useCallback((v: number) => EDGE + fractionOf(v) * usable, [fractionOf, usable]);
  const needleX = xForValue(value);

  // Majors land on a multiple of the majorEvery grid — the smallest one that
  // keeps them {@link MIN_MAJOR_GAP} apart, so tick density is a property of
  // the layout rather than of whatever range the caller happens to pass.
  const majorInterval = useMemo(
    () => majorTickInterval({ majorEvery, range, trackPx: usable, minGapPx: MIN_MAJOR_GAP }),
    [majorEvery, range, usable],
  );

  // Finger x (within the track) → snapped value, with a detent tick per major.
  // Runs on the JS thread — the gesture callbacks below use `.runOnJS(true)`.
  const applyX = useCallback(
    (x: number, commit: boolean) => {
      const f = clamp01((x - EDGE) / usable);
      const raw = valueOf(f);
      // On a log track the resolution has to follow the magnitude; a fixed
      // `step` is either too coarse at the bottom or meaningless at the top.
      const grid = log ? logSnapStep(raw) : step;
      const snapped = clampValue(
        Number((Math.round(raw / grid) * grid).toFixed(Math.max(0, Math.ceil(-Math.log10(grid))))),
      );
      // One detent per major tick the user can see go past. On a log track the
      // drawn majors are evenly spaced in pixels, so the count comes from the
      // needle's position rather than from a value interval that would tick
      // constantly at the top of the scale and never at the bottom.
      const major = hapticEvery && hapticEvery > 0
        ? Math.round(snapped / hapticEvery)
        : log
        ? Math.round(fractionOf(snapped) * (usable / MIN_MAJOR_GAP))
        : Math.round(snapped / majorInterval);
      if (lastMajorRef.current !== null && major !== lastMajorRef.current) {
        void Haptics.selectionAsync();
      }
      lastMajorRef.current = major;
      lastAppliedValue.current = snapped;
      if (snapped !== value) onChange(snapped);
      if (commit) onCommit?.(snapped);
    },
    [clampValue, fractionOf, hapticEvery, log, majorInterval, onChange, onCommit, step, usable, valueOf, value],
  );

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      // Horizontal movement adjusts the value; vertical movement scrolls.
      .activeOffsetX([-8, 8])
      .failOffsetY([-12, 12])
      .runOnJS(true)
      .onBegin(() => {
        dragOriginX.current = xForValue(value);
        lastAppliedValue.current = value;
        lastMajorRef.current = null;
      })
      .onStart((event) => {
        dragActive.current = true;
        if (relativeDrag) void Haptics.selectionAsync();
        applyX(relativeDrag ? dragOriginX.current + event.translationX : event.x, false);
      })
      .onUpdate((event) => {
        applyX(relativeDrag ? dragOriginX.current + event.translationX : event.x, false);
      })
      .onEnd((event) => {
        applyX(relativeDrag ? dragOriginX.current + event.translationX : event.x, true);
      })
      .onFinalize((_event, success) => {
        // Keep the visible allocation when the OS interrupts an active drag.
        if (!success && dragActive.current) onCommit?.(lastAppliedValue.current);
        dragActive.current = false;
      });
    const tap = Gesture.Tap()
      .runOnJS(true)
      .onEnd((event, success) => {
        if (!success) return;
        lastMajorRef.current = null;
        if (relativeDrag) void Haptics.selectionAsync();
        applyX(event.x, true);
      });
    return Gesture.Race(pan, tap);
  }, [applyX, onCommit, relativeDrag, value, xForValue]);

  // The allocation ruler follows the finger at display refresh rate. React
  // receives whole-step changes for the labels and the other allocations.
  const uiFraction = useSharedValue(fractionOf(value));
  const uiDragging = useSharedValue(false);
  const uiActive = useSharedValue(false);
  const uiOrigin = useSharedValue(0);
  const uiPublished = useSharedValue(value);
  const uiHapticBucket = useSharedValue(-1);
  const useSmoothDrag = smoothDrag && !log;

  useEffect(() => {
    if (!uiDragging.value) {
      uiFraction.value = fractionOf(value);
      uiPublished.value = value;
    }
  }, [fractionOf, uiDragging, uiFraction, uiPublished, value]);

  const smoothNeedleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: EDGE + uiFraction.value * usable - NEEDLE_WIDTH / 2 }],
  }));
  const selectionHaptic = useCallback(() => { void Haptics.selectionAsync(); }, []);
  const finishSmoothDrag = useCallback((next: number) => {
    onChange(next);
    onCommit?.(next);
  }, [onChange, onCommit]);

  const smoothGesture = useMemo(() => {
    const update = (fraction: number, commit: boolean) => {
      'worklet';
      const clamped = Math.min(1, Math.max(0, fraction));
      const raw = min + clamped * range;
      const snapped = Math.min(max, Math.max(min,
        Number((Math.round(raw / step) * step).toFixed(decimals))));
      // Keep the needle continuous; snap only the committed allocation.
      uiFraction.value = clamped;
      const bucket = Math.round(snapped / (hapticEvery && hapticEvery > 0 ? hapticEvery : majorInterval));
      if (uiHapticBucket.value !== -1 && bucket !== uiHapticBucket.value) {
        runOnJS(selectionHaptic)();
      }
      uiHapticBucket.value = bucket;
      if (commit) {
        uiPublished.value = snapped;
        uiFraction.value = (snapped - min) / range;
        runOnJS(finishSmoothDrag)(snapped);
      } else if (snapped !== uiPublished.value) {
        uiPublished.value = snapped;
        runOnJS(onChange)(snapped);
      }
    };
    const pan = Gesture.Pan()
      .activeOffsetX([-8, 8])
      .failOffsetY([-12, 12])
      .onBegin(() => {
        uiOrigin.value = uiFraction.value;
        uiDragging.value = true;
        uiHapticBucket.value = -1;
      })
      .onStart((event) => {
        uiActive.value = true;
        runOnJS(selectionHaptic)();
        update(relativeDrag ? uiOrigin.value + event.translationX / usable : (event.x - EDGE) / usable, false);
      })
      .onUpdate((event) => {
        update(relativeDrag ? uiOrigin.value + event.translationX / usable : (event.x - EDGE) / usable, false);
      })
      .onEnd((event) => {
        update(relativeDrag ? uiOrigin.value + event.translationX / usable : (event.x - EDGE) / usable, true);
      })
      .onFinalize((_event, success) => {
        if (!success && uiActive.value) {
          update(uiFraction.value, true);
        }
        uiDragging.value = false;
        uiActive.value = false;
      });
    const tap = Gesture.Tap().onEnd((event, success) => {
      if (!success) return;
      uiHapticBucket.value = -1;
      runOnJS(selectionHaptic)();
      update((event.x - EDGE) / usable, true);
    });
    return Gesture.Race(pan, tap);
  }, [decimals, finishSmoothDrag, hapticEvery, majorInterval, max, min, onChange, range, relativeDrag,
    selectionHaptic, step, uiActive, uiDragging, uiFraction, uiHapticBucket, uiOrigin, uiPublished, usable]);

  // Minor hatch: a uniform run of short ticks fitted to the width.
  const minorCount = trackWidth > 0 ? Math.floor(usable / MINOR_GAP) : 0;
  const minorGap = minorCount > 0 ? usable / minorCount : 0;

  const majors: number[] = [];
  if (trackWidth > 0) {
    if (log) {
      // Evenly spaced in *pixels*, not in value. A log track's value grid would
      // bunch every tick into the left third, and the point of the majors is a
      // steady visual rhythm — one that a stop ruler and a target ruler share
      // no matter how differently they are scaled.
      const count = Math.max(2, Math.round(usable / MIN_MAJOR_GAP));
      for (let index = 0; index <= count; index += 1) majors.push(valueOf(index / count));
    } else {
      const firstMajor = Math.ceil(min / majorInterval - 1e-9) * majorInterval;
      for (let v = firstMajor; v <= max + 1e-9; v += majorInterval) majors.push(round(v));
    }
  }

  const labelHeight = formatTick ? 16 : 0;
  const bubbleLeft = Math.min(
    Math.max(needleX - BUBBLE_WIDTH / 2, 0),
    Math.max(trackWidth - BUBBLE_WIDTH, 0),
  );

  return (
    <View>
      {hideBubble ? null : (
        <View style={styles.bubbleLane}>
          <View
            style={[styles.bubble, { left: bubbleLeft, backgroundColor: accent }]}
          >
            <Text style={styles.bubbleText}>{formatValue(value)}</Text>
          </View>
        </View>
      )}

      <GestureDetector gesture={useSmoothDrag ? smoothGesture : gesture}>
        <View
          accessibilityRole="adjustable"
          accessibilityValue={{ min, max, now: value }}
          style={[styles.frame, { height: height + labelHeight }]}
          onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
        >
          {/* Minor hatch. */}
          {Array.from({ length: minorCount + 1 }, (_, index) => (
            <View
              key={`m${index}`}
              style={[
                styles.tick,
                {
                  left: EDGE + index * minorGap - TICK_WIDTH / 2,
                  height: height * 0.35,
                  top: height * 0.325,
                  backgroundColor: withAlpha(accent, 0.35),
                },
              ]}
            />
          ))}

          {/* Major ticks + optional labels. */}
          {majors.map((v, majorIndex) => {
            const x = xForValue(v);
            return (
              <View key={`M${majorIndex}`}>
                {hideMajorTicks ? null : (
                  <View
                    style={[
                      styles.tick,
                      {
                        left: x - TICK_WIDTH / 2,
                        height: height * 0.65,
                        top: height * 0.175,
                        backgroundColor: accent,
                      },
                    ]}
                  />
                )}
                {formatTick
                  ? (() => {
                      const label = formatTick(v);
                      return label === null ? null : (
                        <Text style={[styles.tickLabel, { top: height, left: x - 18 }]}>
                          {label}
                        </Text>
                      );
                    })()
                  : null}
              </View>
            );
          })}

          {/* The needle — it moves to the value; the scale does not. */}
          {trackWidth > 0 ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.needle,
                { height, left: useSmoothDrag ? 0 : needleX - NEEDLE_WIDTH / 2, backgroundColor: accent },
                useSmoothDrag ? smoothNeedleStyle : null,
              ]}
            />
          ) : null}
        </View>
      </GestureDetector>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    bubbleLane: { height: BUBBLE_HEIGHT + 4, justifyContent: 'flex-end' },
    bubble: {
      position: 'absolute',
      bottom: 0,
      width: BUBBLE_WIDTH,
      height: BUBBLE_HEIGHT,
      paddingHorizontal: 10,
      borderRadius: BUBBLE_HEIGHT / 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    bubbleText: {
      fontFamily: F,
      color: '#FFFFFF',
      fontSize: 13,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    frame: { justifyContent: 'flex-start', overflow: 'hidden' },
    tick: { position: 'absolute', width: TICK_WIDTH, borderRadius: 1 },
    tickLabel: {
      position: 'absolute',
      width: 36,
      textAlign: 'center',
      fontFamily: F,
      color: c.textTertiary,
      fontSize: 11,
      fontWeight: '700',
    },
    needle: {
      position: 'absolute',
      top: 0,
      width: NEEDLE_WIDTH,
      borderRadius: NEEDLE_WIDTH / 2,
    },
  });
