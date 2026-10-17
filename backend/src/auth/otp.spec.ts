import {
  OTP_LENGTH,
  OTP_MAX_PER_DAY,
  OTP_MAX_PER_HOUR,
  canSendOtp,
  generateOtp,
  hashOtp,
  otpMatches,
  otpMessage,
} from './otp.js';

const SECRET = 's'.repeat(40);
const PHONE = '+51987654321';
const at = (iso: string) => new Date(iso);

describe('código por SMS', () => {
  it('siempre tiene 6 dígitos, con ceros a la izquierda si toca', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateOtp()).toMatch(/^\d{6}$/);
    }
    expect(OTP_LENGTH).toBe(6);
  });

  it('el hash depende del teléfono y del secreto', () => {
    const base = hashOtp(SECRET, PHONE, '123456');
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOtp(SECRET, '+51900000000', '123456')).not.toBe(base);
    expect(hashOtp('otro'.repeat(10), PHONE, '123456')).not.toBe(base);
  });

  it('compara el código sin aceptar variantes', () => {
    const hash = hashOtp(SECRET, PHONE, '012345');
    expect(otpMatches(SECRET, PHONE, '012345', hash)).toBe(true);
    expect(otpMatches(SECRET, PHONE, '12345', hash)).toBe(false);
    expect(otpMatches(SECRET, PHONE, ' 012345', hash)).toBe(false);
    expect(otpMatches(SECRET, PHONE, '012346', hash)).toBe(false);
    expect(otpMatches(SECRET, '+51900000000', '012345', hash)).toBe(false);
  });

  it('el mensaje entra en un solo SMS', () => {
    expect(otpMessage('123456').length).toBeLessThanOrEqual(160);
  });
});

describe('límites de envío', () => {
  const now = at('2026-10-01T12:00:00Z');

  it('permite el primer envío', () => {
    expect(canSendOtp([], now)).toEqual({ allowed: true });
  });

  it('pide esperar 60 segundos entre envíos', () => {
    expect(canSendOtp([at('2026-10-01T11:59:20Z')], now)).toEqual({
      allowed: false,
      reason: 'too_soon',
      retryAfterSeconds: 20,
    });
    expect(canSendOtp([at('2026-10-01T11:59:00Z')], now)).toEqual({ allowed: true });
  });

  it('corta en 5 códigos por hora y dice cuándo se libera un cupo', () => {
    const sent = [
      '2026-10-01T11:10:00Z',
      '2026-10-01T11:20:00Z',
      '2026-10-01T11:30:00Z',
      '2026-10-01T11:40:00Z',
      '2026-10-01T11:50:00Z',
    ].map(at);
    expect(sent).toHaveLength(OTP_MAX_PER_HOUR);
    expect(canSendOtp(sent, now)).toEqual({
      allowed: false,
      reason: 'hourly_limit',
      retryAfterSeconds: 10 * 60,
    });
  });

  it('ignora los envíos de hace más de una hora', () => {
    const sent = [
      '2026-10-01T10:30:00Z',
      '2026-10-01T10:40:00Z',
      '2026-10-01T11:20:00Z',
      '2026-10-01T11:30:00Z',
      '2026-10-01T11:40:00Z',
    ].map(at);
    expect(canSendOtp(sent, now)).toEqual({ allowed: true });
  });

  it('corta en 10 códigos por día aunque estén repartidos', () => {
    const sent = Array.from({ length: OTP_MAX_PER_DAY }, (_, i) => at(`2026-10-01T0${i}:05:00Z`));
    const decision = canSendOtp(sent, now);
    expect(decision).toMatchObject({ allowed: false, reason: 'daily_limit' });
    // Se libera cuando el más antiguo cumple 24 horas.
    expect(canSendOtp(sent, at('2026-10-02T00:05:01Z'))).toEqual({ allowed: true });
  });
});
