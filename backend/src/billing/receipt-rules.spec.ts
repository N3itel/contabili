import { receiptDescription } from './receipt-rules.js';

describe('comprobante de la licencia', () => {
  it('dice el plan, el ciclo y el periodo en fechas de Lima', () => {
    expect(
      receiptDescription(
        'negocio',
        'monthly',
        new Date('2026-10-18T03:00:00Z'),
        new Date('2026-11-18T03:00:00Z'),
      ),
    ).toBe('Licencia de Contabili, plan Negocio por 1 mes: del 17/10/2026 al 17/11/2026');
    expect(
      receiptDescription(
        'emprendedor',
        'annual',
        new Date('2026-01-05T15:00:00Z'),
        new Date('2027-01-05T15:00:00Z'),
      ),
    ).toBe('Licencia de Contabili, plan Emprendedor por 1 año: del 05/01/2026 al 05/01/2027');
  });
});
