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

/** Fecha calendario real en formato 'AAAA-MM-DD' (rechaza 2026-02-30). */
export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

/** Primer y último día de un periodo 'AAAA-MM'. */
export function periodRange(period: string): { from: string; to: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error(`Periodo inválido: ${period}`);
  const [year, month] = period.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}` };
}

/** Para mostrar: '2026-03-31' → '31/03/2026'. */
export function formatDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}
