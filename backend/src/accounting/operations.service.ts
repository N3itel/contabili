import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { apiError } from '../common/http.js';
import { uniqueViolation } from '../common/pg.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { companies, contacts, documents } from '../db/schema/index.js';
import {
  DOCUMENT_PROBLEM_MESSAGES,
  DOCUMENT_TYPES,
  type DocumentInput,
  documentDirection,
  documentLabel,
  documentProblem,
  normalizeSeries,
} from './document-rules.js';
import { JournalService, type JournalEntryDto } from './journal.service.js';
import { limaDate } from './lima.js';
import {
  buildOperation,
  isMoneyAccountCode,
  type Operation,
  OPERATION_ACCOUNTS,
  operationContactKind,
} from './operations.js';

export interface OperationInput {
  operation: Operation;
  /** Cliente (ventas al crédito y cobros) o proveedor (gastos al crédito y pagos). */
  contactId?: string;
  /** Por defecto, hoy (hora de Lima). */
  date?: string;
  /** Referencia corta libre (va en la glosa). Para el registro, usa `document`. */
  reference?: string;
  /** Comprobante de la venta o del gasto: arma los registros de ventas y compras. */
  document?: DocumentInput;
  moneyAccountCode?: string;
}

@Injectable()
export class OperationsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(JournalService) private readonly journal: JournalService,
  ) {}

  /** Registra una operación como asiento y devuelve qué se hizo, en palabras simples. */
  async record(
    companyId: string,
    actorId: string,
    input: OperationInput,
  ): Promise<{ entry: JournalEntryDto; explanation: string }> {
    if (input.moneyAccountCode && !isMoneyAccountCode(input.moneyAccountCode)) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'invalid_money_account',
        'Elige una cuenta de caja o de banco (empieza con 10).',
      );
    }
    // El rol y la empresa los revisa el diario al registrar; aquí solo se lee el régimen.
    const [company] = await this.db
      .select({ taxRegime: companies.taxRegime })
      .from(companies)
      .where(eq(companies.id, companyId));
    const regime = company?.taxRegime ?? 'general';
    const contact = input.contactId
      ? await this.assertContact(companyId, input.contactId, input.operation)
      : null;
    const doc = input.document
      ? { ...input.document, series: normalizeSeries(input.document.series) }
      : null;
    if (doc) {
      // Sin RUC en el comprobante, vale el del cliente o proveedor elegido.
      doc.counterpartyRuc ??= contact?.ruc ?? undefined;
      doc.counterpartyName ??= contact?.name;
      const problem = documentProblem(input.operation, doc, regime);
      if (problem) {
        throw apiError(HttpStatus.BAD_REQUEST, problem, DOCUMENT_PROBLEM_MESSAGES[problem]);
      }
    }
    const built = buildOperation(input.operation, {
      taxRegime: regime,
      moneyAccountCode: input.moneyAccountCode,
      contactId: input.contactId,
    });
    const entryDate = input.date ?? limaDate(new Date());
    const reference = doc
      ? `${DOCUMENT_TYPES[doc.type].label} ${documentLabel(doc.series, doc.number)}`
      : input.reference;
    try {
      const entry = await this.journal.post(
        companyId,
        actorId,
        {
          entryDate,
          description: reference ? `${built.description} · ${reference}` : built.description,
          lines: built.lines,
          source: input.operation.type,
        },
        doc
          ? async (tx, entryId) => {
              const total = input.operation.total;
              const igv = built.lines
                .filter((l) => l.accountCode === OPERATION_ACCOUNTS.igv)
                .reduce((sum, l) => sum + l.debit + l.credit, 0);
              await tx.insert(documents).values({
                companyId,
                entryId,
                direction: documentDirection(input.operation)!,
                docType: doc.type,
                series: doc.series,
                number: doc.number,
                issueDate: entryDate,
                counterpartyRuc: doc.counterpartyRuc ?? null,
                counterpartyName: doc.counterpartyName?.trim() || null,
                baseCents: total - igv,
                igvCents: igv,
                totalCents: total,
              });
            }
          : undefined,
      );
      return { entry, explanation: built.explanation };
    } catch (error) {
      const constraint = uniqueViolation(error);
      if (doc && (constraint === 'documents_sale_uq' || constraint === 'documents_purchase_uq')) {
        const label = `${DOCUMENT_TYPES[doc.type].label.toLowerCase()} ${documentLabel(doc.series, doc.number)}`;
        throw apiError(
          HttpStatus.CONFLICT,
          'document_duplicate',
          constraint === 'documents_sale_uq'
            ? `Ya registraste la ${label}. Revisa el número: cada comprobante tuyo va una sola vez.`
            : `Ya registraste la ${label} de ese proveedor.`,
        );
      }
      throw error;
    }
  }

  /** El contacto es de la empresa, sigue activo y es del tipo que pide la operación. */
  private async assertContact(
    companyId: string,
    contactId: string,
    op: Operation,
  ): Promise<{ name: string; ruc: string | null }> {
    const kind = operationContactKind(op);
    if (!kind) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'contact_not_needed',
        'Al contado no hace falta elegir cliente ni proveedor.',
      );
    }
    const [contact] = await this.db
      .select({ kind: contacts.kind, name: contacts.name, ruc: contacts.ruc })
      .from(contacts)
      .where(
        and(
          eq(contacts.id, contactId),
          eq(contacts.companyId, companyId),
          isNull(contacts.archivedAt),
        ),
      );
    if (!contact) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'contact_not_found',
        'No encontramos ese cliente o proveedor.',
      );
    }
    if (contact.kind !== kind) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'contact_wrong_kind',
        kind === 'customer'
          ? 'Elige un cliente, no un proveedor.'
          : 'Elige un proveedor, no un cliente.',
      );
    }
    return { name: contact.name, ruc: contact.ruc };
  }
}
