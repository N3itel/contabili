import { createHash, createHmac, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignJWT, jwtVerify } from 'jose';
import type { Env } from '../config/env.js';

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REGISTRATION_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_DAYS = 60;

const ISSUER = 'contabili';
const ACCESS_AUDIENCE = 'contabili-api';
const REGISTRATION_AUDIENCE = 'contabili-register';

export interface AccessClaims {
  userId: string;
  sessionId: string;
}

/** Token de acceso válido, con su vencimiento (el tiempo real corta la conexión ahí). */
export interface VerifiedAccess extends AccessClaims {
  expiresAt: Date;
}

/** Deriva claves distintas para cada uso a partir del secreto principal. */
export function deriveKey(secret: string, purpose: string): Buffer {
  return createHmac('sha256', secret).update(`contabili:${purpose}`).digest();
}

/** SHA-256 en hexadecimal del refresh token; así se guarda en la base. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Tokens de acceso (JWT HS256, 15 minutos), de registro y de sesión. */
@Injectable()
export class TokenService {
  private readonly jwtKey: Uint8Array;
  /** Clave del HMAC de los códigos por SMS. */
  readonly otpSecret: string;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    const secret = config.get('AUTH_JWT_SECRET', { infer: true });
    this.jwtKey = new Uint8Array(deriveKey(secret, 'jwt'));
    this.otpSecret = deriveKey(secret, 'otp').toString('hex');
  }

  signAccess({ userId, sessionId }: AccessClaims): Promise<string> {
    return new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(ACCESS_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
      .sign(this.jwtKey);
  }

  async verifyAccess(token: string): Promise<VerifiedAccess | null> {
    try {
      const { payload } = await jwtVerify(token, this.jwtKey, {
        issuer: ISSUER,
        audience: ACCESS_AUDIENCE,
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
      if (typeof payload.exp !== 'number') return null;
      return {
        userId: payload.sub,
        sessionId: payload.sid,
        expiresAt: new Date(payload.exp * 1000),
      };
    } catch {
      return null;
    }
  }

  /** Prueba de que el teléfono ya se verificó, para completar el registro. */
  signRegistration(phone: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(phone)
      .setIssuer(ISSUER)
      .setAudience(REGISTRATION_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${REGISTRATION_TTL_SECONDS}s`)
      .sign(this.jwtKey);
  }

  async verifyRegistration(token: string): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, this.jwtKey, {
        issuer: ISSUER,
        audience: REGISTRATION_AUDIENCE,
        algorithms: ['HS256'],
      });
      return typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }

  /** Refresh token opaco de 256 bits y su hash. */
  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: hashRefreshToken(token) };
  }
}
