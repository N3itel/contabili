import { Module } from '@nestjs/common';
import { CompaniesService } from './companies.service.js';
import { JournalService } from './journal.service.js';

@Module({
  providers: [CompaniesService, JournalService],
  exports: [CompaniesService, JournalService],
})
export class AccountingModule {}
