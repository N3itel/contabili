import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { companies, contacts, journalEntries } from './accounting.js';
import { createdAt, id, updatedAt } from './columns.js';
import { users } from './users.js';

/**
 * Facturación electrónica de cada empresa (beta): con qué proveedor emite y
 * sus series. El token del proveedor se guarda cifrado (`FieldCipher`) y
 * nunca vuelve a la app.
 */
export const einvoiceSettings = pgTable(
  'einvoice_settings',
  {
    companyId: uuid('company_id')
      .primaryKey()
      .references(() => companies.id),
    /** `test`: no manda nada a SUNAT; `nubefact`: la cuenta de la empresa en Nubefact. */
    provider: varchar('provider', { length: 16 }).notNull(),
    facturaSeries: varchar('factura_series', { length: 4 }).notNull(),
    boletaSeries: varchar('boleta_series', { length: 4 }).notNull(),
    endpoint: varchar('endpoint', { length: 300 }),
    tokenEncrypted: varchar('token_encrypted', { length: 500 }),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('einvoice_settings_provider', sql`${t.provider} IN ('test', 'nubefact')`),
    check('einvoice_settings_factura_series', sql`${t.facturaSeries} ~ '^F[A-Z0-9]{3}$'`),
    check('einvoice_settings_boleta_series', sql`${t.boletaSeries} ~ '^B[A-Z0-9]{3}$'`),
    check(
      'einvoice_settings_nubefact_credentials',
      sql`${t.provider} <> 'nubefact' OR (${t.endpoint} IS NOT NULL AND ${t.tokenEncrypted} IS NOT NULL)`,
    ),
  ],
);

/**
 * Boletas y facturas electrónicas emitidas. El número es correlativo por
 * serie (índice único) y se reserva antes de mandarlo al proveedor. Cuando
 * el comprobante sale, se anota la venta y queda ligado a su asiento.
 */
export const einvoices = pgTable(
  'einvoices',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    docType: varchar('doc_type', { length: 2 }).notNull(),
    series: varchar('series', { length: 4 }).notNull(),
    number: integer('number').notNull(),
    issueDate: date('issue_date').notNull(),
    provider: varchar('provider', { length: 16 }).notNull(),
    /** Venta: de productos o de servicios, y cómo se pagó (para anotarla). */
    saleKind: varchar('sale_kind', { length: 8 }).notNull(),
    paidWith: varchar('paid_with', { length: 8 }).notNull(),
    contactId: uuid('contact_id'),
    customerDocType: varchar('customer_doc_type', { length: 4 }).notNull(),
    customerDocNumber: varchar('customer_doc_number', { length: 11 }),
    customerName: varchar('customer_name', { length: 120 }),
    description: varchar('description', { length: 250 }).notNull(),
    baseCents: bigint('base_cents', { mode: 'number' }).notNull(),
    igvCents: bigint('igv_cents', { mode: 'number' }).notNull(),
    totalCents: bigint('total_cents', { mode: 'number' }).notNull(),
    status: varchar('status', { length: 10 }).notNull(),
    statusMessage: varchar('status_message', { length: 500 }),
    pdfUrl: varchar('pdf_url', { length: 500 }),
    xmlUrl: varchar('xml_url', { length: 500 }),
    cdrUrl: varchar('cdr_url', { length: 500 }),
    hash: varchar('hash', { length: 120 }),
    /** Asiento de la venta, cuando ya se anotó. */
    entryId: uuid('entry_id'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('einvoices_number_uq').on(t.companyId, t.docType, t.series, t.number),
    unique('einvoices_entry_uq').on(t.entryId),
    foreignKey({
      name: 'einvoices_entry_fk',
      columns: [t.entryId, t.companyId],
      foreignColumns: [journalEntries.id, journalEntries.companyId],
    }),
    // El cliente (ventas al crédito) es de la misma empresa.
    foreignKey({
      name: 'einvoices_contact_fk',
      columns: [t.contactId, t.companyId],
      foreignColumns: [contacts.id, contacts.companyId],
    }),
    index('einvoices_company_date_idx').on(t.companyId, t.issueDate),
    check('einvoices_doc_type', sql`${t.docType} IN ('01', '03')`),
    check(
      'einvoices_series',
      sql`(${t.docType} = '01' AND ${t.series} ~ '^F[A-Z0-9]{3}$') OR (${t.docType} = '03' AND ${t.series} ~ '^B[A-Z0-9]{3}$')`,
    ),
    check('einvoices_number_range', sql`${t.number} BETWEEN 1 AND 99999999`),
    check('einvoices_provider', sql`${t.provider} IN ('test', 'nubefact')`),
    check('einvoices_status', sql`${t.status} IN ('pending', 'accepted', 'rejected', 'test')`),
    check('einvoices_sale_kind', sql`${t.saleKind} IN ('goods', 'services')`),
    check('einvoices_paid_with', sql`${t.paidWith} IN ('cash', 'bank', 'credit')`),
    check('einvoices_customer_doc_type', sql`${t.customerDocType} IN ('ruc', 'dni', 'none')`),
    // Una factura siempre va a un RUC; una boleta de más de S/ 700, identificada.
    check(
      'einvoices_customer',
      sql`(${t.docType} <> '01' OR ${t.customerDocType} = 'ruc') AND (${t.customerDocType} = 'none' OR (${t.customerDocNumber} IS NOT NULL AND ${t.customerName} IS NOT NULL)) AND (${t.docType} <> '03' OR ${t.customerDocType} <> 'none' OR ${t.totalCents} <= 70000)`,
    ),
    check(
      'einvoices_amounts',
      sql`${t.baseCents} >= 0 AND ${t.igvCents} >= 0 AND ${t.baseCents} + ${t.igvCents} = ${t.totalCents} AND ${t.totalCents} > 0`,
    ),
    // Solo se anota la venta de un comprobante que salió (o de prueba).
    check(
      'einvoices_entry_status',
      sql`${t.entryId} IS NULL OR ${t.status} IN ('accepted', 'test')`,
    ),
  ],
);
