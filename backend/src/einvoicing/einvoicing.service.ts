import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, max, sql } from 'drizzle-orm';
import { limaDate, periodRange } from '../accounting/lima.js';
import { OperationsService } from '../accounting/operations.service.js';
import { deriveKey } from '../auth/tokens.js';
import { audit } from '../common/audit.js';
import { FieldCipher } from '../common/field-cipher.js';
import { apiError } from '../common/http.js';
import { CompanyAccess } from '../companies/company-access.js';
import type { Env } from '../config/env.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { companies, einvoices, einvoiceSettings } from '../db/schema/index.js';
import {
  type CustomerDocType,
  EINVOICE_PROBLEM_MESSAGES,
  einvoiceAmounts,
  einvoiceNumberLabel,
  einvoiceProblem,
  EINVOICE_TYPES,
  type EinvoiceType,
  isValidEinvoiceSeries,
} from './einvoice-rules.js';
import {
  type Credentials,
  type EinvoiceDraft,
  type EinvoiceProvider,
  type EmitResult,
  isAllowedEndpoint,
  type ProviderCode,
} from './providers.js';

export const EINVOICE_PROVIDERS = Symbol('EINVOICE_PROVIDERS');

type Row = typeof einvoices.$inferSelect;

export interface SettingsInput {
  provider: ProviderCode;
  facturaSeries: string;
  boletaSeries: string;
  endpoint?: string;
  token?: string;
}

export interface EmitInput {
  type: EinvoiceType;
  saleKind: 'goods' | 'services';
  paidWith: 'cash' | 'bank' | 'credit';
  contactId?: string;
  customer: { docType: CustomerDocType; number?: string; name?: string };
  description: string;
  total: number;
}

export interface EinvoiceDto {
  id: string;
  type: EinvoiceType;
  typeLabel: string;
  series: string;
  number: number;
  label: string;
  issueDate: string;
  provider: ProviderCode;
  status: Row['status'];
  statusMessage: string | null;
  customer: { docType: CustomerDocType; number: string | null; name: string | null };
  description: string;
  base: number;
  igv: number;
  total: number;
  /** Ya se anotó la venta en los libros. */
  recorded: boolean;
}

const toDto = (r: Row): EinvoiceDto => ({
  id: r.id,
  type: r.docType as EinvoiceType,
  typeLabel: EINVOICE_TYPES[r.docType as EinvoiceType],
  series: r.series,
  number: r.number,
  label: einvoiceNumberLabel(r.series, r.number),
  issueDate: r.issueDate,
  provider: r.provider as ProviderCode,
  status: r.status,
  statusMessage: r.statusMessage,
  customer: {
    docType: r.customerDocType as CustomerDocType,
    number: r.customerDocNumber,
    name: r.customerName,
  },
  description: r.description,
  base: r.baseCents,
  igv: r.igvCents,
  total: r.totalCents,
  recorded: r.entryId !== null,
});

const notFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'einvoice_not_found', 'No encontramos ese comprobante.');

/**
 * Facturación electrónica (beta). Emitir es: reservar el número correlativo
 * (bloqueando la configuración de la empresa), mandar el comprobante al
 * proveedor y, si salió, anotar la venta con su comprobante. Si el proveedor
 * no lo creó, el número se libera; si no se sabe, queda pendiente y se
 * vuelve a consultar, para nunca repetir un número.
 */
@Injectable()
export class EinvoicingService {
  private readonly cipher: FieldCipher;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(CompanyAccess) private readonly access: CompanyAccess,
    @Inject(OperationsService) private readonly operations: OperationsService,
    @Inject(EINVOICE_PROVIDERS) private readonly providers: Record<ProviderCode, EinvoiceProvider>,
    @Inject(ConfigService) config: ConfigService<Env, true>,
  ) {
    this.cipher = new FieldCipher(
      deriveKey(config.get('AUTH_JWT_SECRET', { infer: true }), 'field-cipher'),
    );
  }

  async settings(companyId: string, actorId: string) {
    await this.access.require(companyId, actorId, 'viewer');
    const [row] = await this.db
      .select()
      .from(einvoiceSettings)
      .where(eq(einvoiceSettings.companyId, companyId));
    if (!row) return { enabled: false as const };
    return {
      enabled: true as const,
      provider: row.provider as ProviderCode,
      facturaSeries: row.facturaSeries,
      boletaSeries: row.boletaSeries,
      // Solo el dominio: la ruta completa y el token no vuelven a la app.
      endpointHost: row.endpoint ? new URL(row.endpoint).hostname : null,
      hasToken: row.tokenEncrypted !== null,
    };
  }

  async updateSettings(companyId: string, actorId: string, input: SettingsInput) {
    await this.access.require(companyId, actorId, 'owner');
    const [company] = await this.db
      .select({ taxRegime: companies.taxRegime })
      .from(companies)
      .where(eq(companies.id, companyId));
    if (company.taxRegime === 'nrus') {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'einvoice_nrus',
        EINVOICE_PROBLEM_MESSAGES.einvoice_nrus,
      );
    }
    const facturaSeries = input.facturaSeries.toUpperCase();
    const boletaSeries = input.boletaSeries.toUpperCase();
    if (!isValidEinvoiceSeries('01', facturaSeries) || !isValidEinvoiceSeries('03', boletaSeries)) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'invalid_einvoice_series',
        'Las series electrónicas son F y 3 letras o números para facturas (F001) y B para boletas (B001).',
      );
    }
    const [current] = await this.db
      .select()
      .from(einvoiceSettings)
      .where(eq(einvoiceSettings.companyId, companyId));
    let endpoint: string | null = null;
    let tokenEncrypted: string | null = null;
    if (input.provider === 'nubefact') {
      endpoint = input.endpoint?.trim() || current?.endpoint || null;
      if (!endpoint || !isAllowedEndpoint(endpoint)) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'invalid_endpoint',
          'Pega la RUTA que te dio Nubefact (empieza con https://api.nubefact.com/).',
        );
      }
      tokenEncrypted = input.token?.trim()
        ? this.cipher.encrypt(input.token.trim())
        : (current?.tokenEncrypted ?? null);
      if (!tokenEncrypted) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'token_required',
          'Pega el TOKEN que te dio Nubefact.',
        );
      }
    }
    const values = {
      provider: input.provider,
      facturaSeries,
      boletaSeries,
      endpoint,
      tokenEncrypted,
      updatedBy: actorId,
    };
    await this.db.transaction(async (tx) => {
      await tx
        .insert(einvoiceSettings)
        .values({ companyId, ...values })
        .onConflictDoUpdate({ target: einvoiceSettings.companyId, set: values });
      // Sin el token en el registro.
      await audit(tx, {
        actorId,
        action: 'einvoice.settings_updated',
        entity: 'company',
        entityId: companyId,
        data: { provider: input.provider, facturaSeries, boletaSeries },
      });
    });
    return this.settings(companyId, actorId);
  }

  async list(companyId: string, actorId: string, period: string): Promise<EinvoiceDto[]> {
    await this.access.require(companyId, actorId, 'viewer');
    const { from, to } = periodRange(period);
    const rows = await this.db
      .select()
      .from(einvoices)
      .where(
        and(
          eq(einvoices.companyId, companyId),
          sql`${einvoices.issueDate} BETWEEN ${from} AND ${to}`,
        ),
      )
      .orderBy(desc(einvoices.createdAt))
      .limit(1000);
    return rows.map(toDto);
  }

  async get(companyId: string, actorId: string, id: string): Promise<Row> {
    await this.access.require(companyId, actorId, 'viewer');
    const [row] = await this.db
      .select()
      .from(einvoices)
      .where(and(eq(einvoices.id, id), eq(einvoices.companyId, companyId)));
    if (!row) throw notFound();
    return row;
  }

  /** Emite la boleta o factura y, si salió, anota la venta. */
  async emit(
    companyId: string,
    actorId: string,
    input: EmitInput,
  ): Promise<{ einvoice: EinvoiceDto; recordError: string | null }> {
    await this.access.requireWritable(companyId, actorId, 'accountant');
    const [company] = await this.db
      .select({ taxRegime: companies.taxRegime, closedThrough: companies.closedThrough })
      .from(companies)
      .where(eq(companies.id, companyId));
    const customer = {
      docType: input.customer.docType,
      number: input.customer.docType === 'none' ? undefined : input.customer.number?.trim(),
      name: input.customer.docType === 'none' ? undefined : input.customer.name?.trim(),
    };
    const problem = einvoiceProblem({ ...input, customer }, company.taxRegime);
    if (problem)
      throw apiError(HttpStatus.BAD_REQUEST, problem, EINVOICE_PROBLEM_MESSAGES[problem]);
    // Lo que impediría anotar la venta se revisa antes de emitir.
    if (input.contactId && input.paidWith !== 'credit') {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'contact_not_needed',
        'Al contado no hace falta elegir cliente: va en el comprobante.',
      );
    }
    const issueDate = limaDate(new Date());
    if (company.closedThrough && issueDate <= company.closedThrough) {
      throw apiError(
        HttpStatus.CONFLICT,
        'period_closed',
        'Los libros de este mes están cerrados: pide al dueño que lo reabra para emitir.',
      );
    }

    const amounts = einvoiceAmounts(input.total);
    const reserved = await this.db.transaction(async (tx) => {
      const [settings] = await tx
        .select()
        .from(einvoiceSettings)
        .where(eq(einvoiceSettings.companyId, companyId))
        .for('update');
      if (!settings) {
        throw apiError(
          HttpStatus.CONFLICT,
          'einvoice_not_configured',
          'Primero configura la facturación electrónica en Más → Facturación electrónica.',
        );
      }
      const series = input.type === '01' ? settings.facturaSeries : settings.boletaSeries;
      const [last] = await tx
        .select({ number: max(einvoices.number) })
        .from(einvoices)
        .where(
          and(
            eq(einvoices.companyId, companyId),
            eq(einvoices.docType, input.type),
            eq(einvoices.series, series),
          ),
        );
      const [row] = await tx
        .insert(einvoices)
        .values({
          companyId,
          docType: input.type,
          series,
          number: (last?.number ?? 0) + 1,
          issueDate,
          provider: settings.provider,
          saleKind: input.saleKind,
          paidWith: input.paidWith,
          contactId: input.contactId ?? null,
          customerDocType: customer.docType,
          customerDocNumber: customer.number ?? null,
          customerName: customer.name ?? null,
          description: input.description.trim(),
          baseCents: amounts.base,
          igvCents: amounts.igv,
          totalCents: amounts.total,
          status: 'pending',
          createdBy: actorId,
        })
        .returning();
      return { row, credentials: this.credentials(settings) };
    });

    const result = await this.providers[reserved.row.provider as ProviderCode].emit(
      this.draft(reserved.row),
      reserved.credentials,
    );
    if (result.status === 'error') {
      // El proveedor no lo creó: el número queda libre para el siguiente.
      await this.db.delete(einvoices).where(eq(einvoices.id, reserved.row.id));
      throw apiError(HttpStatus.BAD_REQUEST, 'einvoice_provider_error', result.message);
    }
    const row = await this.applyResult(reserved.row, result);
    await audit(this.db, {
      actorId,
      action: 'einvoice.emitted',
      entity: 'einvoice',
      entityId: row.id,
      data: { label: einvoiceNumberLabel(row.series, row.number), status: row.status },
    });
    return this.recordIfReady(companyId, actorId, row);
  }

  /** Vuelve a preguntar al proveedor por un comprobante pendiente. */
  async refresh(companyId: string, actorId: string, id: string) {
    await this.access.requireWritable(companyId, actorId, 'accountant');
    const row = await this.get(companyId, actorId, id);
    if (row.status !== 'pending') return this.recordIfReady(companyId, actorId, row);
    const [settings] = await this.db
      .select()
      .from(einvoiceSettings)
      .where(eq(einvoiceSettings.companyId, companyId));
    const result = await this.providers[row.provider as ProviderCode].check(
      this.draft(row),
      settings ? this.credentials(settings) : null,
    );
    // Un error al consultar no cambia nada: sigue pendiente.
    const updated = result.status === 'error' ? row : await this.applyResult(row, result);
    return this.recordIfReady(companyId, actorId, updated);
  }

  /** Anota la venta de un comprobante que salió y todavía no está en los libros. */
  async record(companyId: string, actorId: string, id: string) {
    await this.access.requireWritable(companyId, actorId, 'accountant');
    return this.recordIfReady(companyId, actorId, await this.get(companyId, actorId, id));
  }

  // ─── Interno ─────────────────────────────────────────────────────────────

  private credentials(settings: typeof einvoiceSettings.$inferSelect): Credentials | null {
    return settings.provider === 'nubefact' && settings.endpoint && settings.tokenEncrypted
      ? { endpoint: settings.endpoint, token: this.cipher.decrypt(settings.tokenEncrypted) }
      : null;
  }

  private draft(row: Row): EinvoiceDraft {
    return {
      type: row.docType as EinvoiceType,
      series: row.series,
      number: row.number,
      issueDate: row.issueDate,
      customer: {
        docType: row.customerDocType as CustomerDocType,
        number: row.customerDocNumber ?? undefined,
        name: row.customerName ?? undefined,
      },
      description: row.description,
      kind: row.saleKind as 'goods' | 'services',
      base: row.baseCents,
      igv: row.igvCents,
      total: row.totalCents,
    };
  }

  private async applyResult(row: Row, result: EmitResult): Promise<Row> {
    const [updated] = await this.db
      .update(einvoices)
      .set({
        status: result.status as Row['status'],
        statusMessage: result.message.slice(0, 500),
        pdfUrl: result.pdfUrl ?? row.pdfUrl,
        xmlUrl: result.xmlUrl ?? row.xmlUrl,
        cdrUrl: result.cdrUrl ?? row.cdrUrl,
        hash: result.hash ?? row.hash,
      })
      .where(eq(einvoices.id, row.id))
      .returning();
    return updated;
  }

  private async recordIfReady(
    companyId: string,
    actorId: string,
    row: Row,
  ): Promise<{ einvoice: EinvoiceDto; recordError: string | null }> {
    if (row.entryId || (row.status !== 'accepted' && row.status !== 'test')) {
      return { einvoice: toDto(row), recordError: null };
    }
    try {
      const { entry } = await this.operations.record(companyId, actorId, {
        operation: {
          type: 'sale',
          total: row.totalCents,
          kind: row.saleKind as 'goods' | 'services',
          paidWith: row.paidWith as 'cash' | 'bank' | 'credit',
        },
        date: row.issueDate,
        contactId: row.contactId ?? undefined,
        document: {
          type: row.docType as EinvoiceType,
          series: row.series,
          number: row.number,
          counterpartyRuc:
            row.customerDocType === 'ruc' ? (row.customerDocNumber ?? undefined) : undefined,
          counterpartyName: row.customerName ?? undefined,
        },
      });
      const [updated] = await this.db
        .update(einvoices)
        .set({ entryId: entry.id })
        .where(eq(einvoices.id, row.id))
        .returning();
      return { einvoice: toDto(updated), recordError: null };
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      const body = error.getResponse() as { message?: string };
      return {
        einvoice: toDto(row),
        recordError: `El comprobante salió, pero no se pudo anotar la venta: ${body.message ?? 'inténtalo de nuevo'}`,
      };
    }
  }
}
