import { shiftPeriod, trendMonths } from './trend-rules.js';

describe('tendencia', () => {
  it('mueve meses cruzando el año', () => {
    expect(shiftPeriod('2026-01', -1)).toBe('2025-12');
    expect(shiftPeriod('2026-12', 1)).toBe('2027-01');
    expect(shiftPeriod('2026-10', -5)).toBe('2026-05');
  });

  it('llena con cero los meses sin movimientos', () => {
    const rows = [
      { period: '2026-08', netSales: 1000, expenses: 400 },
      { period: '2026-10', netSales: 3000, expenses: 1000 },
      { period: '2026-02', netSales: 9, expenses: 9 },
    ];
    expect(trendMonths(rows, '2026-10', 3)).toEqual([
      { period: '2026-08', sales: 1000, expenses: 400 },
      { period: '2026-09', sales: 0, expenses: 0 },
      { period: '2026-10', sales: 3000, expenses: 1000 },
    ]);
  });
});
