import { periodRange } from './lima.js';

/**
 * Cierre de periodos. Cada empresa tiene una fecha de cierre (`closed_through`):
 * los asientos con fecha igual o anterior ya no se registran. Cerrar marzo
 * cierra también lo anterior; reabrir marzo deja abierto desde el 1 de marzo.
 */

/** Día anterior a una fecha 'AAAA-MM-DD'. */
export function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Solo se cierra un mes que ya terminó y que no estaba cerrado. */
export function closeProblem(input: {
  period: string;
  today: string;
  closedThrough: string | null;
}): 'period_not_ended' | 'already_closed' | null {
  const { to } = periodRange(input.period);
  if (to >= input.today) return 'period_not_ended';
  if (input.closedThrough && to <= input.closedThrough) return 'already_closed';
  return null;
}

/**
 * Reabrir un mes: la fecha de cierre vuelve al último día del mes anterior.
 * Solo tiene sentido si ese mes estaba cerrado.
 */
export function reopenTarget(input: {
  period: string;
  closedThrough: string | null;
}): { closedThrough: string } | 'not_closed' {
  const { from } = periodRange(input.period);
  if (!input.closedThrough || from > input.closedThrough) return 'not_closed';
  return { closedThrough: dayBefore(from) };
}
