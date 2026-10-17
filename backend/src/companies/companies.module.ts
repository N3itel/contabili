import { Module } from '@nestjs/common';
import { CompaniesController } from './companies.controller.js';
import { CompaniesService } from './companies.service.js';
import { CompanyAccess } from './company-access.js';
import { InvitationsController, MembersController } from './members.controller.js';
import { MembersService } from './members.service.js';

@Module({
  controllers: [CompaniesController, MembersController, InvitationsController],
  providers: [CompaniesService, CompanyAccess, MembersService],
  exports: [CompaniesService, CompanyAccess],
})
export class CompaniesModule {}
