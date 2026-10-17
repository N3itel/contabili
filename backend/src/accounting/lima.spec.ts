import { limaDate, periodOf } from './lima.js';

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
