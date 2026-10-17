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

/** Empresa que lleva su contabilidad en Contabili, identificada por su RUC. */
export const companies = pgTable(
  'companies',
  {
    id: id(),
    ruc: varchar('ruc', { length: 11 }).notNull().unique('companies_ruc_uq'),
    legalName: varchar('legal_name', { length: 200 }).notNull(),
    taxRegime: taxRegime('tax_regime').notNull(),
    createdAt: createdAt(),
  },
  (t) => [check('companies_ruc_format', sql`${t.ruc} ~ '^(10|15|16|17|20)[0-9]{9}$'`)],
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
    createdAt: createdAt(),
  },
  (t) => [
    unique('journal_entries_number_uq').on(t.companyId, t.fiscalYear, t.number),
    unique('journal_entries_id_company_uq').on(t.id, t.companyId),
    index('journal_entries_date_idx').on(t.companyId, t.entryDate),
    check('journal_entries_number_positive', sql`${t.number} > 0`),
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
