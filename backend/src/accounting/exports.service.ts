import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import { deriveKey } from '../auth/tokens.js';
import { apiError } from '../common/http.js';
import { CompanyAccess } from '../companies/company-access.js';
import type { Env } from '../config/env.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import {
  accounts,
  companies,
  contacts,
  einvoices,
  journalEntries,
  journalLines,
  licenseReceipts,
} from '../db/schema/index.js';
import { CSV_BOM, csvAmount, csvRow, csvText } from './csv.js';
import { formatDate, limaDate, periodRange } from './lima.js';
import { einvoicePdf } from '../pdf/einvoice-pdf.js';
import { journalPdf, monthlyReportPdf, registerPdf, trialBalancePdf } from '../pdf/reports.js';
import {
  CREDIT_REASONS,
  type CreditReason,
  type CustomerDocType,
  type EinvoiceDocType,
  einvoiceNumberLabel,
  type EinvoiceType,
} from '../einvoicing/einvoice-rules.js';
import { RegistersService } from './registers.service.js';
import { ReportsService } from './reports.service.js';
import {
  inPurchaseRegister,
  rceLine,
  rvieLine,
  type SireBook,
  sireFile,
  sireFileName,
  type SireRow,
} from './sire-rules.js';

export const EXPORT_KINDS = [
  'journal',
  'trial_balance',
  'sales_register',
  'purchase_register',
  'monthly_report',
  'sire_sales',
  'sire_purchases',
] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];
export const EXPORT_FORMATS = ['csv', 'pdf', 'txt'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** El reporte del mes es solo PDF: es para leerlo, no para sacar cuentas en Excel. */
const PDF_ONLY: ReadonlySet<ExportKind> = new Set(['monthly_report']);
/** Los archivos del SIRE son texto con el formato de SUNAT, de un mes. */
const SIRE: ReadonlySet<ExportKind> = new Set(['sire_sales', 'sire_purchases']);
/** De un solo mes. */
const MONTHLY: ReadonlySet<ExportKind> = new Set([
  'monthly_report',
  'sire_sales',
  'sire_purchases',
]);
/** En PDF, el diario va hasta este tope de líneas (un PDF de miles de páginas no sirve). */
export const EXPORT_PDF_MAX_LINES = 5000;

/** El enlace de descarga vale 5 minutos. */
export const EXPORT_TTL_SECONDS = 5 * 60;
/** Tope de filas de un libro diario exportado (de sobra para una pyme en un año). */
export const EXPORT_MAX_LINES = 100_000;

const AUDIENCE = 'contabili-export';

interface ExportClaims {
  userId: string;
  companyId: string;
  kind: ExportKind;
  format: ExportFormat;
  from: string;
  to: string;
}

/**
 * Enlace a la representación impresa de un comprobante electrónico: uno que
 * emitió la empresa o el de un pago de su licencia.
 */
interface EinvoiceClaims {
  userId: string;
  companyId: string;
  kind: 'einvoice' | 'receipt';
  einvoiceId: string;
}

export interface ExportFile {
  filename: string;
  contentType: string;
  body: string | Buffer;
}

const linkExpired = () =>
  apiError(
    HttpStatus.NOT_FOUND,
    'export_expired',
    'El enlace de descarga venció. Vuelve a pedirlo desde Contabili.',
  );

/**
 * Descargas para Excel. La app pide un enlace firmado y corto, y lo abre en
 * el navegador: el archivo se descarga sin plugins en cualquier sistema. Al
 * descargar se vuelve a revisar que la persona siga en la empresa.
 */
@Injectable()
export class ExportsService {
  private readonly key: Uint8Array;
  private readonly publicUrl: string;
  /** Quien vende Contabili: emite los comprobantes de las licencias. */
  private readonly seller: { ruc: string; legalName: string };

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(CompanyAccess) private readonly access: CompanyAccess,
    @Inject(ReportsService) private readonly reports: ReportsService,
    @Inject(RegistersService) private readonly registers: RegistersService,
    @Inject(ConfigService) config: ConfigService<Env, true>,
  ) {
    this.key = new Uint8Array(deriveKey(config.get('AUTH_JWT_SECRET', { infer: true }), 'export'));
    this.publicUrl = config.get('PUBLIC_WEB_URL', { infer: true });
    this.seller = {
      ruc: config.get('COMPANY_RUC', { infer: true }) ?? '—',
      legalName: config.get('COMPANY_LEGAL_NAME', { infer: true }),
    };
  }

  async createLink(
    companyId: string,
    actorId: string,
    input: { kind: ExportKind; format?: ExportFormat; from: string; to: string },
  ): Promise<{ url: string; expiresAt: string }> {
    await this.access.require(companyId, actorId, 'viewer');
    const format =
      input.format ?? (PDF_ONLY.has(input.kind) ? 'pdf' : SIRE.has(input.kind) ? 'txt' : 'csv');
    if (PDF_ONLY.has(input.kind) && format !== 'pdf') {
      throw apiError(HttpStatus.BAD_REQUEST, 'pdf_only', 'El reporte del mes solo está en PDF.');
    }
    if (SIRE.has(input.kind) !== (format === 'txt')) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'sire_txt_only',
        'Los archivos para SUNAT (SIRE) son de texto; los demás, en Excel o PDF.',
      );
    }
    if (MONTHLY.has(input.kind) && input.from.slice(0, 7) !== input.to.slice(0, 7)) {
      throw apiError(HttpStatus.BAD_REQUEST, 'one_month', 'Es de un solo mes: elige un mes.');
    }
    if (SIRE.has(input.kind)) {
      const [company] = await this.db
        .select({ taxRegime: companies.taxRegime })
        .from(companies)
        .where(eq(companies.id, companyId));
      if (company.taxRegime === 'nrus') {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'sire_not_for_nrus',
          'En el Nuevo RUS no se llevan registros de ventas ni de compras: no hay archivo para el SIRE.',
        );
      }
    }
    const token = await new SignJWT({
      cid: companyId,
      k: input.kind,
      fm: format,
      f: input.from,
      t: input.to,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(actorId)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${EXPORT_TTL_SECONDS}s`)
      .sign(this.key);
    return {
      url: `${this.publicUrl}/api/v1/exports/${token}`,
      expiresAt: new Date(Date.now() + EXPORT_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /** Enlace corto al PDF de un comprobante electrónico (la empresa ya se revisó). */
  async einvoiceLink(
    companyId: string,
    actorId: string,
    einvoiceId: string,
    kind: EinvoiceClaims['kind'] = 'einvoice',
  ): Promise<string> {
    await this.access.require(companyId, actorId, 'viewer');
    const token = await new SignJWT({ cid: companyId, k: kind, e: einvoiceId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(actorId)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${EXPORT_TTL_SECONDS}s`)
      .sign(this.key);
    return `${this.publicUrl}/api/v1/exports/${token}`;
  }

  /** Archivo del enlace: nombre, tipo y contenido (CSV o PDF). */
  async download(token: string): Promise<ExportFile> {
    const claims = await this.verify(token);
    // Sacar a alguien de la empresa corta también sus enlaces aún vigentes.
    await this.access.require(claims.companyId, claims.userId, 'viewer');
    const [company] = await this.db
      .select({ ruc: companies.ruc, legalName: companies.legalName })
      .from(companies)
      .where(eq(companies.id, claims.companyId));
    if ('einvoiceId' in claims) {
      return claims.kind === 'receipt'
        ? this.receiptFile(claims, company)
        : this.einvoiceFile(claims, company);
    }
    if (claims.kind === 'sire_sales' || claims.kind === 'sire_purchases') {
      return this.sireTxt(claims, company);
    }
    const range =
      claims.kind === 'monthly_report' ? claims.from.slice(0, 7) : `${claims.from}-al-${claims.to}`;
    const name = {
      journal: 'libro-diario',
      trial_balance: 'balance-de-comprobacion',
      sales_register: 'registro-de-ventas',
      purchase_register: 'registro-de-compras',
      monthly_report: 'reporte-del-mes',
    }[claims.kind as Exclude<ExportKind, 'sire_sales' | 'sire_purchases'>];
    const filename = `${name}-${company.ruc}-${range}.${claims.format}`;
    if (claims.format === 'pdf') {
      return { filename, contentType: 'application/pdf', body: await this.pdf(claims, company) };
    }
    const body =
      claims.kind === 'trial_balance'
        ? await this.trialBalanceCsv(claims)
        : claims.kind === 'sales_register' || claims.kind === 'purchase_register'
          ? await this.registerCsv(claims, claims.kind === 'sales_register' ? 'sale' : 'purchase')
          : await this.journalCsv(claims);
    return { filename, contentType: 'text/csv; charset=utf-8', body };
  }

  private async pdf(
    claims: ExportClaims,
    company: { ruc: string; legalName: string },
  ): Promise<Buffer> {
    const { companyId, userId, from, to } = claims;
    switch (claims.kind) {
      case 'monthly_report': {
        const period = from.slice(0, 7);
        const [summary, taxes, sales, purchases] = await Promise.all([
          this.reports.summary(companyId, userId, period, limaDate(new Date())),
          this.reports.taxes(companyId, userId, period),
          this.registers.register(companyId, userId, 'sale', from, to),
          this.registers.register(companyId, userId, 'purchase', from, to),
        ]);
        return monthlyReportPdf({ company, period, summary, taxes, sales, purchases });
      }
      case 'sales_register':
      case 'purchase_register':
        return registerPdf(
          company,
          await this.registers.register(
            companyId,
            userId,
            claims.kind === 'sales_register' ? 'sale' : 'purchase',
            from,
            to,
          ),
        );
      case 'trial_balance':
        return trialBalancePdf(
          company,
          await this.reports.trialBalance(companyId, userId, from, to),
        );
      case 'sire_sales':
      case 'sire_purchases':
        // Solo en texto: el enlace no se firma con otro formato.
        throw linkExpired();
      case 'journal': {
        const lines = await this.journalLines(claims, EXPORT_PDF_MAX_LINES + 1);
        return journalPdf(
          company,
          from,
          to,
          lines.slice(0, EXPORT_PDF_MAX_LINES),
          lines.length > EXPORT_PDF_MAX_LINES,
        );
      }
    }
  }

  private async einvoiceFile(
    claims: EinvoiceClaims,
    company: { ruc: string; legalName: string },
  ): Promise<ExportFile> {
    const [row] = await this.db
      .select()
      .from(einvoices)
      .where(and(eq(einvoices.id, claims.einvoiceId), eq(einvoices.companyId, claims.companyId)));
    if (!row) throw linkExpired();
    const [original] = row.modifiesId
      ? await this.db
          .select()
          .from(einvoices)
          .where(and(eq(einvoices.id, row.modifiesId), eq(einvoices.companyId, claims.companyId)))
      : [];
    const label = einvoiceNumberLabel(row.series, row.number);
    const kind = { '01': 'factura', '03': 'boleta', '07': 'nota-de-credito' }[
      row.docType as EinvoiceDocType
    ];
    return {
      filename: `${kind}-${company.ruc}-${label}.pdf`,
      contentType: 'application/pdf',
      body: await einvoicePdf({
        company,
        type: row.docType as EinvoiceDocType,
        note:
          original && row.creditReason
            ? {
                type: original.docType as EinvoiceType,
                label: einvoiceNumberLabel(original.series, original.number),
                issueDate: original.issueDate,
                reason: CREDIT_REASONS[row.creditReason as CreditReason],
              }
            : undefined,
        series: row.series,
        number: row.number,
        issueDate: row.issueDate,
        customer: {
          docType: row.customerDocType as CustomerDocType,
          number: row.customerDocNumber,
          name: row.customerName,
        },
        description: row.description,
        base: row.baseCents,
        igv: row.igvCents,
        total: row.totalCents,
        test: row.provider === 'test',
        nrus: row.nrus,
        hash: row.hash,
      }),
    };
  }

  /**
   * Archivo del SIRE que reemplaza la propuesta de SUNAT, armado con el
   * registro del mes. El DNI de quien compra sale de la boleta electrónica.
   */
  private async sireTxt(
    claims: ExportClaims,
    company: { ruc: string; legalName: string },
  ): Promise<ExportFile> {
    const book: SireBook = claims.kind === 'sire_sales' ? 'sales' : 'purchases';
    const period = claims.from.slice(0, 7);
    const { from, to } = periodRange(period);
    const report = await this.registers.register(
      claims.companyId,
      claims.userId,
      book === 'sales' ? 'sale' : 'purchase',
      from,
      to,
    );
    if (report.truncated) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'sire_too_many',
        'Este mes tiene más comprobantes de los que entran en un archivo. Escríbenos y te ayudamos.',
      );
    }
    const entryIds = report.rows.map((r) => r.entryId);
    const people = entryIds.length
      ? await this.db
          .select({
            entryId: einvoices.entryId,
            docType: einvoices.customerDocType,
            number: einvoices.customerDocNumber,
          })
          .from(einvoices)
          .where(
            and(eq(einvoices.companyId, claims.companyId), inArray(einvoices.entryId, entryIds)),
          )
      : [];
    const dni = new Map(
      people.flatMap((p) => (p.docType === 'dni' && p.number ? [[p.entryId, p.number]] : [])),
    );
    const rows: SireRow[] = report.rows.map((r) => ({
      issueDate: r.issueDate,
      docType: r.docType,
      series: r.series,
      number: r.number,
      partyDocType: r.counterpartyRuc ? '6' : dni.has(r.entryId) ? '1' : null,
      partyDoc: r.counterpartyRuc ?? dni.get(r.entryId) ?? null,
      partyName: r.counterpartyName,
      base: r.base,
      igv: r.igv,
      total: r.total,
      annulled: r.annulled,
      modifies: r.modifies,
    }));
    const lines =
      book === 'sales'
        ? rows.map((r) => rvieLine(company, period, r))
        : rows.filter(inPurchaseRegister).map((r) => rceLine(company, period, r));
    return {
      filename: sireFileName(book, company.ruc, period, lines.length > 0),
      contentType: 'text/plain; charset=utf-8',
      body: sireFile(lines),
    };
  }

  /** Comprobante de prueba de un pago de licencia: lo emite quien vende Contabili. */
  private async receiptFile(
    claims: EinvoiceClaims,
    company: { ruc: string; legalName: string },
  ): Promise<ExportFile> {
    const [row] = await this.db
      .select()
      .from(licenseReceipts)
      .where(
        and(
          eq(licenseReceipts.id, claims.einvoiceId),
          eq(licenseReceipts.companyId, claims.companyId),
        ),
      );
    if (!row?.series || !row.number || !row.issueDate) throw linkExpired();
    const label = einvoiceNumberLabel(row.series, row.number);
    return {
      filename: `factura-contabili-${company.ruc}-${label}.pdf`,
      contentType: 'application/pdf',
      body: await einvoicePdf({
        company: this.seller,
        type: '01',
        series: row.series,
        number: row.number,
        issueDate: row.issueDate,
        customer: { docType: 'ruc', number: row.customerRuc, name: row.customerName },
        description: row.description,
        base: row.baseCents,
        igv: row.igvCents,
        total: row.totalCents,
        test: row.provider === 'test',
        nrus: false,
        hash: row.hash,
      }),
    };
  }

  private async verify(token: string): Promise<ExportClaims | EinvoiceClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      const { sub, cid, k, fm, f, t, e } = payload as Record<string, unknown>;
      if (
        (k === 'einvoice' || k === 'receipt') &&
        typeof sub === 'string' &&
        typeof cid === 'string' &&
        typeof e === 'string'
      ) {
        return { userId: sub, companyId: cid, kind: k, einvoiceId: e };
      }
      if (
        typeof sub !== 'string' ||
        typeof cid !== 'string' ||
        !EXPORT_KINDS.includes(k as ExportKind) ||
        !EXPORT_FORMATS.includes(fm as ExportFormat) ||
        typeof f !== 'string' ||
        typeof t !== 'string'
      ) {
        throw linkExpired();
      }
      return {
        userId: sub,
        companyId: cid,
        kind: k as ExportKind,
        format: fm as ExportFormat,
        from: f,
        to: t,
      };
    } catch {
      throw linkExpired();
    }
  }

  private journalLines(claims: ExportClaims, limit: number) {
    return this.db
      .select({
        number: journalEntries.number,
        fiscalYear: journalEntries.fiscalYear,
        entryDate: journalEntries.entryDate,
        description: journalEntries.description,
        accountCode: accounts.code,
        accountName: accounts.name,
        debit: journalLines.debitCents,
        credit: journalLines.creditCents,
        contact: contacts.name,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .leftJoin(contacts, eq(contacts.id, journalLines.contactId))
      .where(
        and(
          eq(journalLines.companyId, claims.companyId),
          sql`${journalEntries.entryDate} BETWEEN ${claims.from} AND ${claims.to}`,
        ),
      )
      .orderBy(asc(journalEntries.fiscalYear), asc(journalEntries.number), asc(journalLines.lineNo))
      .limit(limit);
  }

  private async journalCsv(claims: ExportClaims): Promise<string> {
    const rows = await this.journalLines(claims, EXPORT_MAX_LINES);
    let csv = CSV_BOM;
    csv += csvRow([
      'Asiento',
      'Fecha',
      'Glosa',
      'Cuenta',
      'Nombre de la cuenta',
      'Debe',
      'Haber',
      'Cliente o proveedor',
    ]);
    for (const r of rows) {
      csv += csvRow([
        `${r.number}-${r.fiscalYear}`,
        formatDate(r.entryDate),
        csvText(r.description),
        r.accountCode,
        csvText(r.accountName),
        csvAmount(r.debit),
        csvAmount(r.credit),
        csvText(r.contact ?? ''),
      ]);
    }
    return csv;
  }

  private async registerCsv(claims: ExportClaims, direction: 'sale' | 'purchase'): Promise<string> {
    const report = await this.registers.register(
      claims.companyId,
      claims.userId,
      direction,
      claims.from,
      claims.to,
    );
    let csv = CSV_BOM;
    csv += csvRow([
      'Fecha de emisión',
      'Tipo',
      'Comprobante',
      'Serie',
      'Número',
      direction === 'sale' ? 'RUC del cliente' : 'RUC del proveedor',
      direction === 'sale' ? 'Cliente' : 'Proveedor',
      'Base imponible',
      'IGV',
      'Total',
      'Estado',
      'Modifica: tipo',
      'Modifica: serie',
      'Modifica: número',
      'Modifica: fecha',
    ]);
    for (const r of report.rows) {
      csv += csvRow([
        formatDate(r.issueDate),
        r.docType,
        csvText(r.docTypeLabel),
        csvText(r.series),
        String(r.number),
        r.counterpartyRuc ?? '',
        csvText(r.counterpartyName ?? ''),
        csvAmount(r.base),
        csvAmount(r.igv),
        csvAmount(r.total),
        r.annulled ? 'Anulado' : '',
        r.modifies?.docType ?? '',
        csvText(r.modifies?.series ?? ''),
        r.modifies ? String(r.modifies.number) : '',
        r.modifies ? formatDate(r.modifies.issueDate) : '',
      ]);
    }
    const t = report.totals;
    csv += csvRow([
      '',
      '',
      'Totales',
      '',
      '',
      '',
      '',
      csvAmount(t.base),
      csvAmount(t.igv),
      csvAmount(t.total),
      '',
      '',
      '',
      '',
      '',
    ]);
    return csv;
  }

  private async trialBalanceCsv(claims: ExportClaims): Promise<string> {
    const report = await this.reports.trialBalance(
      claims.companyId,
      claims.userId,
      claims.from,
      claims.to,
    );
    let csv = CSV_BOM;
    csv += csvRow(['Cuenta', 'Nombre', 'Debe', 'Haber', 'Saldo deudor', 'Saldo acreedor']);
    for (const r of report.rows) {
      csv += csvRow([
        r.code,
        csvText(r.name),
        csvAmount(r.debit),
        csvAmount(r.credit),
        csvAmount(r.debitBalance),
        csvAmount(r.creditBalance),
      ]);
    }
    const t = report.totals;
    csv += csvRow([
      '',
      'Totales',
      csvAmount(t.debit),
      csvAmount(t.credit),
      csvAmount(t.debitBalance),
      csvAmount(t.creditBalance),
    ]);
    return csv;
  }
}
