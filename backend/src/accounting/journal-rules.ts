import { type Cents, isValidAmount } from './money.js';

/** Una línea del asiento: va al debe o al haber, nunca a los dos. */
export interface JournalLineInput {
  accountCode: string;
  debit: Cents;
  credit: Cents;
}

export type JournalProblem =
  'too_few_lines' | 'invalid_amount' | 'debit_and_credit' | 'zero_line' | 'unbalanced';

/** Topes por asiento: suficientes para una planilla, sin dejar asientos gigantes. */
export const MAX_LINES_PER_ENTRY = 200;

/**
 * Revisa la partida doble: al menos dos líneas, cada una solo en el debe o
 * solo en el haber, y la suma del debe igual a la del haber. La base vuelve
 * a comprobarlo al confirmar la transacción.
 */
export function checkJournal(lines: readonly JournalLineInput[]): JournalProblem | null {
  if (lines.length < 2) return 'too_few_lines';
  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    if (!isValidAmount(line.debit) || !isValidAmount(line.credit)) return 'invalid_amount';
    if (line.debit > 0 && line.credit > 0) return 'debit_and_credit';
    if (line.debit === 0 && line.credit === 0) return 'zero_line';
    debit += line.debit;
    credit += line.credit;
  }
  if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit)) return 'invalid_amount';
  return debit === credit ? null : 'unbalanced';
}

export const JOURNAL_PROBLEM_MESSAGES: Readonly<Record<JournalProblem, string>> = {
  too_few_lines: 'Un asiento necesita al menos dos líneas.',
  invalid_amount: 'Los montos deben ser céntimos enteros y positivos.',
  debit_and_credit: 'Cada línea va al debe o al haber, no a los dos.',
  zero_line: 'Hay una línea sin monto.',
  unbalanced: 'El debe y el haber no cuadran.',
};

/** Fechas de asiento aceptadas: desde el año 2000 hasta hoy en Lima. */
export const MIN_ENTRY_YEAR = 2000;

/** Línea de un extorno: el mismo monto en el lado opuesto. */
export function reverseLines<T extends { debit: number; credit: number }>(
  lines: readonly T[],
): T[] {
  return lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
}
