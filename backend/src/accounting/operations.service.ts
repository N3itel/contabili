import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { apiError } from '../common/http.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { companies } from '../db/schema/index.js';
import { JournalService, type JournalEntryDto } from './journal.service.js';
import { limaDate } from './lima.js';
import { buildOperation, isMoneyAccountCode, type Operation } from './operations.js';

export interface OperationInput {
  operation: Operation;
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
    const built = buildOperation(input.operation, {
      taxRegime: company?.taxRegime ?? 'general',
      moneyAccountCode: input.moneyAccountCode,
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
}
