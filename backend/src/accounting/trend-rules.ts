import type { Cents } from './money.js';

export interface TrendPoint {
  /** 'AAAA-MM'. */
  period: string;
  sales: Cents;
  expenses: Cents;
}

/** Mes anterior o siguiente de 'AAAA-MM'. */
export function shiftPeriod(period: string, months: number): string {
  const [year, month] = period.split('-').map(Number);
  const index = year * 12 + (month - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Los últimos `count` meses hasta `toPeriod`, con cero en los que no tuvieron movimientos. */
export function trendMonths(
  rows: readonly { period: string; netSales: Cents; expenses: Cents }[],
  toPeriod: string,
  count: number,
): TrendPoint[] {
  const byPeriod = new Map(rows.map((r) => [r.period, r]));
  return Array.from({ length: count }, (_, i) => {
    const period = shiftPeriod(toPeriod, i - count + 1);
    const row = byPeriod.get(period);
    return { period, sales: row?.netSales ?? 0, expenses: row?.expenses ?? 0 };
  });
}
