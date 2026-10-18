import { Inject, Logger, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module.js';
import { CompaniesModule } from '../companies/companies.module.js';
import type { Env } from '../config/env.js';
import {
  BillingController,
  CheckoutPageController,
  PaymentsController,
} from './billing.controller.js';
import { BillingService } from './billing.service.js';
import {
  CulqiPaymentProvider,
  FakePaymentProvider,
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from './payments.js';
import { RemindersService } from './reminders.service.js';

/** Cada cuánto se vencen las órdenes sin pagar. */
export const ORDER_SWEEP_MS = 60_000;

class OrderSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Licencias');
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;
    this.timer = setInterval(() => {
      this.billing.sweep().catch((error: Error) => {
        this.logger.warn(`Falló el vencimiento de órdenes (${error.name})`);
      });
    }, ORDER_SWEEP_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }
}

/** Cada cuánto se revisan los avisos de vencimiento (salen de día, una vez). */
export const REMINDER_SWEEP_MS = 60 * 60_000;

class ReminderSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Avisos');
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(RemindersService) private readonly reminders: RemindersService,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;
    this.timer = setInterval(() => {
      this.reminders.sweep().catch((error: Error) => {
        this.logger.warn(`Fallaron los avisos de vencimiento (${error.name})`);
      });
    }, REMINDER_SWEEP_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }
}

/** Licencias por empresa: planes, órdenes de pago, avisos y la página de pago. */
@Module({
  imports: [CompaniesModule, AuthModule],
  controllers: [BillingController, PaymentsController, CheckoutPageController],
  providers: [
    BillingService,
    OrderSweeper,
    RemindersService,
    ReminderSweeper,
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): PaymentProvider =>
        config.get('PAYMENTS_PROVIDER', { infer: true }) === 'culqi'
          ? new CulqiPaymentProvider({
              publicKey: config.get('CULQI_PUBLIC_KEY', { infer: true }) ?? '',
              secretKey: config.get('CULQI_SECRET_KEY', { infer: true }) ?? '',
            })
          : new FakePaymentProvider(),
    },
  ],
  exports: [PAYMENT_PROVIDER],
})
export class BillingModule {}
