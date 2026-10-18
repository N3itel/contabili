import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { isValidDate, limaDate } from '../accounting/lima.js';
import { ExportsService } from '../accounting/exports.service.js';
import { type AuthContext, CurrentAuth } from '../auth/auth.guard.js';
import { uuidParam, ZodPipe } from '../common/http.js';
import type { CreditReason } from './einvoice-rules.js';
import { EinvoicingService } from './einvoicing.service.js';

const period = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Usa el formato AAAA-MM')
  .refine((p) => isValidDate(`${p}-01`));

const settingsBody = z.object({
  provider: z.enum(['test', 'nubefact']),
  facturaSeries: z.string().trim().length(4),
  boletaSeries: z.string().trim().length(4),
  facturaNoteSeries: z.string().trim().length(4).optional(),
  boletaNoteSeries: z.string().trim().length(4).optional(),
  endpoint: z.string().trim().max(300).optional(),
  token: z.string().trim().min(10).max(300).optional(),
});

const emitBody = z.object({
  type: z.enum(['01', '03']),
  saleKind: z.enum(['goods', 'services']),
  paidWith: z.enum(['cash', 'bank', 'credit']),
  contactId: z.uuid().optional(),
  customer: z.object({
    docType: z.enum(['ruc', 'dni', 'none']),
    number: z
      .string()
      .trim()
      .regex(/^\d{8}(\d{3})?$/, 'DNI de 8 dígitos o RUC de 11')
      .optional(),
    name: z.string().trim().max(120).optional(),
  }),
  description: z.string().max(250),
  total: z.number().int().min(1).max(10_000_000_000),
});

/** Facturación electrónica (beta): configuración, emisión y comprobantes emitidos. */
@Controller('companies/:companyId')
export class EinvoicingController {
  constructor(
    @Inject(EinvoicingService) private readonly einvoicing: EinvoicingService,
    @Inject(ExportsService) private readonly exports: ExportsService,
  ) {}

  @Get('einvoicing')
  settings(@CurrentAuth() auth: AuthContext, @Param('companyId', uuidParam()) companyId: string) {
    return this.einvoicing.settings(companyId, auth.userId);
  }

  @Put('einvoicing')
  updateSettings(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Body(new ZodPipe(settingsBody)) body: z.infer<typeof settingsBody>,
  ) {
    return this.einvoicing.updateSettings(companyId, auth.userId, body);
  }

  @Get('einvoices')
  list(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Query(new ZodPipe(z.object({ period: period.optional() }))) query: { period?: string },
  ) {
    return this.einvoicing.list(
      companyId,
      auth.userId,
      query.period ?? limaDate(new Date()).slice(0, 7),
    );
  }

  @Post('einvoices')
  emit(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Body(new ZodPipe(emitBody)) body: z.infer<typeof emitBody>,
  ) {
    return this.einvoicing.emit(companyId, auth.userId, body);
  }

  @Post('einvoices/:id/refresh')
  @HttpCode(HttpStatus.OK)
  refresh(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Param('id', uuidParam()) id: string,
  ) {
    return this.einvoicing.refresh(companyId, auth.userId, id);
  }

  /** Anula la boleta o factura con una nota de crédito por el total. */
  @Post('einvoices/:id/credit-note')
  creditNote(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Param('id', uuidParam()) id: string,
    @Body(new ZodPipe(z.object({ reason: z.enum(['01', '02', '06']) })))
    body: { reason: CreditReason },
  ) {
    return this.einvoicing.creditNote(companyId, auth.userId, id, body.reason);
  }

  @Post('einvoices/:id/record')
  @HttpCode(HttpStatus.OK)
  record(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Param('id', uuidParam()) id: string,
  ) {
    return this.einvoicing.record(companyId, auth.userId, id);
  }

  /** Dónde ver el PDF: el del proveedor o, en modo de prueba, el nuestro (enlace de 5 min). */
  @Post('einvoices/:id/link')
  @HttpCode(HttpStatus.OK)
  async link(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Param('id', uuidParam()) id: string,
  ) {
    const row = await this.einvoicing.get(companyId, auth.userId, id);
    return { url: row.pdfUrl ?? (await this.exports.einvoiceLink(companyId, auth.userId, row.id)) };
  }
}
