import { z } from 'zod';
import { RateLimiter, ZodPipe, apiError } from './http.js';

describe('errores de la API', () => {
  it('lleva código estable, mensaje y datos extra', () => {
    const error = apiError(429, 'otp_too_soon', 'Espera un momento.', { retryAfterSeconds: 20 });
    expect(error.getStatus()).toBe(429);
    expect(error.getResponse()).toEqual({
      code: 'otp_too_soon',
      message: 'Espera un momento.',
      retryAfterSeconds: 20,
    });
  });
});

describe('validación con zod', () => {
  const pipe = new ZodPipe(z.object({ phone: z.string().min(9) }));

  it('devuelve el valor validado', () => {
    expect(pipe.transform({ phone: '987654321', extra: 1 })).toEqual({ phone: '987654321' });
  });

  it('responde 400 con la lista de problemas', () => {
    try {
      pipe.transform({ phone: '1' });
      expect.unreachable();
    } catch (error) {
      const response = (error as ReturnType<typeof apiError>).getResponse() as {
        code: string;
        issues: { path: string }[];
      };
      expect(response.code).toBe('invalid_request');
      expect(response.issues[0].path).toBe('phone');
    }
  });
});

describe('límite por ventana', () => {
  it('permite hasta el límite y luego dice cuánto esperar', () => {
    const limiter = new RateLimiter(2, 60_000);
    expect(limiter.hit('ip', 0)).toEqual({ allowed: true });
    expect(limiter.hit('ip', 10_000)).toEqual({ allowed: true });
    expect(limiter.hit('ip', 20_000)).toEqual({ allowed: false, retryAfter: 40 });
    expect(limiter.hit('otra-ip', 20_000)).toEqual({ allowed: true });
    expect(limiter.hit('ip', 60_001)).toEqual({ allowed: true });
  });
});
