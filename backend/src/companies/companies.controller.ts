import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { type AuthContext, CurrentAuth } from '../auth/auth.guard.js';
import { uuidParam, ZodPipe } from '../common/http.js';
import { CompaniesService } from './companies.service.js';

const createBody = z.object({
  ruc: z
    .string()
    .trim()
    .regex(/^\d{11}$/, 'El RUC tiene 11 dígitos'),
  legalName: z.string().trim().min(3).max(200),
  taxRegime: z.enum(['nrus', 'rer', 'rmt', 'general']),
});

@Controller('companies')
export class CompaniesController {
  constructor(@Inject(CompaniesService) private readonly companies: CompaniesService) {}

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(createBody)) body: z.infer<typeof createBody>,
  ) {
    return this.companies.create(body, auth.userId);
  }

  @Get()
  list(@CurrentAuth() auth: AuthContext) {
    return this.companies.listFor(auth.userId);
  }

  @Get(':companyId')
  get(@CurrentAuth() auth: AuthContext, @Param('companyId', uuidParam()) companyId: string) {
    return this.companies.get(companyId, auth.userId);
  }
}
