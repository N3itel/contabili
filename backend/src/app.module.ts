import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AccountingModule } from './accounting/accounting.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BillingModule } from './billing/billing.module.js';
import { SafeExceptionFilter } from './common/exception.filter.js';
import { CompaniesModule } from './companies/companies.module.js';
import { validateEnv } from './config/env.js';
import { DbModule } from './db/db.module.js';
import { EinvoicingModule } from './einvoicing/einvoicing.module.js';
import { HealthController } from './health/health.controller.js';
import { UsersModule } from './users/users.module.js';
import { WebModule } from './web/web.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    DbModule,
    AuthModule,
    UsersModule,
    CompaniesModule,
    AccountingModule,
    BillingModule,
    EinvoicingModule,
    WebModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: SafeExceptionFilter }],
})
export class AppModule {}
