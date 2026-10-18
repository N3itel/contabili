import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, sql } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import { deriveKey } from '../auth/tokens.js';
import { apiError } from '../common/http.js';
import { CompanyAccess } from '../companies/company-access.js';
import type { Env } from '../config/env.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { accounts, companies, contacts, journalEntries, journalLines } from '../db/schema/index.js';
import { CSV_BOM, csvAmount, csvRow, csvText } from './csv.js';
import { formatDate } from './lima.js';
import { RegistersService } from './registers.service.js';
import { ReportsService } from './reports.service.js';

export const EXPORT_KINDS = [
  'journal',
  'trial_balance',
  'sales_register',
  'purchase_register',
] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

/** El enlace de descarga vale 5 minutos. */
export const EXPORT_TTL_SECONDS = 5 * 60;
/** Tope de filas de un libro diario exportado (de sobra para una pyme en un año). */
export const EXPORT_MAX_LINES = 100_000;

const AUDIENCE = 'contabili-export';

interface ExportClaims {
  userId: string;
  companyId: string;
  kind: ExportKind;
  from: string;
  to: string;
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

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(CompanyAccess) private readonly access: CompanyAccess,
    @Inject(ReportsService) private readonly reports: ReportsService,
    @Inject(RegistersService) private readonly registers: RegistersService,
    @Inject(ConfigService) config: ConfigService<Env, true>,
  ) {
    this.key = new Uint8Array(deriveKey(config.get('AUTH_JWT_SECRET', { infer: true }), 'export'));
    this.publicUrl = config.get('PUBLIC_WEB_URL', { infer: true });
  }

  async createLink(
    companyId: string,
    actorId: string,
    input: { kind: ExportKind; from: string; to: string },
  ): Promise<{ url: string; expiresAt: string }> {
    await this.access.require(companyId, actorId, 'viewer');
    const token = await new SignJWT({ cid: companyId, k: input.kind, f: input.from, t: input.to })
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

  /** Archivo del enlace: nombre y contenido CSV. */
  async download(token: string): Promise<{ filename: string; body: string }> {
    const claims = await this.verify(token);
    // Sacar a alguien de la empresa corta también sus enlaces aún vigentes.
    await this.access.require(claims.companyId, claims.userId, 'viewer');
    const [company] = await this.db
      .select({ ruc: companies.ruc })
      .from(companies)
      .where(eq(companies.id, claims.companyId));
    const range = `${claims.from}-al-${claims.to}`;
    if (claims.kind === 'trial_balance') {
      return {
        filename: `balance-de-comprobacion-${company.ruc}-${range}.csv`,
        body: await this.trialBalanceCsv(claims),
      };
    }
    if (claims.kind === 'sales_register' || claims.kind === 'purchase_register') {
      const sales = claims.kind === 'sales_register';
      return {
        filename: `registro-de-${sales ? 'ventas' : 'compras'}-${company.ruc}-${range}.csv`,
        body: await this.registerCsv(claims, sales ? 'sale' : 'purchase'),
      };
    }
    return {
      filename: `libro-diario-${company.ruc}-${range}.csv`,
      body: await this.journalCsv(claims),
    };
  }

  private async verify(token: string): Promise<ExportClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      const { sub, cid, k, f, t } = payload as Record<string, unknown>;
      if (
        typeof sub !== 'string' ||
        typeof cid !== 'string' ||
        !EXPORT_KINDS.includes(k as ExportKind) ||
        typeof f !== 'string' ||
        typeof t !== 'string'
      ) {
        throw linkExpired();
      }
      return { userId: sub, companyId: cid, kind: k as ExportKind, from: f, to: t };
    } catch {
      throw linkExpired();
    }
  }

  private async journalCsv(claims: ExportClaims): Promise<string> {
    const rows = await this.db
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
      .limit(EXPORT_MAX_LINES);
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
