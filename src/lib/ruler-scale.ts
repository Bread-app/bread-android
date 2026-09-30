/**
 * Scale arithmetic for {@link ScaleRuler} and the pads that drive it.
 *
 * Both functions exist because a ruler's *range* is data — a stop is bounded by
 * liquidation, a target is not bounded at all — while its *appearance* must not
 * be. Two rulers doing the same job on the same screen have to read as the same
 * control whatever numbers they happen to span.
 */

/** Multipliers tried in order, so a widened interval is still a round number. */
const MAJOR_STEPS = [1, 2, 5, 10, 20, 25, 50, 100];

/**
 * Value distance between two major ticks, widened until they are at least
 * `minGapPx` apart on screen.
 *
 * `majorEvery` is a value interval, so a fixed 1% grid draws 36 ticks on a stop
 * ruler and 100 on a take-profit one. At 100 the majors land on top of the minor
 * hatch and the scale reads as a solid comb next to a neighbour that reads as
 * sparse bars — the same control, apparently two different widgets.
 */
export function majorTickInterval(options: {
  majorEvery: number;
  range: number;
  trackPx: number;
  minGapPx: number;
}): number {
  const { majorEvery, range, trackPx, minGapPx } = options;
  if (!(majorEvery > 0) || !(range > 0) || trackPx <= 1) return majorEvery;
  for (const multiplier of MAJOR_STEPS) {
    const interval = majorEvery * multiplier;
    if ((interval / range) * trackPx >= minGapPx) return interval;
  }
  return majorEvery * MAJOR_STEPS[MAJOR_STEPS.length - 1];
}

/**
 * Where a value sits along a ruler's track, as 0→1.
 *
 * Linear is the obvious mapping and the wrong one for a range like 0.2%→1000%:
 * a single pixel would be worth 1.3%, so the settings people actually use — a
 * 1% stop, a 3% target — would all be crushed into the first six pixels.
 *
 * A logarithmic track spends its length on ratios instead of on absolute size,
 * so each half of the ruler covers the same *multiple*. On 0.2→1000 the
 * midpoint lands near 14%: fine control where the levels live, and the far end
 * still reachable without the scale ever having to resize under the finger.
 */
export function valueToFraction(value: number, min: number, max: number): number {
  if (!(min > 0) || !(max > min)) return 0;
  const clamped = Math.min(max, Math.max(min, value));
  return Math.log(clamped / min) / Math.log(max / min);
}

/** Inverse of {@link valueToFraction}: track position → value. */
export function fractionToValue(fraction: number, min: number, max: number): number {
  if (!(min > 0) || !(max > min)) return min;
  const f = Math.min(1, Math.max(0, fraction));
  return min * Math.pow(max / min, f);
}

/**
 * Resolution for a value on a log track, as an absolute step.
 *
 * A fixed step cannot serve both ends: 0.1 is too coarse at 0.3% and absurdly
 * fine at 400%. Snapping to a tenth of the value's own order of magnitude keeps
 * roughly three significant figures everywhere — 0.35%, 3.4%, 34%, 340% — so the
 * number under the needle always reads as a deliberate choice rather than as a
 * raw drag position.
 */
export function logSnapStep(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) return 0.1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  return magnitude / 10;
}

/**
 * The span a log track should show for a given value.
 *
 * A ruler with no real maximum cannot show its whole range at once — 0.2% to
 * 1000% across one screen means a single swipe crosses four decades, and the top
 * of the scale moves in hundreds per pixel. So the track shows a *window*, wide
 * enough that the useful settings are all reachable in one gesture, and steps up
 * a notch when the value outgrows it.
 *
 * Deliberately a pure function of the value: the previous window is not an
 * input, so the same value always produces the same scale and the mapping cannot
 * drift. Callers must still hold it steady *while a drag is live* — recomputing
 * it under the finger is what made the value spike 70% → 4200%, since a wider
 * scale reads a larger value at the same finger position, which widens it again.
 */
export function trackWindow(value: number, base: number, cap: number): number {
  if (!(base > 0) || !(cap >= base) || !Number.isFinite(value)) return base;
  let window = base;
  // ×5 a step: on a log track that shifts the needle only ~20% of the width, so
  // stepping up reads as the scale breathing rather than as the value jumping.
  while (window < cap && value > window * 0.9) window = Math.min(cap, window * 5);
  return window;
}
