import { describe, expect, it } from 'vitest';

import { positionChartMarkers } from '@/lib/chart-markers';

const series = [
  { timestamp: Date.parse('2026-01-01T00:00:00.000Z') },
  { timestamp: Date.parse('2026-01-02T00:00:00.000Z') },
  { timestamp: Date.parse('2026-01-03T00:00:00.000Z') },
];
const points = [{ x: 10, y: 80 }, { x: 100, y: 60 }, { x: 190, y: 40 }];

describe('positionChartMarkers', () => {
  it('sits on the nearest chart point for an entry or exit', () => {
    const [marker] = positionChartMarkers([
      { id: 'exit', side: 'exit', occurredAt: '2026-01-02T02:00:00.000Z' },
    ], series, points, 200, 100);

    expect(marker.x).toBe(100);
    expect(marker.y).toBe(60);
  });

  it('snaps a fill from before the first candle onto the start of the line', () => {
    const [marker] = positionChartMarkers([
      { id: 'early', side: 'entry', occurredAt: '2025-12-31T12:00:00.000Z' },
    ], series, points, 200, 100);

    expect(marker.x).toBe(10);
    expect(marker.y).toBe(80);
  });

  it('drops a fill from before a zoomed window instead of clamping it to the edge', () => {
    expect(positionChartMarkers([
      { id: 'old', side: 'entry', occurredAt: '2025-12-01T00:00:00.000Z' },
    ], series, points, 200, 100, Date.parse('2026-01-01T00:00:00.000Z'))).toEqual([]);
  });

  it('fans clustered fills into distinct bounded positions', () => {
    const markers = positionChartMarkers([
      { id: 'one', side: 'entry', occurredAt: '2026-01-02T00:00:00.000Z' },
      { id: 'two', side: 'entry', occurredAt: '2026-01-02T00:01:00.000Z' },
      { id: 'three', side: 'exit', occurredAt: '2026-01-02T00:02:00.000Z' },
    ], series, points, 200, 100);

    expect(new Set(markers.map(({ x, y }) => `${x}:${y}`)).size).toBe(3);
    expect(markers.every(({ x, y }) => x >= 10 && x <= 190 && y >= 12 && y <= 88)).toBe(true);
  });

  it('drops malformed timestamps without inventing a marker', () => {
    expect(positionChartMarkers([
      { id: 'bad', side: 'entry', occurredAt: 'not-a-date' },
    ], series, points, 200, 100)).toEqual([]);
  });
});
