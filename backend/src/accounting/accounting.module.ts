import { Module } from '@nestjs/common';
import { CompaniesModule } from '../companies/companies.module.js';
import { AccountingController } from './accounting.controller.js';
import { AccountsService } from './accounts.service.js';
import { JournalService } from './journal.service.js';
import { ReportsService } from './reports.service.js';

@Module({
  imports: [CompaniesModule],
  controllers: [AccountingController],
  providers: [AccountsService, JournalService, ReportsService],
  exports: [JournalService],
})
export class AccountingModule {}
