import type { Cents } from './money.js';
import type { AccountNature } from './pcge.js';

/**
 * Saldo del lado normal de la cuenta: positivo si la cuenta deudora tiene más
 * debe que haber (o la acreedora más haber que debe); negativo si está al revés.
 */
export function natureBalance(nature: AccountNature, debit: Cents, credit: Cents): Cents {
  return nature === 'debit' ? debit - credit : credit - debit;
}

/** Columnas de saldos del balance de comprobación: el saldo va al lado que gana. */
export function balanceSides(
  debit: Cents,
  credit: Cents,
): { debitBalance: Cents; creditBalance: Cents } {
  return debit >= credit
    ? { debitBalance: debit - credit, creditBalance: 0 }
    : { debitBalance: 0, creditBalance: credit - debit };
}

/** Saldo acumulado tras cada movimiento del mayor, desde el saldo inicial. */
export function runningBalances(
  nature: AccountNature,
  opening: Cents,
  movements: readonly { debit: Cents; credit: Cents }[],
): Cents[] {
  let balance = opening;
  return movements.map((m) => (balance += natureBalance(nature, m.debit, m.credit)));
}
