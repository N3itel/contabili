import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Request } from 'express';
import { apiError } from '../common/http.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { sessions, users } from '../db/schema/index.js';
import { type AccessClaims, TokenService } from './tokens.js';

const IS_PUBLIC = 'contabili:isPublic';

/** La ruta no pide sesión (inicio de sesión, salud del servicio). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export interface AuthContext {
  userId: string;
  sessionId: string;
}

type AuthedRequest = Request & { auth?: AuthContext };

/** Usuario de la sesión actual: `@CurrentAuth() auth: AuthContext`. */
export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth) throw new Error('CurrentAuth usado en una ruta pública');
  return auth;
});

/**
 * Guard global: toda ruta pide un token de acceso válido, salvo las marcadas
 * con @Public(). Revisa en la base que la sesión siga abierta y que la cuenta
 * no esté bloqueada, así cerrar sesión o bloquear tiene efecto inmediato.
 * Los permisos dentro de cada empresa los revisa `CompanyAccess`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(DRIZZLE) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return false;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const claims = token ? await this.tokens.verifyAccess(token) : null;
    if (!claims) throw unauthorized();

    const status = await loadSessionStatus(this.db, claims);
    if (!status) throw unauthorized();
    if (status === 'blocked') {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'account_blocked',
        'Tu cuenta está bloqueada. Escríbenos a soporte para revisarla.',
      );
    }

    request.auth = { userId: claims.userId, sessionId: claims.sessionId };
    return true;
  }
}

/** Estado de la cuenta del token: null si la sesión se cerró, venció o no es de ese usuario. */
export async function loadSessionStatus(
  db: Database,
  claims: AccessClaims,
): Promise<'active' | 'blocked' | null> {
  const [row] = await db
    .select({ status: users.status })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.id, claims.sessionId),
        eq(sessions.userId, claims.userId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    );
  return row?.status ?? null;
}

function unauthorized() {
  return apiError(HttpStatus.UNAUTHORIZED, 'unauthorized', 'Inicia sesión para continuar.');
}
