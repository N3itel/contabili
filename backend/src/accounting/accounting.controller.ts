import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { type AuthContext, CurrentAuth } from '../auth/auth.guard.js';
import { apiError, uuidParam, ZodPipe } from '../common/http.js';
import { AccountsService } from './accounts.service.js';
import { MAX_LINES_PER_ENTRY } from './journal-rules.js';
import { JournalService } from './journal.service.js';
import { isValidDate, limaDate, periodRange } from './lima.js';
import { OperationsService } from './operations.service.js';
import { PeriodsService } from './periods.service.js';
import { RegistersService } from './registers.service.js';
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
    .array(z.object({ accountCode, debit: amount, credit: amount, contactId: z.uuid().optional() }))
    .min(2)
    .max(MAX_LINES_PER_ENTRY),
});

const reverseBody = z.object({ entryDate: date.optional(), description: description.optional() });

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Usa el formato AAAA-MM');
const closeBody = z.object({ period });
const reopenBody = z.object({ period, reason: z.string().trim().min(10).max(300) });

const total = z.number().int().min(1).max(10_000_000_000_000);
const money = z.enum(['cash', 'bank']);
const settlement = z.enum(['cash', 'bank', 'credit']);
const operationBody = z.object({
  operation: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('sale'),
      total,
      kind: z.enum(['goods', 'services']),
      paidWith: settlement,
    }),
    z.object({
      type: z.literal('expense'),
      total,
      category: z.enum(['goods', 'services', 'payroll', 'taxes', 'financial', 'other']),
      paidWith: settlement,
      withInvoice: z.boolean(),
    }),
    z.object({ type: z.literal('collection'), total, into: money }),
    z.object({ type: z.literal('payment'), total, from: money }),
    z.object({
      type: z.literal('tax_payment'),
      total,
      tax: z.enum(['igv', 'income']),
      from: money,
    }),
  ]),
  date: date.optional(),
  reference: z.string().trim().min(1).max(40).optional(),
  document: z
    .object({
      type: z.enum(['01', '02', '03', '12', '00']),
      series: z.string().trim().min(1).max(24),
      number: z.number().int(),
      counterpartyRuc: z
        .string()
        .regex(/^\d{11}$/, 'El RUC tiene 11 dígitos')
        .optional(),
      counterpartyName: z.string().trim().min(2).max(120).optional(),
    })
    .optional(),
  moneyAccountCode: accountCode.optional(),
  contactId: z.uuid().optional(),
});

const summaryQuery = z.object({ period: period.optional() });
const trendQuery = z.object({ months: z.coerce.number().int().min(1).max(24).default(6) });

const journalQuery = z.object({
  period,
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
    @Inject(PeriodsService) private readonly periods: PeriodsService,
    @Inject(OperationsService) private readonly operations: OperationsService,
    @Inject(RegistersService) private readonly registers: RegistersService,
  ) {}

  /** Registro de ventas o de compras del mes, con los comprobantes. */
  @Get('registers/:kind')
  register(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Param('kind', new ZodPipe(z.enum(['sales', 'purchases']))) kind: 'sales' | 'purchases',
    @Query(new ZodPipe(summaryQuery)) query: z.infer<typeof summaryQuery>,
  ) {
    const { from, to } = periodRange(query.period ?? limaDate(new Date()).slice(0, 7));
    return this.registers.register(
      companyId,
      auth.userId,
      kind === 'sales' ? 'sale' : 'purchase',
      from,
      to,
    );
  }

  /** «Vendí», «gasté», «cobré», «pagué»: el asiento se arma solo. */
  @Post('operations')
  recordOperation(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Body(new ZodPipe(operationBody)) body: z.infer<typeof operationBody>,
  ) {
    return this.operations.record(companyId, auth.userId, body);
  }

  /** Lo que toca pagar a SUNAT en el mes (estimado). */
  @Get('taxes')
  taxes(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Query(new ZodPipe(summaryQuery)) query: z.infer<typeof summaryQuery>,
  ) {
    return this.reports.taxes(
      companyId,
      auth.userId,
      query.period ?? limaDate(new Date()).slice(0, 7),
    );
  }

  /** Ventas y gastos de los últimos meses, para el gráfico de Inicio. */
  @Get('trend')
  trend(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Query(new ZodPipe(trendQuery)) query: z.infer<typeof trendQuery>,
  ) {
    return this.reports.trend(
      companyId,
      auth.userId,
      limaDate(new Date()).slice(0, 7),
      query.months,
    );
  }

  /** Cómo va el negocio este mes, sin términos contables. */
  @Get('summary')
  summary(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Query(new ZodPipe(summaryQuery)) query: z.infer<typeof summaryQuery>,
  ) {
    const today = limaDate(new Date());
    return this.reports.summary(companyId, auth.userId, query.period ?? today.slice(0, 7), today);
  }

  @Get('periods')
  getPeriods(@CurrentAuth() auth: AuthContext, @Param('companyId', uuidParam()) companyId: string) {
    return this.periods.get(companyId, auth.userId);
  }

  @Post('periods/close')
  @HttpCode(HttpStatus.OK)
  closePeriod(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Body(new ZodPipe(closeBody)) body: z.infer<typeof closeBody>,
  ) {
    return this.periods.close(companyId, auth.userId, body.period);
  }

  @Post('periods/reopen')
  @HttpCode(HttpStatus.OK)
  reopenPeriod(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Body(new ZodPipe(reopenBody)) body: z.infer<typeof reopenBody>,
  ) {
    return this.periods.reopen(companyId, auth.userId, body.period, body.reason);
  }

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
