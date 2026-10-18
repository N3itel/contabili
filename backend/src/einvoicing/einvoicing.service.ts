import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, inArray, isNotNull, max, ne, sql } from 'drizzle-orm';
import { JournalService, type Tx } from '../accounting/journal.service.js';
import { limaDate, periodRange } from '../accounting/lima.js';
import { OperationsService } from '../accounting/operations.service.js';
import { deriveKey } from '../auth/tokens.js';
import { audit } from '../common/audit.js';
import { FieldCipher } from '../common/field-cipher.js';
import { apiError } from '../common/http.js';
import { uniqueViolation } from '../common/pg.js';
import { CompanyAccess } from '../companies/company-access.js';
import type { Env } from '../config/env.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import {
  companies,
  documents,
  einvoices,
  einvoiceSettings,
  journalEntries,
} from '../db/schema/index.js';
import {
  CREDIT_NOTE_PROBLEM_MESSAGES,
  CREDIT_REASONS,
  creditNoteProblem,
  type CreditReason,
  type CustomerDocType,
  EINVOICE_PROBLEM_MESSAGES,
  einvoiceAmounts,
  einvoiceNumberLabel,
  einvoiceProblem,
  type EinvoiceDocType,
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
  /** Series de las notas de crédito; si no vienen, quedan las de antes (FC01 y BC01). */
  facturaNoteSeries?: string;
  boletaNoteSeries?: string;
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
  type: EinvoiceDocType;
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
  /** Ya se anotó en los libros: la venta o, en una nota de crédito, su extorno. */
  recorded: boolean;
  /** Nota de crédito: la boleta o factura que anula y por qué. */
  modifies: { id: string; type: EinvoiceType; label: string } | null;
  creditReason: { code: CreditReason; label: string } | null;
  /** Boleta o factura: la nota de crédito que la anula (salió o está en trámite). */
  creditNote: { id: string; label: string; status: Row['status'] } | null;
}

const toDto = (r: Row, links: { modifies?: Row; creditNote?: Row } = {}): EinvoiceDto => ({
  id: r.id,
  type: r.docType as EinvoiceDocType,
  typeLabel: EINVOICE_TYPES[r.docType as EinvoiceDocType],
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
  modifies: links.modifies
    ? {
        id: links.modifies.id,
        type: links.modifies.docType as EinvoiceType,
        label: einvoiceNumberLabel(links.modifies.series, links.modifies.number),
      }
    : null,
  creditReason: r.creditReason
    ? {
        code: r.creditReason as CreditReason,
        label: CREDIT_REASONS[r.creditReason as CreditReason],
      }
    : null,
  creditNote: links.creditNote
    ? {
        id: links.creditNote.id,
        label: einvoiceNumberLabel(links.creditNote.series, links.creditNote.number),
        status: links.creditNote.status,
      }
    : null,
});

type EmitOutcome = { einvoice: EinvoiceDto; recordError: string | null };

const notFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'einvoice_not_found', 'No encontramos ese comprobante.');

const periodClosed = (what: string) =>
  apiError(
    HttpStatus.CONFLICT,
    'period_closed',
    `Los libros de este mes están cerrados: pide al dueño que lo reabra para ${what}.`,
  );

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
    @Inject(JournalService) private readonly journal: JournalService,
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
      facturaNoteSeries: row.facturaNoteSeries,
      boletaNoteSeries: row.boletaNoteSeries,
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
    const [current] = await this.db
      .select()
      .from(einvoiceSettings)
      .where(eq(einvoiceSettings.companyId, companyId));
    const facturaSeries = input.facturaSeries.toUpperCase();
    const boletaSeries = input.boletaSeries.toUpperCase();
    const facturaNoteSeries = (
      input.facturaNoteSeries ??
      current?.facturaNoteSeries ??
      'FC01'
    ).toUpperCase();
    const boletaNoteSeries = (
      input.boletaNoteSeries ??
      current?.boletaNoteSeries ??
      'BC01'
    ).toUpperCase();
    if (
      !isValidEinvoiceSeries('01', facturaSeries) ||
      !isValidEinvoiceSeries('03', boletaSeries) ||
      !isValidEinvoiceSeries('01', facturaNoteSeries) ||
      !isValidEinvoiceSeries('03', boletaNoteSeries)
    ) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'invalid_einvoice_series',
        'Las series electrónicas son F y 3 letras o números para facturas y sus notas (F001, FC01) y B para boletas y sus notas (B001, BC01).',
      );
    }
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
      facturaNoteSeries,
      boletaNoteSeries,
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
        data: {
          provider: input.provider,
          facturaSeries,
          boletaSeries,
          facturaNoteSeries,
          boletaNoteSeries,
        },
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
    return this.dtos(companyId, rows);
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
  async emit(companyId: string, actorId: string, input: EmitInput): Promise<EmitOutcome> {
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
    if (company.closedThrough && issueDate <= company.closedThrough) throw periodClosed('emitir');

    const amounts = einvoiceAmounts(input.total);
    const reserved = await this.db.transaction(async (tx) => {
      const settings = await this.lockSettings(tx, companyId);
      const series = input.type === '01' ? settings.facturaSeries : settings.boletaSeries;
      const [row] = await tx
        .insert(einvoices)
        .values({
          companyId,
          docType: input.type,
          series,
          number: await this.nextNumber(tx, companyId, input.type, series),
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

    const row = await this.send(reserved.row, reserved.credentials);
    await audit(this.db, {
      actorId,
      action: 'einvoice.emitted',
      entity: 'einvoice',
      entityId: row.id,
      data: { label: einvoiceNumberLabel(row.series, row.number), status: row.status },
    });
    return this.recordIfReady(companyId, actorId, row);
  }

  /**
   * Anula una boleta o factura con una nota de crédito por el total. Si la
   * nota sale (o es de prueba), se extorna la venta en la misma transacción
   * que guarda la nota como comprobante: el registro de ventas la resta.
   */
  async creditNote(
    companyId: string,
    actorId: string,
    id: string,
    reason: CreditReason,
  ): Promise<EmitOutcome> {
    await this.access.requireWritable(companyId, actorId, 'accountant');
    const found = await this.get(companyId, actorId, id);
    const [company] = await this.db
      .select({ closedThrough: companies.closedThrough })
      .from(companies)
      .where(eq(companies.id, companyId));
    const issueDate = limaDate(new Date());
    // Lo que impediría extornar la venta se revisa antes de mandar la nota.
    if (company.closedThrough && issueDate <= company.closedThrough) throw periodClosed('anular');
    const [existing] = await this.db
      .select({ id: einvoices.id })
      .from(einvoices)
      .where(and(eq(einvoices.modifiesId, id), ne(einvoices.status, 'rejected')));
    if (existing) {
      throw apiError(
        HttpStatus.CONFLICT,
        'credit_note_exists',
        CREDIT_NOTE_PROBLEM_MESSAGES.credit_note_exists,
      );
    }
    if (found.entryId) {
      const [reversal] = await this.db
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(eq(journalEntries.reversesEntryId, found.entryId));
      if (reversal) {
        throw apiError(
          HttpStatus.CONFLICT,
          'already_reversed',
          'La venta de ese comprobante ya se extornó en tus libros: pide ayuda a tu contador.',
        );
      }
    }

    let reserved: { row: Row; original: Row; credentials: Credentials | null };
    try {
      reserved = await this.db.transaction(async (tx) => {
        const settings = await this.lockSettings(tx, companyId);
        const [original] = await tx
          .select()
          .from(einvoices)
          .where(and(eq(einvoices.id, id), eq(einvoices.companyId, companyId)))
          .for('update');
        const [existing] = await tx
          .select({ id: einvoices.id })
          .from(einvoices)
          .where(and(eq(einvoices.modifiesId, id), ne(einvoices.status, 'rejected')));
        const problem = creditNoteProblem(
          {
            docType: original.docType as EinvoiceDocType,
            status: original.status,
            recorded: original.entryId !== null,
            hasNote: existing !== undefined,
          },
          reason,
        );
        if (problem) {
          throw apiError(
            problem === 'credit_note_exists' ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST,
            problem,
            CREDIT_NOTE_PROBLEM_MESSAGES[problem],
          );
        }
        const series =
          original.docType === '01' ? settings.facturaNoteSeries : settings.boletaNoteSeries;
        const [row] = await tx
          .insert(einvoices)
          .values({
            companyId,
            docType: '07',
            series,
            number: await this.nextNumber(tx, companyId, '07', series),
            issueDate,
            // Con el mismo proveedor que la boleta o factura: una de prueba se anula de prueba.
            provider: original.provider,
            saleKind: original.saleKind,
            paidWith: original.paidWith,
            contactId: original.contactId,
            customerDocType: original.customerDocType,
            customerDocNumber: original.customerDocNumber,
            customerName: original.customerName,
            description: original.description,
            baseCents: original.baseCents,
            igvCents: original.igvCents,
            totalCents: original.totalCents,
            status: 'pending',
            modifiesId: original.id,
            creditReason: reason,
            createdBy: actorId,
          })
          .returning();
        return { row, original, credentials: this.credentials(settings) };
      });
    } catch (error) {
      if (uniqueViolation(error) === 'einvoices_one_note_uq') {
        throw apiError(
          HttpStatus.CONFLICT,
          'credit_note_exists',
          CREDIT_NOTE_PROBLEM_MESSAGES.credit_note_exists,
        );
      }
      throw error;
    }

    const row = await this.send(reserved.row, reserved.credentials, reserved.original);
    await audit(this.db, {
      actorId,
      action: 'einvoice.credit_note',
      entity: 'einvoice',
      entityId: reserved.original.id,
      data: {
        label: einvoiceNumberLabel(row.series, row.number),
        modifies: einvoiceNumberLabel(reserved.original.series, reserved.original.number),
        reason,
        status: row.status,
      },
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

  /** La boleta o factura que anula una nota de crédito. */
  async modified(companyId: string, row: Row): Promise<Row | undefined> {
    if (!row.modifiesId) return undefined;
    const [original] = await this.db
      .select()
      .from(einvoices)
      .where(and(eq(einvoices.id, row.modifiesId), eq(einvoices.companyId, companyId)));
    return original;
  }

  /** Anota la venta de un comprobante que salió y todavía no está en los libros. */
  async record(companyId: string, actorId: string, id: string) {
    await this.access.requireWritable(companyId, actorId, 'accountant');
    return this.recordIfReady(companyId, actorId, await this.get(companyId, actorId, id));
  }

  // ─── Interno ─────────────────────────────────────────────────────────────

  private async lockSettings(tx: Tx, companyId: string) {
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
    return settings;
  }

  /** El siguiente número de la serie; quien llama tiene bloqueada la configuración. */
  private async nextNumber(
    tx: Tx,
    companyId: string,
    docType: EinvoiceDocType,
    series: string,
  ): Promise<number> {
    const [last] = await tx
      .select({ number: max(einvoices.number) })
      .from(einvoices)
      .where(
        and(
          eq(einvoices.companyId, companyId),
          eq(einvoices.docType, docType),
          eq(einvoices.series, series),
        ),
      );
    return (last?.number ?? 0) + 1;
  }

  /** Manda el comprobante reservado; si el proveedor no lo creó, libera el número. */
  private async send(row: Row, credentials: Credentials | null, original?: Row): Promise<Row> {
    const result = await this.providers[row.provider as ProviderCode].emit(
      this.draft(row, original),
      credentials,
    );
    if (result.status === 'error') {
      await this.db.delete(einvoices).where(eq(einvoices.id, row.id));
      throw apiError(HttpStatus.BAD_REQUEST, 'einvoice_provider_error', result.message);
    }
    return this.applyResult(row, result);
  }

  /** Cada comprobante con su nota de crédito o, si es una nota, con lo que anula. */
  private async dtos(companyId: string, rows: Row[]): Promise<EinvoiceDto[]> {
    const modifiedIds = rows.flatMap((r) => (r.modifiesId ? [r.modifiesId] : []));
    const originalIds = rows.filter((r) => r.docType !== '07').map((r) => r.id);
    const [modified, notes] = await Promise.all([
      modifiedIds.length
        ? this.db
            .select()
            .from(einvoices)
            .where(and(eq(einvoices.companyId, companyId), inArray(einvoices.id, modifiedIds)))
        : [],
      originalIds.length
        ? this.db
            .select()
            .from(einvoices)
            .where(
              and(
                eq(einvoices.companyId, companyId),
                isNotNull(einvoices.modifiesId),
                inArray(einvoices.modifiesId, originalIds),
                ne(einvoices.status, 'rejected'),
              ),
            )
        : [],
    ]);
    const byId = new Map(modified.map((r) => [r.id, r]));
    const noteOf = new Map(notes.map((r) => [r.modifiesId as string, r]));
    return rows.map((r) =>
      toDto(r, {
        modifies: r.modifiesId ? byId.get(r.modifiesId) : undefined,
        creditNote: noteOf.get(r.id),
      }),
    );
  }

  private async outcome(
    companyId: string,
    row: Row,
    recordError: string | null = null,
  ): Promise<EmitOutcome> {
    const [einvoice] = await this.dtos(companyId, [row]);
    return { einvoice, recordError };
  }

  private credentials(settings: typeof einvoiceSettings.$inferSelect): Credentials | null {
    return settings.provider === 'nubefact' && settings.endpoint && settings.tokenEncrypted
      ? { endpoint: settings.endpoint, token: this.cipher.decrypt(settings.tokenEncrypted) }
      : null;
  }

  private draft(row: Row, original?: Row): EinvoiceDraft {
    return {
      type: row.docType as EinvoiceDocType,
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
      note:
        original && row.creditReason
          ? {
              type: original.docType as EinvoiceType,
              series: original.series,
              number: original.number,
              reason: row.creditReason as CreditReason,
            }
          : undefined,
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

  private async recordIfReady(companyId: string, actorId: string, row: Row): Promise<EmitOutcome> {
    if (row.entryId || (row.status !== 'accepted' && row.status !== 'test')) {
      return this.outcome(companyId, row);
    }
    try {
      const updated =
        row.docType === '07'
          ? await this.recordCreditNote(companyId, actorId, row)
          : await this.recordSale(companyId, actorId, row);
      return this.outcome(companyId, updated);
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      const body = error.getResponse() as { message?: string };
      const what =
        row.docType === '07'
          ? 'La nota de crédito salió, pero no se pudo extornar la venta'
          : 'El comprobante salió, pero no se pudo anotar la venta';
      return this.outcome(companyId, row, `${what}: ${body.message ?? 'inténtalo de nuevo'}`);
    }
  }

  private async recordSale(companyId: string, actorId: string, row: Row): Promise<Row> {
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
    return updated;
  }

  /** Extorna la venta anulada y guarda la nota como comprobante del extorno. */
  private async recordCreditNote(companyId: string, actorId: string, row: Row): Promise<Row> {
    const original = await this.modified(companyId, row);
    if (!original?.entryId) {
      throw apiError(
        HttpStatus.CONFLICT,
        'credit_note_not_recorded',
        CREDIT_NOTE_PROBLEM_MESSAGES.credit_note_not_recorded,
      );
    }
    const label = einvoiceNumberLabel(row.series, row.number);
    let updated: Row | undefined;
    await this.journal.reverse(
      companyId,
      actorId,
      original.entryId,
      {
        entryDate: row.issueDate,
        description: `Nota de crédito ${label}: anula la ${original.docType === '01' ? 'factura' : 'boleta'} ${einvoiceNumberLabel(original.series, original.number)}`,
      },
      async (tx, reversalId) => {
        await tx.insert(documents).values({
          companyId,
          entryId: reversalId,
          direction: 'sale',
          docType: '07',
          series: row.series,
          number: row.number,
          issueDate: row.issueDate,
          counterpartyRuc: row.customerDocType === 'ruc' ? row.customerDocNumber : null,
          counterpartyName: row.customerName,
          baseCents: row.baseCents,
          igvCents: row.igvCents,
          totalCents: row.totalCents,
          modifiedDocType: original.docType,
          modifiedSeries: original.series,
          modifiedNumber: original.number,
          modifiedIssueDate: original.issueDate,
        });
        [updated] = await tx
          .update(einvoices)
          .set({ entryId: reversalId })
          .where(eq(einvoices.id, row.id))
          .returning();
      },
    );
    return updated as Row;
  }
}
