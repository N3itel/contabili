import { type MonthFlows, monthlyTaxes, roundToSoles, uitFor } from './monthly-taxes.js';

const month = (
  period: string,
  netSales: number,
  igvSales: number,
  igvPurchases: number,
): MonthFlows => ({
  period,
  netSales,
  igvSales,
  igvPurchases,
});

describe('impuestos del mes', () => {
  it('RMT: IGV de ventas menos compras y 1 % de renta', () => {
    const t = monthlyTaxes('rmt', [month('2026-10', 1000000, 180000, 54000)]);
    expect(t.igv).toEqual({
      sales: 180000,
      purchases: 54000,
      previousCredit: 0,
      toPay: 126000,
      nextCredit: 0,
    });
    expect(t.income).toMatchObject({ kind: 'monthly_payment', ratePercent: 1, amount: 10000 });
    expect(t.total).toBe(136000);
  });

  it('arrastra el saldo a favor de IGV de meses anteriores', () => {
    const t = monthlyTaxes('rer', [
      month('2026-08', 100000, 18000, 50000), // compró más: 32 000 a favor
      month('2026-09', 100000, 18000, 0), // usa 18 000; quedan 14 000
      month('2026-10', 200000, 36000, 0), // 36 000 - 14 000 = 22 000 por pagar
    ]);
    expect(t.igv).toMatchObject({ previousCredit: 14000, toPay: 22000, nextCredit: 0 });
    expect(t.income).toMatchObject({ ratePercent: 1.5, amount: 3000 });
  });

  it('un mes con más compras deja saldo a favor y nada por pagar', () => {
    const t = monthlyTaxes('general', [month('2026-10', 50000, 9000, 20000)]);
    expect(t.igv).toMatchObject({ toPay: 0, nextCredit: 11000 });
    expect(t.notes.some((n) => n.includes('coeficiente'))).toBe(true);
  });

  it('RMT pasa a 1.5 % cuando el año supera las 300 UIT', () => {
    // 300 UIT de 2026 = S/ 1 650 000.
    const t = monthlyTaxes('rmt', [
      month('2026-01', 165000000, 0, 0),
      month('2026-02', 100000, 0, 0),
    ]);
    expect(t.income.ratePercent).toBe(1.5);
    // Lo del año anterior no cuenta para el tope.
    const fresh = monthlyTaxes('rmt', [
      month('2025-12', 165000000, 0, 0),
      month('2026-01', 100000, 0, 0),
    ]);
    expect(fresh.income.ratePercent).toBe(1);
  });

  it('Nuevo RUS: cuota fija según lo vendido en el mes, sin IGV', () => {
    expect(monthlyTaxes('nrus', [month('2026-10', 450000, 0, 0)]).income).toMatchObject({
      nrusCategory: 1,
      amount: 2000,
    });
    const cat2 = monthlyTaxes('nrus', [month('2026-10', 700000, 0, 0)]);
    expect(cat2.income).toMatchObject({ nrusCategory: 2, amount: 5000 });
    expect(cat2.igv).toBeNull();
    const over = monthlyTaxes('nrus', [month('2026-10', 900000, 0, 0)]);
    expect(over.notes[0]).toContain('ya no te corresponde');
  });

  it('redondea a soles enteros y conoce la UIT', () => {
    expect(roundToSoles(12349)).toBe(12300);
    expect(roundToSoles(12350)).toBe(12400);
    expect(uitFor(2026)).toEqual({ uit: 550000, known: true });
    expect(uitFor(2030).known).toBe(false);
  });
});
