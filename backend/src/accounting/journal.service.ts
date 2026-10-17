import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, max, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { audit } from '../common/audit.js';
import { apiError } from '../common/http.js';
import { uniqueViolation } from '../common/pg.js';
import { CompanyAccess } from '../companies/company-access.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import {
  accounts,
  companies,
  contacts,
  journalEntries,
  journalLines,
  users,
} from '../db/schema/index.js';
import {
  checkJournal,
  JOURNAL_PROBLEM_MESSAGES,
  type JournalLineInput,
  MAX_LINES_PER_ENTRY,
  MIN_ENTRY_YEAR,
  reverseLines,
} from './journal-rules.js';
import { formatDate, isValidDate, limaDate, periodRange } from './lima.js';
import type { Cents } from './money.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type EntrySource =
  'manual' | 'sale' | 'expense' | 'collection' | 'payment' | 'tax_payment' | 'reversal';

export interface NewJournalEntry {
  /** 'AAAA-MM-DD', fecha de Lima. */
  entryDate: string;
  description: string;
  lines: readonly JournalLineInput[];
  /** Quién lo armó: el contador a mano o una operación fácil. */
  source?: EntrySource;
}

export interface JournalEntryDto {
  id: string;
  fiscalYear: number;
  number: number;
  entryDate: string;
  description: string;
  source: EntrySource;
  /** Asiento que este extorna, si es un extorno. */
  reversesEntryId: string | null;
  /** Extorno que anuló este asiento, si lo hubo. */
  reversedByEntryId: string | null;
  createdBy: { id: string; fullName: string };
  createdAt: Date;
  lines: {
    lineNo: number;
    accountCode: string;
    accountName: string;
    debit: Cents;
    credit: Cents;
    /** Cliente o proveedor, si la línea lo tiene. */
    contact: { id: string; name: string } | null;
  }[];
  totals: { debit: Cents; credit: Cents };
}

/** Asientos por página al listar un periodo. */
export const JOURNAL_PAGE_SIZE = 100;

const entryNotFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'entry_not_found', 'No encontramos el asiento.');

@Injectable()
export class JournalService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(CompanyAccess) private readonly access: CompanyAccess,
  ) {}

  /** Registra un asiento con el siguiente número correlativo del ejercicio. */
  async post(companyId: string, actorId: string, input: NewJournalEntry): Promise<JournalEntryDto> {
    await this.access.requireWritable(companyId, actorId, 'accountant');
    const id = await this.db.transaction((tx) => this.insert(tx, companyId, actorId, input, null));
    return this.get(companyId, actorId, id);
  }

  /**
   * Extorna un asiento: registra otro con los mismos montos en el lado
   * opuesto. Cada asiento se extorna una sola vez y un extorno no se extorna.
   */
  async reverse(
    companyId: string,
    actorId: string,
    entryId: string,
    input: { entryDate?: string; description?: string },
  ): Promise<JournalEntryDto> {
    await this.access.requireWritable(companyId, actorId, 'accountant');
    const original = await this.get(companyId, actorId, entryId);
    if (original.reversesEntryId) {
      throw apiError(
        HttpStatus.CONFLICT,
        'is_reversal',
        'Este asiento ya es un extorno: registra uno nuevo si hace falta.',
      );
    }
    if (original.reversedByEntryId) throw alreadyReversed();
    const entryDate = input.entryDate ?? limaDate(new Date());
    if (entryDate < original.entryDate) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'reversal_before_entry',
        'El extorno no puede tener fecha anterior al asiento que anula.',
      );
    }
    const lines = reverseLines(
      original.lines.map((l) => ({
        accountCode: l.accountCode,
        debit: l.debit,
        credit: l.credit,
        contactId: l.contact?.id,
      })),
    );
    const description =
      input.description ?? `Extorno del asiento ${original.number}-${original.fiscalYear}`;

    let id: string;
    try {
      id = await this.db.transaction(async (tx) => {
        const newId = await this.insert(
          tx,
          companyId,
          actorId,
          { entryDate, description, lines, source: 'reversal' },
          entryId,
        );
        await audit(tx, {
          actorId,
          action: 'entry.reversed',
          entity: 'journal_entry',
          entityId: entryId,
          data: { reversalId: newId },
        });
        return newId;
      });
    } catch (error) {
      if (uniqueViolation(error) === 'journal_entries_reverses_uq') throw alreadyReversed();
      throw error;
    }
    return this.get(companyId, actorId, id);
  }

  async get(companyId: string, actorId: string, entryId: string): Promise<JournalEntryDto> {
    await this.access.require(companyId, actorId, 'viewer');
    const [entry] = await this.load(companyId, eq(journalEntries.id, entryId));
    if (!entry) throw entryNotFound();
    return entry;
  }

  /** Libro diario de un periodo 'AAAA-MM', por número correlativo, de a 100. */
  async list(
    companyId: string,
    actorId: string,
    period: string,
    afterNumber = 0,
  ): Promise<{ entries: JournalEntryDto[]; nextAfter: number | null }> {
    await this.access.require(companyId, actorId, 'viewer');
    const { from, to } = periodRange(period);
    const rows = await this.load(
      companyId,
      and(
        eq(journalEntries.fiscalYear, Number(period.slice(0, 4))),
        sql`${journalEntries.entryDate} BETWEEN ${from} AND ${to}`,
        gt(journalEntries.number, afterNumber),
      ),
      JOURNAL_PAGE_SIZE + 1,
    );
    const entries = rows.slice(0, JOURNAL_PAGE_SIZE);
    return {
      entries,
      nextAfter: rows.length > JOURNAL_PAGE_SIZE ? entries[entries.length - 1].number : null,
    };
  }

  private async insert(
    tx: Tx,
    companyId: string,
    actorId: string,
    input: NewJournalEntry,
    reversesEntryId: string | null,
  ): Promise<string> {
    assertValidEntry(input);
    const fiscalYear = Number(input.entryDate.slice(0, 4));

    // Bloquea la empresa: dos asientos a la vez no se llevan el mismo número
    // y un cierre de periodo espera a que termine.
    const [company] = await tx
      .select({ closedThrough: companies.closedThrough })
      .from(companies)
      .where(eq(companies.id, companyId))
      .for('update');
    if (company.closedThrough && input.entryDate <= company.closedThrough) {
      throw apiError(
        HttpStatus.CONFLICT,
        'period_closed',
        `Los libros están cerrados hasta el ${formatDate(company.closedThrough)}. Usa una fecha posterior o pide al dueño que reabra el mes.`,
      );
    }

    const codes = [...new Set(input.lines.map((l) => l.accountCode))];
    // Bloqueo compartido: nadie convierte estas cuentas en madres mientras se asienta.
    const found = await tx
      .select({ id: accounts.id, code: accounts.code, allowsPosting: accounts.allowsPosting })
      .from(accounts)
      .where(and(eq(accounts.companyId, companyId), inArray(accounts.code, codes)))
      .for('share');
    const byCode = new Map(found.map((a) => [a.code, a]));
    for (const code of codes) {
      const account = byCode.get(code);
      if (!account) {
        throw apiError(HttpStatus.BAD_REQUEST, 'account_not_found', `La cuenta ${code} no existe.`);
      }
      if (!account.allowsPosting) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'account_not_postable',
          `La cuenta ${code} solo agrupa: usa una de sus subcuentas.`,
        );
      }
    }

    const contactIds = [...new Set(input.lines.flatMap((l) => (l.contactId ? [l.contactId] : [])))];
    if (contactIds.length > 0) {
      const found = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.companyId, companyId), inArray(contacts.id, contactIds)));
      if (found.length !== contactIds.length) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'contact_not_found',
          'No encontramos ese cliente o proveedor.',
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
        source: input.source ?? 'manual',
        reversesEntryId,
        createdBy: actorId,
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
        contactId: l.contactId ?? null,
      })),
    );
    return entry.id;
  }

  private async load(
    companyId: string,
    where: ReturnType<typeof and>,
    limit = 1,
  ): Promise<JournalEntryDto[]> {
    const reversal = alias(journalEntries, 'reversal');
    const entries = await this.db
      .select({
        id: journalEntries.id,
        fiscalYear: journalEntries.fiscalYear,
        number: journalEntries.number,
        entryDate: journalEntries.entryDate,
        description: journalEntries.description,
        source: journalEntries.source,
        reversesEntryId: journalEntries.reversesEntryId,
        reversedByEntryId: reversal.id,
        createdById: users.id,
        createdByName: users.fullName,
        createdAt: journalEntries.createdAt,
      })
      .from(journalEntries)
      .innerJoin(users, eq(users.id, journalEntries.createdBy))
      .leftJoin(reversal, eq(reversal.reversesEntryId, journalEntries.id))
      .where(and(eq(journalEntries.companyId, companyId), where))
      .orderBy(asc(journalEntries.fiscalYear), asc(journalEntries.number))
      .limit(limit);
    if (entries.length === 0) return [];

    const lines = await this.db
      .select({
        entryId: journalLines.entryId,
        lineNo: journalLines.lineNo,
        accountCode: accounts.code,
        accountName: accounts.name,
        debit: journalLines.debitCents,
        credit: journalLines.creditCents,
        contactId: contacts.id,
        contactName: contacts.name,
      })
      .from(journalLines)
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .leftJoin(contacts, eq(contacts.id, journalLines.contactId))
      .where(
        inArray(
          journalLines.entryId,
          entries.map((e) => e.id),
        ),
      )
      .orderBy(asc(journalLines.entryId), asc(journalLines.lineNo));
    const byEntry = new Map<string, typeof lines>();
    for (const l of lines) byEntry.set(l.entryId, [...(byEntry.get(l.entryId) ?? []), l]);

    return entries.map(({ createdById, createdByName, source, ...e }) => {
      const entryLines = (byEntry.get(e.id) ?? []).map((l) => ({
        lineNo: l.lineNo,
        accountCode: l.accountCode,
        accountName: l.accountName,
        debit: l.debit,
        credit: l.credit,
        contact: l.contactId ? { id: l.contactId, name: l.contactName ?? '' } : null,
      }));
      return {
        ...e,
        source: source as EntrySource,
        createdBy: { id: createdById, fullName: createdByName },
        lines: entryLines,
        totals: {
          debit: entryLines.reduce((sum, l) => sum + l.debit, 0),
          credit: entryLines.reduce((sum, l) => sum + l.credit, 0),
        },
      };
    });
  }
}

/** Revisa fecha, glosa y partida doble antes de tocar la base. */
function assertValidEntry(input: NewJournalEntry): void {
  if (!isValidDate(input.entryDate) || Number(input.entryDate.slice(0, 4)) < MIN_ENTRY_YEAR) {
    throw apiError(HttpStatus.BAD_REQUEST, 'invalid_date', 'Revisa la fecha del asiento.');
  }
  if (input.entryDate > limaDate(new Date())) {
    throw apiError(
      HttpStatus.BAD_REQUEST,
      'future_date',
      'El asiento no puede tener una fecha posterior a hoy.',
    );
  }
  if (input.lines.length > MAX_LINES_PER_ENTRY) {
    throw apiError(
      HttpStatus.BAD_REQUEST,
      'too_many_lines',
      `Un asiento tiene hasta ${MAX_LINES_PER_ENTRY} líneas.`,
    );
  }
  const problem = checkJournal(input.lines);
  if (problem) throw apiError(HttpStatus.BAD_REQUEST, problem, JOURNAL_PROBLEM_MESSAGES[problem]);
}

function alreadyReversed() {
  return apiError(HttpStatus.CONFLICT, 'already_reversed', 'Este asiento ya fue extornado.');
}
