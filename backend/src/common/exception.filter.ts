import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * Responde los errores sin filtrar datos. Los errores de base de datos de
 * drizzle traen en el mensaje los parámetros de la consulta (teléfonos, DNI…):
 * de ellos solo se registra el tipo, el código de PostgreSQL y la restricción.
 */
@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errores');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      response
        .status(exception.getStatus())
        .json(typeof body === 'string' ? { code: 'error', message: body } : body);
      return;
    }

    this.logger.error(describe(exception));
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 'internal',
      message: 'Algo salió mal de nuestro lado. Intenta de nuevo en un momento.',
    });
  }
}

/** Descripción segura para el log: sin mensajes ni parámetros de consultas. */
export function describe(exception: unknown): string {
  if (!(exception instanceof Error)) return 'Error desconocido';
  const cause = (exception as { cause?: { code?: string; constraint?: string; name?: string } })
    .cause;
  const pg = exception as { code?: string; constraint?: string };
  const code = cause?.code ?? pg.code;
  const constraint = cause?.constraint ?? pg.constraint;
  if (code || exception.name === 'DrizzleQueryError') {
    return `Error de base de datos ${exception.name}${code ? ` [${code}]` : ''}${constraint ? ` en ${constraint}` : ''}`;
  }
  // Errores de programación: el mensaje y la pila no llevan datos de usuarios.
  return exception.stack ?? `${exception.name}: ${exception.message}`;
}
