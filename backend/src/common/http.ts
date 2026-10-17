import { HttpException, type HttpStatus, ParseUUIDPipe, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Error de la API: `code` es estable para que las apps decidan qué hacer;
 * `message` va en español y se puede mostrar tal cual al usuario.
 */
export function apiError(
  status: HttpStatus,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): HttpException {
  return new HttpException({ code, message, ...extra }, status);
}

/** Valida el cuerpo de una petición con zod: `@Body(new ZodPipe(schema))`. */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw apiError(400, 'invalid_request', 'Revisa los datos enviados.', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return parsed.data;
  }
}

/** Ventana deslizante en memoria. Suficiente con una instancia; con varias, pasa a Redis. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Registra un intento y dice si está permitido; si no, en cuántos segundos. */
  hit(key: string, now = Date.now()): { allowed: true } | { allowed: false; retryAfter: number } {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return { allowed: false, retryAfter: Math.ceil((recent[0] + this.windowMs - now) / 1000) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 50_000) this.prune(now);
    return { allowed: true };
  }

  private prune(now: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
  }
}

/** Identificador en la ruta: `@Param('id', uuidParam()) id: string`. */
export function uuidParam(): ParseUUIDPipe {
  return new ParseUUIDPipe({
    exceptionFactory: () => apiError(400, 'invalid_id', 'El identificador no es válido.'),
  });
}
