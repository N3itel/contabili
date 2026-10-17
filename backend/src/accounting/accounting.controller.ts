import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { type AuthContext, CurrentAuth } from '../auth/auth.guard.js';
import { apiError, uuidParam, ZodPipe } from '../common/http.js';
import { AccountsService } from './accounts.service.js';
import { MAX_LINES_PER_ENTRY } from './journal-rules.js';
import { JournalService } from './journal.service.js';
import { isValidDate, limaDate } from './lima.js';
import { ReportsService } from './reports.service.js';

const date = z.string().refine(isValidDate, 'Usa el formato AAAA-MM-DD');
const accountCode = z.string().regex(/^[1-9]\d{1,7}$/, 'Código de 2 a 8 dígitos');
/** Hasta S/ 100 000 millones por línea: de sobra, y lejos del límite de los enteros seguros. */
const amount = z.number().int().min(0).max(10_000_000_000_000);
const description = z.string().trim().min(3).max(300);

const accountBody = z.object({
  code: accountCode,
  name: z.string().trim().min(3).max(200),
  nature: z.enum(['debit', 'credit']).optional(),
});

const entryBody = z.object({
  entryDate: date,
  description,
  lines: z
    .array(z.object({ accountCode, debit: amount, credit: amount }))
    .min(2)
    .max(MAX_LINES_PER_ENTRY),
});

const reverseBody = z.object({ entryDate: date.optional(), description: description.optional() });

const journalQuery = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Usa el formato AAAA-MM'),
  after: z.coerce.number().int().min(0).optional(),
});

/** Rango de fechas: por defecto, desde el 1 de enero hasta hoy (Lima). */
const rangeQuery = z.object({ from: date.optional(), to: date.optional() });

function resolveRange(query: z.infer<typeof rangeQuery>): { from: string; to: string } {
  const to = query.to ?? limaDate(new Date());
  const from = query.from ?? `${to.slice(0, 4)}-01-01`;
  if (from > to) {
    throw apiError(400, 'invalid_range', 'La fecha inicial es posterior a la final.');
  }
  return { from, to };
}

@Controller('companies/:companyId')
export class AccountingController {
  constructor(
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(JournalService) private readonly journal: JournalService,
    @Inject(ReportsService) private readonly reports: ReportsService,
  ) {}

  @Get('accounts')
  listAccounts(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
  ) {
    return this.accounts.list(companyId, auth.userId);
  }

  @Post('accounts')
  createAccount(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Body(new ZodPipe(accountBody)) body: z.infer<typeof accountBody>,
  ) {
    return this.accounts.create(companyId, auth.userId, body);
  }

  @Post('journal')
  post(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Body(new ZodPipe(entryBody)) body: z.infer<typeof entryBody>,
  ) {
    return this.journal.post(companyId, auth.userId, body);
  }

  @Get('journal')
  list(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Query(new ZodPipe(journalQuery)) query: z.infer<typeof journalQuery>,
  ) {
    return this.journal.list(companyId, auth.userId, query.period, query.after);
  }

  @Get('journal/:entryId')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Param('entryId', uuidParam()) entryId: string,
  ) {
    return this.journal.get(companyId, auth.userId, entryId);
  }

  @Post('journal/:entryId/reverse')
  reverse(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Param('entryId', uuidParam()) entryId: string,
    @Body(new ZodPipe(reverseBody)) body: z.infer<typeof reverseBody>,
  ) {
    return this.journal.reverse(companyId, auth.userId, entryId, body);
  }

  @Get('ledger/:accountCode')
  ledger(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Param('accountCode', new ZodPipe(accountCode)) code: string,
    @Query(new ZodPipe(rangeQuery)) query: z.infer<typeof rangeQuery>,
  ) {
    const { from, to } = resolveRange(query);
    return this.reports.ledger(companyId, auth.userId, code, from, to);
  }

  @Get('trial-balance')
  trialBalance(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Query(new ZodPipe(rangeQuery)) query: z.infer<typeof rangeQuery>,
  ) {
    const { from, to } = resolveRange(query);
    return this.reports.trialBalance(companyId, auth.userId, from, to);
  }
}
