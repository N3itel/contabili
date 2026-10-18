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
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, ts } from './columns.js';
import { accountNature, contactKind, documentDirection, taxRegime } from './enums.js';
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
    /**
     * De dónde salió: `manual` (asiento del contador) o la operación fácil que
     * lo armó. Distingue, por ejemplo, un pago de IGV a SUNAT de una compra.
     */
    source: varchar('source', { length: 16 }).notNull().default('manual'),
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
    check(
      'journal_entries_source',
      sql`${t.source} IN ('manual', 'sale', 'expense', 'collection', 'payment', 'tax_payment', 'reversal')`,
    ),
    check('journal_entries_fiscal_year', sql`${t.fiscalYear} = extract(year from ${t.entryDate})`),
  ],
);

/**
 * Clientes y proveedores de la empresa. Se ligan a las líneas de por cobrar
 * (12) y por pagar (42) para saber quién debe cuánto. Solo se guarda el RUC
 * (de empresas); de las personas, el nombre.
 */
export const contacts = pgTable(
  'contacts',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    kind: contactKind('kind').notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    ruc: varchar('ruc', { length: 11 }),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('contacts_id_company_uq').on(t.id, t.companyId),
    // Un mismo RUC una sola vez como cliente y una como proveedor.
    uniqueIndex('contacts_ruc_uq')
      .on(t.companyId, t.kind, t.ruc)
      .where(sql`${t.ruc} IS NOT NULL`),
    index('contacts_company_idx').on(t.companyId, t.kind, t.name),
    check('contacts_ruc_format', sql`${t.ruc} IS NULL OR ${t.ruc} ~ '^(10|15|16|17|20)[0-9]{9}$'`),
    check('contacts_name_length', sql`char_length(${t.name}) >= 2`),
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
    /** Cliente o proveedor de la línea (por cobrar o por pagar), si lo hay. */
    contactId: uuid('contact_id'),
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
    // El cliente o proveedor es de la misma empresa.
    foreignKey({
      name: 'journal_lines_contact_fk',
      columns: [t.contactId, t.companyId],
      foreignColumns: [contacts.id, contacts.companyId],
    }),
    index('journal_lines_contact_idx').on(t.contactId),
    unique('journal_lines_line_no_uq').on(t.entryId, t.lineNo),
    index('journal_lines_account_idx').on(t.accountId),
    check(
      'journal_lines_one_side',
      sql`(${t.debitCents} > 0 AND ${t.creditCents} = 0) OR (${t.creditCents} > 0 AND ${t.debitCents} = 0)`,
    ),
    check('journal_lines_line_no', sql`${t.lineNo} BETWEEN 1 AND 200`),
  ],
);

/**
 * Comprobante de pago de una venta o de un gasto: arma los registros de
 * ventas y de compras. Va uno por asiento y, como el asiento, no se edita
 * ni se borra (trigger `documents_immutable`); si el asiento se extorna, el
 * comprobante figura como anulado.
 */
export const documents = pgTable(
  'documents',
  {
    id: id(),
    companyId: uuid('company_id').notNull(),
    entryId: uuid('entry_id').notNull(),
    direction: documentDirection('direction').notNull(),
    /**
     * Tabla 10 de SUNAT: 01 factura, 03 boleta, 02 recibo por honorarios,
     * 12 ticket, 00 otro y 07 nota de crédito (solo electrónica, va en el
     * extorno de la venta que anula).
     */
    docType: varchar('doc_type', { length: 2 }).notNull(),
    series: varchar('series', { length: 20 }).notNull(),
    number: integer('number').notNull(),
    issueDate: date('issue_date').notNull(),
    counterpartyRuc: varchar('counterparty_ruc', { length: 11 }),
    counterpartyName: varchar('counterparty_name', { length: 120 }),
    baseCents: bigint('base_cents', { mode: 'number' }).notNull(),
    igvCents: bigint('igv_cents', { mode: 'number' }).notNull(),
    totalCents: bigint('total_cents', { mode: 'number' }).notNull(),
    /** Nota de crédito: el comprobante que modifica. */
    modifiedDocType: varchar('modified_doc_type', { length: 2 }),
    modifiedSeries: varchar('modified_series', { length: 20 }),
    modifiedNumber: integer('modified_number'),
    modifiedIssueDate: date('modified_issue_date'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'documents_entry_fk',
      columns: [t.entryId, t.companyId],
      foreignColumns: [journalEntries.id, journalEntries.companyId],
    }),
    unique('documents_entry_uq').on(t.entryId),
    // La empresa no repite un número de su propia serie.
    uniqueIndex('documents_sale_uq')
      .on(t.companyId, t.docType, t.series, t.number)
      .where(sql`${t.direction} = 'sale'`),
    // El mismo comprobante de un proveedor no se registra dos veces.
    uniqueIndex('documents_purchase_uq')
      .on(t.companyId, t.docType, t.series, t.number, t.counterpartyRuc)
      .where(sql`${t.direction} = 'purchase'`),
    index('documents_register_idx').on(t.companyId, t.direction, t.issueDate),
    check('documents_doc_type', sql`${t.docType} IN ('01', '02', '03', '12', '00', '07')`),
    check('documents_recibo_purchase', sql`${t.docType} <> '02' OR ${t.direction} = 'purchase'`),
    check(
      'documents_ruc_required',
      sql`(${t.docType} NOT IN ('01', '02') AND ${t.modifiedDocType} IS DISTINCT FROM '01') OR ${t.counterpartyRuc} IS NOT NULL`,
    ),
    // La nota de crédito es de venta y siempre dice qué boleta o factura modifica.
    check(
      'documents_credit_note',
      sql`(${t.docType} = '07') = (${t.modifiedDocType} IS NOT NULL) AND (${t.docType} <> '07' OR (${t.direction} = 'sale' AND ${t.modifiedDocType} IN ('01', '03') AND ${t.modifiedSeries} IS NOT NULL AND ${t.modifiedNumber} IS NOT NULL AND ${t.modifiedIssueDate} IS NOT NULL))`,
    ),
    check(
      'documents_ruc_format',
      sql`${t.counterpartyRuc} IS NULL OR ${t.counterpartyRuc} ~ '^(10|15|16|17|20)[0-9]{9}$'`,
    ),
    check('documents_series_format', sql`${t.series} ~ '^[A-Z0-9-]{1,20}$'`),
    check('documents_number_range', sql`${t.number} BETWEEN 1 AND 99999999`),
    check(
      'documents_amounts',
      sql`${t.baseCents} >= 0 AND ${t.igvCents} >= 0 AND ${t.baseCents} + ${t.igvCents} = ${t.totalCents} AND ${t.totalCents} > 0`,
    ),
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
