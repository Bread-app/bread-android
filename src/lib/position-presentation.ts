import type { PositionDetail } from '@/lib/api';

export function positionMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function positionPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value < 1 ? 4 : 2,
    maximumFractionDigits: value < 1 ? 6 : 2,
  }).format(value);
}

export function positionDuration(start: string | null, end: string | null): string {
  if (!start) return '—';
  const from = new Date(start).getTime();
  const to = end ? new Date(end).getTime() : Date.now();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return '—';
  const days = Math.max(0, Math.round((to - from) / 86_400_000));
  if (days < 1) return '<1 day';
  if (days < 14) return `${days} days`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30)} months`;
}

export function positionCurrentUnitPrice(
  detail: PositionDetail,
  currentValueUsd: number | null | undefined,
): number | null {
  if (currentValueUsd == null) return null;
  const quantity = detail.fills.reduce(
    (total, fill) =>
      total + (fill.side === 'entry' ? 1 : -1) * (fill.quantity ?? 0),
    0,
  );
  return quantity > 0 ? currentValueUsd / quantity : null;
}

export function positionShareStats(
  detail: PositionDetail,
  currentValueUsd: number | null | undefined,
): { label: string; value: string }[] {
  const closed = detail.state === 'closed';
  const multiAsset = detail.chart.legs.length > 1;
  if (multiAsset) {
    return [
      { label: 'Invested', value: positionMoney(detail.costUsd) },
      {
        label: closed ? 'Returned' : 'Current',
        value: positionMoney(closed ? detail.proceedsUsd : currentValueUsd),
      },
      { label: 'Held', value: positionDuration(detail.openedAt, detail.closedAt) },
    ];
  }
  return [
    { label: 'Invested', value: positionMoney(detail.costUsd) },
    { label: 'Avg. entry', value: positionPrice(detail.avgEntryPriceUsd) },
    {
      label: closed ? 'Avg. exit' : 'Current',
      value: closed
        ? positionPrice(detail.avgExitPriceUsd)
        : positionPrice(positionCurrentUnitPrice(detail, currentValueUsd)),
    },
  ];
}
