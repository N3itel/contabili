import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { RateLimiter } from '../common/http.js';
import type { Env } from '../config/env.js';
import { CODES_PER_IP_PER_HOUR, CODE_LIMITER, AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import {
  ConsoleSmsSender,
  MemorySmsSender,
  SMS_SENDER,
  type SmsSender,
  TwilioSmsSender,
} from './sms.js';
import { TokenService } from './tokens.js';

@Module({
  controllers: [AuthController],
  providers: [
    TokenService,
    AuthService,
    { provide: APP_GUARD, useClass: AuthGuard },
    {
      provide: CODE_LIMITER,
      useFactory: () => new RateLimiter(CODES_PER_IP_PER_HOUR, 3600_000),
    },
    {
      provide: SMS_SENDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): SmsSender => {
        switch (config.get('SMS_PROVIDER', { infer: true })) {
          case 'twilio':
            return new TwilioSmsSender({
              accountSid: config.get('TWILIO_ACCOUNT_SID', { infer: true }) ?? '',
              authToken: config.get('TWILIO_AUTH_TOKEN', { infer: true }) ?? '',
              from: config.get('TWILIO_FROM', { infer: true }) ?? '',
            });
          case 'memory':
            return new MemorySmsSender();
          default:
            return new ConsoleSmsSender();
        }
      },
    },
  ],
  exports: [TokenService, AuthService, SMS_SENDER],
})
export class AuthModule {}
