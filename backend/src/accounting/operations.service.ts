import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { apiError } from '../common/http.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { companies, contacts } from '../db/schema/index.js';
import { JournalService, type JournalEntryDto } from './journal.service.js';
import { limaDate } from './lima.js';
import {
  buildOperation,
  isMoneyAccountCode,
  type Operation,
  operationContactKind,
} from './operations.js';

export interface OperationInput {
  operation: Operation;
  /** Cliente (ventas al crédito y cobros) o proveedor (gastos al crédito y pagos). */
  contactId?: string;
  /** Por defecto, hoy (hora de Lima). */
  date?: string;
  /** Número del comprobante (F001-123, B001-45) u otra referencia corta. */
  reference?: string;
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
    if (input.contactId) await this.assertContact(companyId, input.contactId, input.operation);
    const built = buildOperation(input.operation, {
      taxRegime: company?.taxRegime ?? 'general',
      moneyAccountCode: input.moneyAccountCode,
      contactId: input.contactId,
    });
    const entry = await this.journal.post(companyId, actorId, {
      entryDate: input.date ?? limaDate(new Date()),
      description: input.reference
        ? `${built.description} · ${input.reference}`
        : built.description,
      lines: built.lines,
    });
    return { entry, explanation: built.explanation };
  }

  /** El contacto es de la empresa, sigue activo y es del tipo que pide la operación. */
  private async assertContact(companyId: string, contactId: string, op: Operation): Promise<void> {
    const kind = operationContactKind(op);
    if (!kind) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'contact_not_needed',
        'Al contado no hace falta elegir cliente ni proveedor.',
      );
    }
    const [contact] = await this.db
      .select({ kind: contacts.kind })
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
  }
}
