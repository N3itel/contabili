import { closeProblem, dayBefore, reopenTarget } from './period-rules.js';

describe('cierre de periodos', () => {
  it('calcula el día anterior', () => {
    expect(dayBefore('2026-03-01')).toBe('2026-02-28');
    expect(dayBefore('2026-01-01')).toBe('2025-12-31');
  });

  it('solo cierra meses terminados y no cerrados', () => {
    const today = '2026-04-01';
    expect(closeProblem({ period: '2026-03', today, closedThrough: null })).toBeNull();
    expect(closeProblem({ period: '2026-04', today, closedThrough: null })).toBe(
      'period_not_ended',
    );
    // El último día del mes todavía no terminó.
    expect(closeProblem({ period: '2026-03', today: '2026-03-31', closedThrough: null })).toBe(
      'period_not_ended',
    );
    expect(closeProblem({ period: '2026-02', today, closedThrough: '2026-02-28' })).toBe(
      'already_closed',
    );
    expect(closeProblem({ period: '2026-03', today, closedThrough: '2026-02-28' })).toBeNull();
  });

  it('reabrir deja abierto desde el primer día del mes', () => {
    expect(reopenTarget({ period: '2026-02', closedThrough: '2026-03-31' })).toEqual({
      closedThrough: '2026-01-31',
    });
    expect(reopenTarget({ period: '2026-04', closedThrough: '2026-03-31' })).toBe('not_closed');
    expect(reopenTarget({ period: '2026-01', closedThrough: null })).toBe('not_closed');
  });
});
