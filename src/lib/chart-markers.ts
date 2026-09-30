export type ChartMarker = {
  id: string;
  side: 'entry' | 'exit';
  occurredAt: string;
};

export type PositionedChartMarker = ChartMarker & { x: number; y: number };

/** Pin fills to their nearest candle and fan collisions away from the line. */
export function positionChartMarkers(
  markers: readonly ChartMarker[],
  series: readonly { timestamp: number }[],
  points: readonly { x: number; y: number }[],
  width: number,
  height: number,
): PositionedChartMarker[] {
  const counts = new Map<number, number>();
  return markers.flatMap((marker) => {
    const markerTime = new Date(marker.occurredAt).getTime();
    if (!Number.isFinite(markerTime) || series.length === 0) return [];
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
    const direction = collision % 2 === 0 ? -1 : 1;
    const tier = Math.floor(collision / 2) + 1;
    return [{
      ...marker,
      x: Math.max(10, Math.min(width - 10, point.x + direction * tier * 11)),
      y: Math.max(12, Math.min(height - 12, point.y - tier * 10)),
    }];
  });
}
