import { formatDate, limaDate } from '../accounting/lima.js';
import type { LicenseRow } from './plans.js';

/**
 * Avisos por SMS a los dueños antes de que venza la prueba o el plan, y uno
 * cuando ya venció. Cada aviso sale una sola vez por fecha de vencimiento
 * (índice único en `license_reminders`): pagar mueve la fecha y el ciclo
 * vuelve a empezar.
 */

export type ReminderKind = 'ending' | 'ended';

/** Días antes del vencimiento en que sale el primer aviso. */
export const REMINDER_DAYS_BEFORE = 3;
/** Pasada esta ventana tras vencer, ya no se avisa (empresas abandonadas hace tiempo). */
export const ENDED_REMINDER_WINDOW_DAYS = 7;
/** Dueños a los que se avisa por empresa, como máximo. */
export const MAX_REMINDER_RECIPIENTS = 3;
/** Nombre de la empresa en el SMS: acortado para que todo entre en un mensaje. */
const NAME_MAX = 24;
const DAY_MS = 86_400_000;

export interface DueReminder {
  kind: ReminderKind;
  /** Vencimiento al que se refiere el aviso. */
  endsAt: Date;
  /** Era la prueba gratis (nunca pagó). */
  trial: boolean;
}

/** Fin de lo que tiene la empresa: la prueba o el último periodo pagado, lo que dure más. */
export function licenseEnd(row: LicenseRow): Date {
  return row.paidThrough && row.paidThrough > row.trialEndsAt ? row.paidThrough : row.trialEndsAt;
}

/** El aviso que toca ahora, si alguno. */
export function dueReminder(row: LicenseRow, now: Date): DueReminder | null {
  const endsAt = licenseEnd(row);
  const trial = !row.paidThrough || row.paidThrough <= row.trialEndsAt;
  const left = endsAt.getTime() - now.getTime();
  if (left > 0 && left <= REMINDER_DAYS_BEFORE * DAY_MS) return { kind: 'ending', endsAt, trial };
  if (left <= 0 && -left <= ENDED_REMINDER_WINDOW_DAYS * DAY_MS) {
    return { kind: 'ended', endsAt, trial };
  }
  return null;
}

/**
 * Deja el texto en el alfabeto de los SMS (GSM-7): las vocales con tilde
 * (á, í, ó, ú) pasarían el mensaje a Unicode y lo partirían en tres.
 */
export function gsmSafe(text: string): string {
  return text.normalize('NFD').replace(/[́̀̂]/g, '').normalize('NFC');
}

function shortName(name: string): string {
  const clean = gsmSafe(name.trim().replace(/\s+/g, ' '));
  return clean.length <= NAME_MAX ? clean : `${clean.slice(0, NAME_MAX - 1).trimEnd()}.`;
}

/** El SMS del aviso: sin tildes, en un solo mensaje, con dónde renovar. */
export function reminderText(reminder: DueReminder, companyName: string, planUrl: string): string {
  const name = shortName(companyName);
  const date = formatDate(limaDate(reminder.endsAt)).slice(0, 5);
  const where = planUrl.replace(/^https?:\/\//, '');
  if (reminder.kind === 'ending') {
    return reminder.trial
      ? `Contabili: la prueba gratis de ${name} termina el ${date}. Elige tu plan en ${where} y sigue anotando.`
      : `Contabili: el plan de ${name} vence el ${date}. Renueva en ${where} para seguir anotando.`;
  }
  return `Contabili: plan de ${name} vencido el ${date}. Puedes ver todo; para anotar, renueva en ${where}. Tus datos se guardan.`;
}

/** Caracteres del alfabeto básico GSM-7 (un SMS de hasta 160). */
export const GSM7 =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';

/** Los SMS salen de 9 a. m. a 8 p. m. de Lima: nadie quiere un aviso de madrugada. */
export function isReminderHour(now: Date): boolean {
  const limaHour = (now.getUTCHours() + 24 - 5) % 24;
  return limaHour >= 9 && limaHour < 20;
}
