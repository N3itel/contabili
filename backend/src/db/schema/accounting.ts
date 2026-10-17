import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id } from './columns.js';
import { accountNature, taxRegime } from './enums.js';
import { users } from './users.js';

/**
 * Empresa que lleva su contabilidad en Contabili, identificada por su RUC. El
 * RUC no es único: el dueño y su estudio contable pueden llevar cada uno la
 * suya, y nadie bloquea a una empresa registrando su RUC antes.
 */
export const companies = pgTable(
  'companies',
  {
    id: id(),
    ruc: varchar('ruc', { length: 11 }).notNull(),
    legalName: varchar('legal_name', { length: 200 }).notNull(),
    taxRegime: taxRegime('tax_regime').notNull(),
    /**
     * Libros cerrados hasta esta fecha (inclusive): no se registran asientos
     * con fecha igual o anterior (trigger `journal_entries_open_period`).
     */
    closedThrough: date('closed_through'),
    createdAt: createdAt(),
  },
  (t) => [
    index('companies_ruc_idx').on(t.ruc),
    check('companies_ruc_format', sql`${t.ruc} ~ '^(10|15|16|17|20)[0-9]{9}$'`),
  ],
);

/** Plan de cuentas de cada empresa (PCGE y las subcuentas que abra). */
export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: varchar('code', { length: 8 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    nature: accountNature('nature').notNull(),
    parentId: uuid('parent_id'),
    /** Las cuentas madre solo agrupan; los asientos van a las de detalle. */
    allowsPosting: boolean('allows_posting').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique('accounts_company_code_uq').on(t.companyId, t.code),
    // Para que las líneas exijan una cuenta de la misma empresa.
    unique('accounts_id_company_uq').on(t.id, t.companyId),
    // La cuenta madre es de la misma empresa.
    foreignKey({
      name: 'accounts_parent_fk',
      columns: [t.parentId, t.companyId],
      foreignColumns: [t.id, t.companyId],
    }),
    check('accounts_code_format', sql`${t.code} ~ '^[1-9][0-9]{1,7}$'`),
  ],
);

/**
 * Asiento del libro diario. El número es correlativo por empresa y
 * ejercicio. Que el debe y el haber cuadren lo revisa un trigger diferido al
 * confirmar la transacción (migración `journal_balance`).
 */
export const journalEntries = pgTable(
  'journal_entries',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    fiscalYear: smallint('fiscal_year').notNull(),
    number: integer('number').notNull(),
    entryDate: date('entry_date').notNull(),
    description: varchar('description', { length: 300 }).notNull(),
    /** Extorno: el asiento que este anula. Cada asiento se extorna una sola vez. */
    reversesEntryId: uuid('reverses_entry_id'),
    /** Quién lo registró. */
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('journal_entries_reverses_uq').on(t.reversesEntryId),
    // El asiento extornado es de la misma empresa.
    foreignKey({
      name: 'journal_entries_reverses_fk',
      columns: [t.reversesEntryId, t.companyId],
      foreignColumns: [t.id, t.companyId],
    }),
    unique('journal_entries_number_uq').on(t.companyId, t.fiscalYear, t.number),
    unique('journal_entries_id_company_uq').on(t.id, t.companyId),
    index('journal_entries_date_idx').on(t.companyId, t.entryDate),
    check('journal_entries_number_positive', sql`${t.number} > 0`),
    check('journal_entries_not_self_reversal', sql`${t.reversesEntryId} <> ${t.id}`),
    check('journal_entries_fiscal_year', sql`${t.fiscalYear} = extract(year from ${t.entryDate})`),
  ],
);

/** Línea del asiento, en céntimos: solo en el debe o solo en el haber. */
export const journalLines = pgTable(
  'journal_lines',
  {
    id: id(),
    entryId: uuid('entry_id').notNull(),
    companyId: uuid('company_id').notNull(),
    lineNo: smallint('line_no').notNull(),
    accountId: uuid('account_id').notNull(),
    debitCents: bigint('debit_cents', { mode: 'number' }).notNull().default(0),
    creditCents: bigint('credit_cents', { mode: 'number' }).notNull().default(0),
  },
  (t) => [
    foreignKey({
      name: 'journal_lines_entry_fk',
      columns: [t.entryId, t.companyId],
      foreignColumns: [journalEntries.id, journalEntries.companyId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'journal_lines_account_fk',
      columns: [t.accountId, t.companyId],
      foreignColumns: [accounts.id, accounts.companyId],
    }),
    unique('journal_lines_line_no_uq').on(t.entryId, t.lineNo),
    index('journal_lines_account_idx').on(t.accountId),
    check(
      'journal_lines_one_side',
      sql`(${t.debitCents} > 0 AND ${t.creditCents} = 0) OR (${t.creditCents} > 0 AND ${t.debitCents} = 0)`,
    ),
    check('journal_lines_line_no', sql`${t.lineNo} BETWEEN 1 AND 200`),
  ],
);

/** Historial de cierres y reaperturas: quién, cuándo, hasta qué fecha y por qué. */
export const periodClosings = pgTable(
  'period_closings',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    action: varchar('action', { length: 8 }).notNull(),
    /** Fecha de cierre antes y después del cambio (null: nada cerrado). */
    previousClosedThrough: date('previous_closed_through'),
    closedThrough: date('closed_through'),
    /** Reabrir exige decir por qué. */
    reason: varchar('reason', { length: 300 }),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('period_closings_company_idx').on(t.companyId, t.createdAt),
    check('period_closings_action', sql`${t.action} IN ('close', 'reopen')`),
    check('period_closings_reopen_reason', sql`${t.action} <> 'reopen' OR ${t.reason} IS NOT NULL`),
    check(
      'period_closings_close_date',
      sql`${t.action} <> 'close' OR ${t.closedThrough} IS NOT NULL`,
    ),
  ],
);
