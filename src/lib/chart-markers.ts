export type ChartMarker = {
  id: string;
  side: 'entry' | 'exit';
  occurredAt: string;
};

export type PositionedChartMarker = ChartMarker & { x: number; y: number };

/**
 * Pin fills onto the line at their nearest candle: the first fill on a candle
 * sits on the line itself, and only collisions fan away from it. A fill before
 * the first candle (bought before the series has data) snaps to the start; one
 * from before a zoomed window (`fromMs`, a 1W view of a month-old buy) is
 * dropped rather than claiming the window's first day.
 */
export function positionChartMarkers(
  markers: readonly ChartMarker[],
  series: readonly { timestamp: number }[],
  points: readonly { x: number; y: number }[],
  width: number,
  height: number,
  fromMs: number | null = null,
): PositionedChartMarker[] {
  const counts = new Map<number, number>();
  return markers.flatMap((marker) => {
    const markerTime = new Date(marker.occurredAt).getTime();
    if (!Number.isFinite(markerTime) || series.length === 0) return [];
    if (fromMs !== null && markerTime < fromMs) return [];
    let nearest = 0;
    let nearestDistance = Math.abs(series[0].timestamp - markerTime);
    for (let index = 1; index < series.length; index += 1) {
      const distance = Math.abs(series[index].timestamp - markerTime);
      if (distance < nearestDistance) {
        nearest = index;
        nearestDistance = distance;
      }
    }
    const point = points[nearest];
    if (!point) return [];
    const collision = counts.get(nearest) ?? 0;
    counts.set(nearest, collision + 1);
    // 0 for the first fill on this candle; 1, 2, … fan out for the rest.
    const direction = collision % 2 === 1 ? -1 : 1;
    const tier = Math.ceil(collision / 2);
    return [{
      ...marker,
      x: Math.max(10, Math.min(width - 10, point.x + direction * tier * 11)),
      y: Math.max(12, Math.min(height - 12, point.y - tier * 10)),
    }];
  });
}
