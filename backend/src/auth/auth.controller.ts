import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { RateLimiter, ZodPipe, apiError } from '../common/http.js';
import { emailSchema, fullNameSchema } from '../users/validation.js';
import { type AuthContext, CurrentAuth, Public } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { rateLimitKey } from './client-ip.js';

const deviceName = z.string().trim().min(1).max(80).optional();

const codeBody = z.object({ phone: z.string().max(30) });
const verifyBody = z.object({
  phone: z.string().max(30),
  code: z.string().trim().max(10),
  deviceName,
});
const registerBody = z.object({
  registrationToken: z.string().min(10).max(2000),
  fullName: fullNameSchema,
  email: emailSchema.optional(),
  deviceName,
  /** Aceptó los términos y la política de privacidad (casilla sin marcar de antemano). */
  acceptTerms: z.literal(true, {
    error: 'Acepta los términos y la política de privacidad para crear tu cuenta.',
  }),
});
const refreshBody = z.object({ refreshToken: z.string().min(20).max(200) });

/**
 * Tope por IP para pedir códigos: frena el envío masivo de SMS a números ajenos
 * (cada SMS cuesta). En memoria mientras haya una sola instancia.
 */
export const CODE_LIMITER = Symbol('CODE_LIMITER');
export const CODES_PER_IP_PER_HOUR = 10;

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CODE_LIMITER) private readonly codesPerIp: RateLimiter,
  ) {}

  @Public()
  @Post('code')
  @HttpCode(HttpStatus.OK)
  requestCode(@Body(new ZodPipe(codeBody)) body: z.infer<typeof codeBody>, @Req() req: Request) {
    const limit = this.codesPerIp.hit(rateLimitKey(req.ip ?? 'sin-ip'));
    if (!limit.allowed) {
      throw apiError(
        HttpStatus.TOO_MANY_REQUESTS,
        'too_many_requests',
        'Demasiados pedidos desde esta conexión. Intenta más tarde.',
        { retryAfterSeconds: limit.retryAfter },
      );
    }
    return this.auth.requestCode(body.phone);
  }

  @Public()
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  verify(@Body(new ZodPipe(verifyBody)) body: z.infer<typeof verifyBody>) {
    return this.auth.verifyCode(body.phone, body.code, body.deviceName);
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.OK)
  register(@Body(new ZodPipe(registerBody)) body: z.infer<typeof registerBody>) {
    return this.auth.register(body);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body(new ZodPipe(refreshBody)) body: z.infer<typeof refreshBody>) {
    return this.auth.refresh(body.refreshToken);
  }

  /** Cierra la sesión con el refresh token, aunque el token de acceso ya haya vencido. */
  @Public()
  @Post('revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@Body(new ZodPipe(refreshBody)) body: z.infer<typeof refreshBody>): Promise<void> {
    await this.auth.revoke(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentAuth() auth: AuthContext): Promise<void> {
    await this.auth.logout(auth.sessionId);
  }
}
