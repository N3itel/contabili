import { formatDate, isValidDate, limaDate, periodOf, periodRange } from './lima.js';

describe('fecha de Lima', () => {
  it('usa UTC−5', () => {
    // 03:00 UTC del 1 de noviembre todavía es 31 de octubre en Lima.
    expect(limaDate(new Date('2026-11-01T03:00:00Z'))).toBe('2026-10-31');
    expect(limaDate(new Date('2026-11-01T05:00:00Z'))).toBe('2026-11-01');
  });

  it('da el periodo mensual', () => {
    expect(periodOf('2026-10-17')).toBe('2026-10');
    expect(() => periodOf('17/10/2026')).toThrow();
  });
});

describe('fechas contables', () => {
  it('valida fechas reales', () => {
    expect(isValidDate('2026-10-17')).toBe(true);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026-1-01')).toBe(false);
  });

  it('da el rango de un periodo', () => {
    expect(periodRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(periodRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(() => periodRange('2026-13')).toThrow();
  });
});

describe('fechas para mostrar', () => {
  it('usa día/mes/año', () => {
    expect(formatDate('2026-03-31')).toBe('31/03/2026');
  });
});
