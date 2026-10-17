import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { apiError } from '../common/http.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { phoneVerifications, sessions, userConsents, users } from '../db/schema/index.js';
import { TERMS_VERSION } from '../users/consent.js';
import { loadMe, type MeDto } from '../users/me.js';
import {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_SECONDS,
  OTP_TTL_SECONDS,
  canSendOtp,
  generateOtp,
  hashOtp,
  otpMatches,
  otpMessage,
} from './otp.js';
import { normalizePeruMobile } from './phone.js';
import { SMS_SENDER, type SmsSender } from './sms.js';
import { ACCESS_TTL_SECONDS, REFRESH_TTL_DAYS, TokenService, hashRefreshToken } from './tokens.js';

/** Si llegan dos renovaciones casi juntas (la app reintentó), no se trata como robo. */
const ROTATION_GRACE_MS = 30_000;

export interface SignedIn {
  status: 'signed_in';
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: MeDto;
}

export interface RegistrationRequired {
  status: 'registration_required';
  registrationToken: string;
}

const invalidPhone = () =>
  apiError(HttpStatus.BAD_REQUEST, 'invalid_phone', 'Ingresa un celular peruano de 9 dígitos.');

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @Inject(TokenService) private readonly tokens: TokenService,
  ) {}

  /** Envía un código por SMS, respetando la espera entre envíos y los topes por hora y por día. */
  async requestCode(phoneInput: string) {
    const phone = normalizePeruMobile(phoneInput);
    if (!phone) throw invalidPhone();
    const code = generateOtp();
    const now = new Date();

    const verificationId = await this.db.transaction(async (tx) => {
      // Un envío a la vez por número, para que dos pedidos simultáneos no salten el límite.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`otp:${phone}`}))`);
      const recent = await tx
        .select({ createdAt: phoneVerifications.createdAt })
        .from(phoneVerifications)
        .where(
          and(
            eq(phoneVerifications.phone, phone),
            gt(phoneVerifications.createdAt, new Date(now.getTime() - 24 * 3600_000)),
          ),
        );
      const decision = canSendOtp(
        recent.map((r) => r.createdAt),
        now,
      );
      if (!decision.allowed) {
        throw decision.reason === 'too_soon'
          ? apiError(
              HttpStatus.TOO_MANY_REQUESTS,
              'otp_too_soon',
              `Espera ${decision.retryAfterSeconds} segundos para pedir otro código.`,
              { retryAfterSeconds: decision.retryAfterSeconds },
            )
          : apiError(
              HttpStatus.TOO_MANY_REQUESTS,
              decision.reason === 'daily_limit' ? 'otp_daily_limit' : 'otp_hourly_limit',
              'Pediste muchos códigos. Intenta de nuevo más tarde.',
              { retryAfterSeconds: decision.retryAfterSeconds },
            );
      }
      const [row] = await tx
        .insert(phoneVerifications)
        .values({
          phone,
          codeHash: hashOtp(this.tokens.otpSecret, phone, code),
          expiresAt: new Date(now.getTime() + OTP_TTL_SECONDS * 1000),
          createdAt: now,
        })
        .returning({ id: phoneVerifications.id });
      return row.id;
    });

    try {
      await this.sms.send(phone, otpMessage(code));
    } catch (error) {
      // Si el SMS no salió, el intento no cuenta para el límite.
      await this.db.delete(phoneVerifications).where(eq(phoneVerifications.id, verificationId));
      this.logger.error(`No se pudo enviar el SMS: ${(error as Error).message}`);
      throw apiError(
        HttpStatus.BAD_GATEWAY,
        'sms_failed',
        'No pudimos enviar el SMS. Intenta de nuevo en un momento.',
      );
    }

    return { phone, expiresInSeconds: OTP_TTL_SECONDS, resendAfterSeconds: OTP_RESEND_SECONDS };
  }

  /** Comprueba el código. Si el número ya tiene cuenta, inicia sesión; si no, pide el registro. */
  async verifyCode(
    phoneInput: string,
    code: string,
    deviceName?: string,
  ): Promise<SignedIn | RegistrationRequired> {
    const phone = normalizePeruMobile(phoneInput);
    if (!phone) throw invalidPhone();
    const now = new Date();
    await this.confirmCode(phone, code, now);

    const [user] = await this.db
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.phone, phone));
    if (!user) {
      return {
        status: 'registration_required',
        registrationToken: await this.tokens.signRegistration(phone),
      };
    }
    if (user.status === 'blocked') throw blocked();
    return this.startSession(user.id, deviceName);
  }

  /** Comprueba y gasta el último código enviado a `phone` (ya normalizado), con el tope de intentos. */
  private async confirmCode(phone: string, code: string, now: Date): Promise<void> {
    const [pending] = await this.db
      .select()
      .from(phoneVerifications)
      .where(
        and(
          eq(phoneVerifications.phone, phone),
          isNull(phoneVerifications.consumedAt),
          gt(phoneVerifications.expiresAt, now),
        ),
      )
      .orderBy(desc(phoneVerifications.createdAt))
      .limit(1);
    if (!pending) throw otpExpired();

    // Cuenta el intento antes de comparar, de forma atómica.
    const [counted] = await this.db
      .update(phoneVerifications)
      .set({ attempts: sql`${phoneVerifications.attempts} + 1` })
      .where(
        and(
          eq(phoneVerifications.id, pending.id),
          lt(phoneVerifications.attempts, OTP_MAX_ATTEMPTS),
        ),
      )
      .returning({ attempts: phoneVerifications.attempts });
    if (!counted) {
      throw apiError(
        HttpStatus.TOO_MANY_REQUESTS,
        'otp_locked',
        'Demasiados intentos con este código. Pide uno nuevo.',
      );
    }

    if (!otpMatches(this.tokens.otpSecret, phone, code, pending.codeHash)) {
      const attemptsLeft = OTP_MAX_ATTEMPTS - counted.attempts;
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'otp_invalid',
        attemptsLeft > 0
          ? `El código no es correcto. Te quedan ${attemptsLeft} intentos.`
          : 'El código no es correcto. Pide uno nuevo.',
        { attemptsLeft },
      );
    }

    const [consumed] = await this.db
      .update(phoneVerifications)
      .set({ consumedAt: now })
      .where(and(eq(phoneVerifications.id, pending.id), isNull(phoneVerifications.consumedAt)))
      .returning({ id: phoneVerifications.id });
    if (!consumed) throw otpExpired();
  }

  /**
   * Crea la cuenta de un número recién verificado. La persona aceptó los
   * términos y la privacidad vigentes (el cuerpo exige `acceptTerms: true`):
   * se guarda qué versión aceptó.
   */
  async register(input: {
    registrationToken: string;
    fullName: string;
    email?: string;
    deviceName?: string;
  }): Promise<SignedIn> {
    const phone = await this.tokens.verifyRegistration(input.registrationToken);
    if (!phone) {
      throw apiError(
        HttpStatus.UNAUTHORIZED,
        'registration_expired',
        'Pasó mucho tiempo desde que verificaste tu número. Pide un código nuevo.',
      );
    }

    const userId = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({
          phone,
          fullName: input.fullName,
          email: input.email ?? null,
          phoneVerifiedAt: new Date(),
        })
        .onConflictDoNothing({ target: users.phone })
        .returning({ id: users.id });
      if (!created) {
        throw apiError(
          HttpStatus.CONFLICT,
          'already_registered',
          'Este número ya tiene una cuenta. Inicia sesión.',
        );
      }
      await tx
        .insert(userConsents)
        .values({ userId: created.id, document: 'terms', version: TERMS_VERSION });
      return created.id;
    });

    return this.startSession(userId, input.deviceName);
  }

  /** Cambia un refresh token por uno nuevo. Si llega uno ya usado, cierra todas las sesiones. */
  async refresh(refreshToken: string): Promise<SignedIn> {
    const now = new Date();
    const [session] = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, hashRefreshToken(refreshToken)));
    if (!session) throw sessionInvalid();

    if (session.revokedAt) {
      const recentlyRotated =
        session.replacedById !== null &&
        now.getTime() - session.revokedAt.getTime() < ROTATION_GRACE_MS;
      if (recentlyRotated) throw sessionRotated();
      await this.revokeAll(session.userId, now);
      this.logger.warn(`Refresh token reutilizado; se cerraron las sesiones de ${session.userId}`);
      throw apiError(
        HttpStatus.UNAUTHORIZED,
        'session_reused',
        'Por seguridad cerramos tu sesión. Vuelve a ingresar.',
      );
    }
    if (session.expiresAt <= now) throw sessionInvalid();

    const [user] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, session.userId));
    if (!user) throw sessionInvalid();
    if (user.status === 'blocked') throw blocked();

    const next = this.tokens.newRefreshToken();
    const newSessionId = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(sessions)
        .values({
          userId: session.userId,
          tokenHash: next.hash,
          deviceName: session.deviceName,
          expiresAt: refreshExpiry(now),
          lastUsedAt: now,
          // Renovar no es volver a ingresar el código.
          authenticatedAt: session.authenticatedAt,
        })
        .returning({ id: sessions.id });
      const [rotated] = await tx
        .update(sessions)
        .set({ revokedAt: now, replacedById: created.id })
        .where(and(eq(sessions.id, session.id), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      // Otra petición la rotó un instante antes: se descarta la nueva.
      if (!rotated) throw sessionRotated();
      return created.id;
    });

    return this.signedIn(session.userId, newSessionId, next.token);
  }

  /** Cierra la sesión dueña de este refresh token. No revela si existía. */
  async revoke(refreshToken: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(sessions.tokenHash, hashRefreshToken(refreshToken)), isNull(sessions.revokedAt)),
      );
  }

  async logout(sessionId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }

  private async startSession(userId: string, deviceName?: string): Promise<SignedIn> {
    const now = new Date();
    const refresh = this.tokens.newRefreshToken();
    const [session] = await this.db
      .insert(sessions)
      .values({
        userId,
        tokenHash: refresh.hash,
        deviceName: deviceName ?? null,
        expiresAt: refreshExpiry(now),
        lastUsedAt: now,
        // Se acaba de ingresar el código por SMS.
        authenticatedAt: now,
      })
      .returning({ id: sessions.id });
    return this.signedIn(userId, session.id, refresh.token);
  }

  private async signedIn(
    userId: string,
    sessionId: string,
    refreshToken: string,
  ): Promise<SignedIn> {
    const user = await loadMe(this.db, userId);
    if (!user) throw sessionInvalid();
    return {
      status: 'signed_in',
      accessToken: await this.tokens.signAccess({ userId, sessionId }),
      refreshToken,
      expiresInSeconds: ACCESS_TTL_SECONDS,
      user,
    };
  }

  private async revokeAll(userId: string, now: Date): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }
}

function refreshExpiry(now: Date): Date {
  return new Date(now.getTime() + REFRESH_TTL_DAYS * 86_400_000);
}

function otpExpired() {
  return apiError(
    HttpStatus.BAD_REQUEST,
    'otp_expired',
    'El código venció o ya se usó. Pide uno nuevo.',
  );
}

function sessionInvalid() {
  return apiError(
    HttpStatus.UNAUTHORIZED,
    'session_invalid',
    'Tu sesión terminó. Vuelve a ingresar.',
  );
}

function sessionRotated() {
  return apiError(
    HttpStatus.CONFLICT,
    'session_rotated',
    'La sesión se acaba de renovar. Usa el token más reciente.',
  );
}

function blocked() {
  return apiError(
    HttpStatus.FORBIDDEN,
    'account_blocked',
    'Tu cuenta está bloqueada. Escríbenos a soporte para revisarla.',
  );
}
