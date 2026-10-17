import type { Cents } from './money.js';

/** Sumas de una cuenta: hasta la fecha del resumen y solo dentro del mes. */
export interface AccountSums {
  code: string;
  debitToDate: Cents;
  creditToDate: Cents;
  debitInPeriod: Cents;
  creditInPeriod: Cents;
}

/** Las finanzas del negocio en palabras simples, para quien no es contador. */
export interface FinanceSummary {
  /** Plata disponible: caja y bancos (elemento 10). */
  money: { cash: Cents; bank: Cents; total: Cents };
  /** Lo que los clientes te deben (12). */
  receivable: Cents;
  /** Lo que debes a proveedores (42). */
  payable: Cents;
  /** IGV: positivo es lo que toca pagar a SUNAT; negativo, saldo a tu favor. */
  igv: { month: Cents; balance: Cents };
  /**
   * El mes: ventas (70) menos gastos (60 a 68). Es aproximado: no considera
   * el costo de ventas ni la variación del inventario.
   */
  month: { sales: Cents; expenses: Cents; result: Cents };
}

const EXPENSE_PREFIXES = ['60', '61', '62', '63', '64', '65', '66', '67', '68'];

export function buildSummary(rows: readonly AccountSums[]): FinanceSummary {
  const sum = (match: (code: string) => boolean, pick: (r: AccountSums) => Cents) =>
    rows.filter((r) => match(r.code)).reduce((total, r) => total + pick(r), 0);
  const starts = (prefix: string) => (code: string) => code.startsWith(prefix);
  const debitBalance = (r: AccountSums) => r.debitToDate - r.creditToDate;
  const creditBalance = (r: AccountSums) => r.creditToDate - r.debitToDate;

  const cash = sum(starts('101'), debitBalance);
  const total = sum(starts('10'), debitBalance);
  const sales = sum(starts('70'), (r) => r.creditInPeriod - r.debitInPeriod);
  const expenses = sum(
    (code) => EXPENSE_PREFIXES.some((p) => code.startsWith(p)),
    (r) => r.debitInPeriod - r.creditInPeriod,
  );
  return {
    money: { cash, bank: total - cash, total },
    receivable: sum(starts('12'), debitBalance),
    payable: sum(starts('42'), creditBalance),
    igv: {
      month: sum(starts('40111'), (r) => r.creditInPeriod - r.debitInPeriod),
      balance: sum(starts('40111'), creditBalance),
    },
    month: { sales, expenses, result: sales - expenses },
  };
}
