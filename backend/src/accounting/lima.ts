/** Perú no tiene horario de verano: Lima está siempre en UTC−5. */
export const LIMA_TIME_ZONE = 'America/Lima';

const limaDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: LIMA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Fecha calendario en Lima, como 'AAAA-MM-DD' (formato de las columnas date). */
export function limaDate(at: Date): string {
  return limaDateFormat.format(at);
}

/** Periodo contable (mes) de una fecha 'AAAA-MM-DD': '2026-10'. */
export function periodOf(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Fecha inválida: ${date}`);
  return date.slice(0, 7);
}
