import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AccountingModule } from './accounting/accounting.module.js';
import { SafeExceptionFilter } from './common/exception.filter.js';
import { validateEnv } from './config/env.js';
import { DbModule } from './db/db.module.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    DbModule,
    AccountingModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: SafeExceptionFilter }],
})
export class AppModule {}
