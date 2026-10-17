import { type AccountSums, buildSummary } from './summary-rules.js';

const row = (code: string, toDate: [number, number], inPeriod: [number, number] = [0, 0]) =>
  ({
    code,
    debitToDate: toDate[0],
    creditToDate: toDate[1],
    debitInPeriod: inPeriod[0],
    creditInPeriod: inPeriod[1],
  }) satisfies AccountSums;

describe('resumen de finanzas', () => {
  it('reúne plata, deudas, IGV y el resultado del mes', () => {
    const summary = buildSummary([
      row('1011', [11800, 2000]),
      row('10411', [50000, 23600]),
      row('1212', [23600, 11800]),
      row('4212', [0, 5000]),
      row('40111', [3600, 3600], [3600, 1800]),
      row('7011', [0, 20000], [0, 10000]),
      row('63', [20000, 0], [20000, 0]),
      row('69', [5000, 0], [5000, 0]),
    ]);
    expect(summary).toEqual({
      money: { cash: 9800, bank: 26400, total: 36200 },
      receivable: 11800,
      payable: 5000,
      // Este mes pagaste más IGV del que cobraste: queda a tu favor.
      igv: { month: -1800, balance: 0 },
      month: { sales: 10000, expenses: 20000, result: -10000 },
    });
  });

  it('sin movimientos, todo en cero', () => {
    expect(buildSummary([])).toEqual({
      money: { cash: 0, bank: 0, total: 0 },
      receivable: 0,
      payable: 0,
      igv: { month: 0, balance: 0 },
      month: { sales: 0, expenses: 0, result: 0 },
    });
  });
});
