import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { CompanyAccess } from '../companies/company-access.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { documents, journalEntries } from '../db/schema/index.js';
import {
  type DocumentDirection,
  REGISTER_DOC_LABELS,
  type RegisterDocType,
} from './document-rules.js';
import type { Cents } from './money.js';

/** Hasta cuántos comprobantes devuelve un registro de una vez. */
export const REGISTER_MAX_ROWS = 5000;

export interface RegisterRow {
  entryId: string;
  issueDate: string;
  docType: RegisterDocType;
  docTypeLabel: string;
  series: string;
  number: number;
  counterpartyRuc: string | null;
  counterpartyName: string | null;
  /** Con signo: una nota de crédito va en negativo. */
  base: Cents;
  igv: Cents;
  total: Cents;
  /** Nota de crédito: la boleta o factura que modifica. */
  modifies: { docType: RegisterDocType; series: string; number: number; issueDate: string } | null;
  /**
   * Su asiento se extornó a mano: figura en el registro, pero no suma. Una
   * boleta o factura anulada con nota de crédito no figura como anulada: suma
   * y la nota la resta, como lo pide SUNAT.
   */
  annulled: boolean;
}

export interface RegisterDto {
  direction: DocumentDirection;
  from: string;
  to: string;
  rows: RegisterRow[];
  totals: { count: number; base: Cents; igv: Cents; total: Cents };
  /** Hay más comprobantes de los que se muestran: acota el rango de fechas. */
  truncated: boolean;
}

/**
 * Registro de ventas (lo que la empresa emitió) y de compras (lo que le
 * dieron sus proveedores), armados con los comprobantes de cada operación.
 */
@Injectable()
export class RegistersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(CompanyAccess) private readonly access: CompanyAccess,
  ) {}

  async register(
    companyId: string,
    actorId: string,
    direction: DocumentDirection,
    from: string,
    to: string,
  ): Promise<RegisterDto> {
    await this.access.require(companyId, actorId, 'viewer');
    const reversal = alias(journalEntries, 'reversal');
    const note = alias(documents, 'note');
    const found = await this.db
      .select({
        entryId: documents.entryId,
        issueDate: documents.issueDate,
        docType: documents.docType,
        series: documents.series,
        number: documents.number,
        counterpartyRuc: documents.counterpartyRuc,
        counterpartyName: documents.counterpartyName,
        base: documents.baseCents,
        igv: documents.igvCents,
        total: documents.totalCents,
        modifiedDocType: documents.modifiedDocType,
        modifiedSeries: documents.modifiedSeries,
        modifiedNumber: documents.modifiedNumber,
        modifiedIssueDate: documents.modifiedIssueDate,
        reversalId: reversal.id,
        noteId: note.id,
      })
      .from(documents)
      .leftJoin(reversal, eq(reversal.reversesEntryId, documents.entryId))
      .leftJoin(note, eq(note.entryId, reversal.id))
      .where(
        and(
          eq(documents.companyId, companyId),
          eq(documents.direction, direction),
          sql`${documents.issueDate} BETWEEN ${from} AND ${to}`,
        ),
      )
      .orderBy(
        asc(documents.issueDate),
        asc(documents.docType),
        asc(documents.series),
        asc(documents.number),
      )
      .limit(REGISTER_MAX_ROWS + 1);
    const rows: RegisterRow[] = found
      .slice(0, REGISTER_MAX_ROWS)
      .map(
        ({
          reversalId,
          noteId,
          modifiedDocType,
          modifiedSeries,
          modifiedNumber,
          modifiedIssueDate,
          ...r
        }) => {
          const sign = r.docType === '07' ? -1 : 1;
          return {
            ...r,
            docType: r.docType as RegisterDocType,
            docTypeLabel: REGISTER_DOC_LABELS[r.docType as RegisterDocType],
            base: sign * r.base,
            igv: sign * r.igv,
            total: sign * r.total,
            modifies:
              modifiedDocType && modifiedSeries && modifiedNumber && modifiedIssueDate
                ? {
                    docType: modifiedDocType as RegisterDocType,
                    series: modifiedSeries,
                    number: modifiedNumber,
                    issueDate: modifiedIssueDate,
                  }
                : null,
            annulled: reversalId !== null && noteId === null,
          };
        },
      );
    const valid = rows.filter((r) => !r.annulled);
    return {
      direction,
      from,
      to,
      rows,
      totals: {
        count: valid.length,
        base: valid.reduce((sum, r) => sum + r.base, 0),
        igv: valid.reduce((sum, r) => sum + r.igv, 0),
        total: valid.reduce((sum, r) => sum + r.total, 0),
      },
      truncated: found.length > REGISTER_MAX_ROWS,
    };
  }
}
