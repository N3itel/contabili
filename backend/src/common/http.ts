import { HttpException, type HttpStatus, type PipeTransform } from '@nestjs/common';
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
