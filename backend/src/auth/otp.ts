import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/** Reglas del código por SMS. */
export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;
/** Espera mínima entre dos envíos al mismo número. */
export const OTP_RESEND_SECONDS = 60;
/** Máximo de códigos por número en una hora. */
export const OTP_MAX_PER_HOUR = 5;
/** Y en un día: limita cuántas veces se puede intentar adivinar el código de alguien. */
export const OTP_MAX_PER_DAY = 10;

/** Código numérico con un generador criptográfico. */
export function generateOtp(): string {
  return randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, '0');
}

/**
 * HMAC del código ligado al teléfono: el mismo código para otro número da otro
 * hash, y sin el secreto no se puede probar el millón de combinaciones.
 */
export function hashOtp(secret: string, phone: string, code: string): string {
  return createHmac('sha256', secret).update(`otp:${phone}:${code}`).digest('hex');
}

export function otpMatches(secret: string, phone: string, code: string, hash: string): boolean {
  if (!/^\d+$/.test(code) || code.length !== OTP_LENGTH) return false;
  const expected = Buffer.from(hashOtp(secret, phone, code), 'hex');
  const stored = Buffer.from(hash, 'hex');
  return expected.length === stored.length && timingSafeEqual(expected, stored);
}

export type SendDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'too_soon' | 'hourly_limit' | 'daily_limit';
      retryAfterSeconds: number;
    };

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/**
 * Decide si se puede enviar otro código, a partir de las fechas de los códigos
 * enviados a ese número en las últimas 24 horas (en cualquier orden).
 */
export function canSendOtp(sentInLastDay: Date[], now: Date): SendDecision {
  const day = sentInLastDay
    .map((d) => d.getTime())
    .filter((t) => now.getTime() - t < DAY)
    .sort((a, b) => a - b);
  const times = day.filter((t) => now.getTime() - t < HOUR);

  const last = times.at(-1);
  if (last !== undefined) {
    const elapsed = Math.floor((now.getTime() - last) / 1000);
    if (elapsed < OTP_RESEND_SECONDS) {
      return {
        allowed: false,
        reason: 'too_soon',
        retryAfterSeconds: OTP_RESEND_SECONDS - elapsed,
      };
    }
  }

  if (day.length >= OTP_MAX_PER_DAY) {
    const oldest = day[day.length - OTP_MAX_PER_DAY];
    const retry = Math.ceil((oldest + DAY - now.getTime()) / 1000);
    return { allowed: false, reason: 'daily_limit', retryAfterSeconds: Math.max(retry, 1) };
  }

  if (times.length >= OTP_MAX_PER_HOUR) {
    // Se libera un cupo cuando el más antiguo de los últimos cinco cumple una hora.
    const oldest = times[times.length - OTP_MAX_PER_HOUR];
    const retry = Math.ceil((oldest + HOUR - now.getTime()) / 1000);
    return { allowed: false, reason: 'hourly_limit', retryAfterSeconds: Math.max(retry, 1) };
  }

  return { allowed: true };
}

/**
 * Texto del SMS, con la advertencia de no compartirlo. Lleva tilde, así que
 * va en Unicode: hasta 70 caracteres para que sea una sola parte (y un solo cobro).
 */
export function otpMessage(code: string): string {
  return `Contabili: tu código es ${code}. Vence en 5 min. No lo compartas.`;
}
