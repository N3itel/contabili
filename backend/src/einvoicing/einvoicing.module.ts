import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module.js';
import { CompaniesModule } from '../companies/companies.module.js';
import { EinvoicingController } from './einvoicing.controller.js';
import { EINVOICE_PROVIDERS, EinvoicingService } from './einvoicing.service.js';
import {
  type EinvoiceProvider,
  NubefactProvider,
  type ProviderCode,
  TestProvider,
} from './providers.js';

/** Facturación electrónica (beta): Nubefact o modo de prueba, a elección de cada empresa. */
@Module({
  imports: [CompaniesModule, AccountingModule],
  controllers: [EinvoicingController],
  providers: [
    EinvoicingService,
    {
      provide: EINVOICE_PROVIDERS,
      useFactory: (): Record<ProviderCode, EinvoiceProvider> => ({
        test: new TestProvider(),
        nubefact: new NubefactProvider(),
      }),
    },
  ],
})
export class EinvoicingModule {}
