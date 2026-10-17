import { PLAN_CODES } from './plans.js';
import { culqiFee, unitEconomics } from './unit-economics.js';

/** Margen mínimo sobre el ingreso sin IGV: cubre soporte, marketing y costos fijos. */
const MIN_MARGIN_PERCENT = 40;

describe('ningún precio en pérdida', () => {
  it('aplica el mínimo de Culqi a los cargos chicos', () => {
    expect(culqiFee(2500)).toBe(350);
    expect(culqiFee(25000)).toBe(935);
  });

  for (const plan of PLAN_CODES) {
    for (const cycle of ['monthly', 'annual'] as const) {
      it(`${plan} ${cycle} deja al menos ${MIN_MARGIN_PERCENT} % con el plan lleno`, () => {
        const unit = unitEconomics(plan, cycle);
        expect(unit.marginCents).toBeGreaterThan(0);
        expect(unit.marginPercent).toBeGreaterThanOrEqual(MIN_MARGIN_PERCENT);
      });
    }
  }
});
