import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, max } from 'drizzle-orm';
import { apiError } from '../common/http.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { accounts, companies, journalEntries, journalLines } from '../db/schema/index.js';
import {
  checkJournal,
  JOURNAL_PROBLEM_MESSAGES,
  type JournalLineInput,
  MAX_LINES_PER_ENTRY,
} from './journal-rules.js';

export interface NewJournalEntry {
  /** 'AAAA-MM-DD', fecha de Lima. */
  entryDate: string;
  description: string;
  lines: readonly JournalLineInput[];
}

@Injectable()
export class JournalService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Registra un asiento con el siguiente número correlativo del ejercicio. */
  async post(companyId: string, input: NewJournalEntry): Promise<{ id: string; number: number }> {
    const problem =
      input.lines.length > MAX_LINES_PER_ENTRY ? 'too_many_lines' : checkJournal(input.lines);
    if (problem) {
      const message =
        problem === 'too_many_lines'
          ? `Un asiento tiene hasta ${MAX_LINES_PER_ENTRY} líneas.`
          : JOURNAL_PROBLEM_MESSAGES[problem];
      throw apiError(HttpStatus.BAD_REQUEST, problem, message);
    }
    const fiscalYear = Number(input.entryDate.slice(0, 4));

    return this.db.transaction(async (tx) => {
      // Bloquea la empresa: dos asientos a la vez no se llevan el mismo número.
      const [company] = await tx
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.id, companyId))
        .for('update');
      if (!company) {
        throw apiError(HttpStatus.NOT_FOUND, 'company_not_found', 'No encontramos la empresa.');
      }

      const codes = [...new Set(input.lines.map((l) => l.accountCode))];
      const found = await tx
        .select({ id: accounts.id, code: accounts.code, allowsPosting: accounts.allowsPosting })
        .from(accounts)
        .where(and(eq(accounts.companyId, companyId), inArray(accounts.code, codes)));
      const byCode = new Map(found.map((a) => [a.code, a]));
      for (const code of codes) {
        const account = byCode.get(code);
        if (!account) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'account_not_found',
            `La cuenta ${code} no existe.`,
          );
        }
        if (!account.allowsPosting) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'account_not_postable',
            `La cuenta ${code} solo agrupa: usa una de sus subcuentas.`,
          );
        }
      }

      const [last] = await tx
        .select({ number: max(journalEntries.number) })
        .from(journalEntries)
        .where(
          and(eq(journalEntries.companyId, companyId), eq(journalEntries.fiscalYear, fiscalYear)),
        );
      const number = (last?.number ?? 0) + 1;

      const [entry] = await tx
        .insert(journalEntries)
        .values({
          companyId,
          fiscalYear,
          number,
          entryDate: input.entryDate,
          description: input.description,
        })
        .returning({ id: journalEntries.id });
      await tx.insert(journalLines).values(
        input.lines.map((l, i) => ({
          entryId: entry.id,
          companyId,
          lineNo: i + 1,
          accountId: byCode.get(l.accountCode)!.id,
          debitCents: l.debit,
          creditCents: l.credit,
        })),
      );
      return { id: entry.id, number };
    });
  }
}
