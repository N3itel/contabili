import { addMonths, extendLicense, licenseState, orderProblem, PLANS, priceFor } from './plans.js';

const at = (iso: string) => new Date(iso);

describe('planes y licencias', () => {
  it('el año cuesta 10 meses y los precios van en soles enteros', () => {
    for (const plan of Object.values(PLANS)) {
      expect(plan.annualCents).toBe(plan.monthlyCents * 10);
      expect(plan.monthlyCents % 100).toBe(0);
    }
    expect(priceFor('emprendedor', 'monthly')).toBe(2500);
    expect(priceFor('negocio', 'annual')).toBe(49000);
  });

  it('suma meses sin pasarse de fin de mes', () => {
    expect(addMonths(at('2026-01-31T15:00:00Z'), 1).toISOString()).toBe('2026-02-28T15:00:00.000Z');
    expect(addMonths(at('2028-01-31T15:00:00Z'), 1).toISOString()).toBe('2028-02-29T15:00:00.000Z');
    expect(addMonths(at('2026-03-15T00:00:00Z'), 12).toISOString()).toBe(
      '2027-03-15T00:00:00.000Z',
    );
  });

  it('distingue prueba, pagada y vencida', () => {
    const now = at('2026-10-17T12:00:00Z');
    const trial = {
      plan: 'negocio' as const,
      trialEndsAt: at('2026-10-20T12:00:00Z'),
      paidThrough: null,
    };
    expect(licenseState(trial, now)).toMatchObject({ status: 'trial', daysLeft: 3 });
    const expired = { ...trial, trialEndsAt: at('2026-10-01T00:00:00Z') };
    expect(licenseState(expired, now)).toMatchObject({ status: 'expired', daysLeft: 0 });
    const paid = { ...expired, paidThrough: at('2026-11-01T00:00:00Z') };
    expect(licenseState(paid, now)).toMatchObject({ status: 'active' });
    const lapsed = { ...expired, paidThrough: at('2026-10-10T00:00:00Z') };
    expect(licenseState(lapsed, now)).toMatchObject({
      status: 'expired',
      endsAt: at('2026-10-10T00:00:00Z'),
    });
  });

  it('un pago empieza cuando termina lo que ya había', () => {
    const now = at('2026-10-17T12:00:00Z');
    const inTrial = {
      plan: 'negocio' as const,
      trialEndsAt: at('2026-10-20T12:00:00Z'),
      paidThrough: null,
    };
    expect(extendLicense(inTrial, 'monthly', now)).toEqual({
      periodStart: at('2026-10-20T12:00:00Z'),
      periodEnd: at('2026-11-20T12:00:00Z'),
    });
    const lapsed = {
      ...inTrial,
      trialEndsAt: at('2026-01-01T00:00:00Z'),
      paidThrough: at('2026-02-01T00:00:00Z'),
    };
    expect(extendLicense(lapsed, 'annual', now).periodStart).toEqual(now);
  });

  it('no cambia de plan con un periodo pagado corriendo ni baja a uno chico', () => {
    const now = at('2026-10-17T12:00:00Z');
    const paid = {
      plan: 'emprendedor' as const,
      trialEndsAt: at('2026-01-01T00:00:00Z'),
      paidThrough: at('2026-12-01T00:00:00Z'),
    };
    expect(orderProblem({ license: paid, plan: 'negocio', members: 1, now })).toBe(
      'plan_change_while_paid',
    );
    expect(orderProblem({ license: paid, plan: 'emprendedor', members: 1, now })).toBeNull();
    const trial = {
      ...paid,
      plan: 'negocio' as const,
      paidThrough: null,
      trialEndsAt: at('2026-11-01T00:00:00Z'),
    };
    expect(orderProblem({ license: trial, plan: 'emprendedor', members: 4, now })).toBe(
      'plan_too_small',
    );
    expect(orderProblem({ license: trial, plan: 'emprendedor', members: 2, now })).toBeNull();
  });
});
