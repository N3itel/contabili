import { Module } from '@nestjs/common';
import { CompaniesModule } from '../companies/companies.module.js';
import { AccountingController } from './accounting.controller.js';
import { AccountsService } from './accounts.service.js';
import { ContactsController } from './contacts.controller.js';
import { ContactsService } from './contacts.service.js';
import { JournalService } from './journal.service.js';
import { OperationsService } from './operations.service.js';
import { PeriodsService } from './periods.service.js';
import { ReportsService } from './reports.service.js';

@Module({
  imports: [CompaniesModule],
  controllers: [AccountingController, ContactsController],
  providers: [
    AccountsService,
    JournalService,
    ReportsService,
    PeriodsService,
    OperationsService,
    ContactsService,
  ],
  exports: [JournalService],
})
export class AccountingModule {}
