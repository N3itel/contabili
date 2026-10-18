import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgTable,
  smallint,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { companies } from './accounting.js';
import { createdAt, id, ts, updatedAt } from './columns.js';
import { orderStatus } from './enums.js';
import { users } from './users.js';

/**
 * Licencia de cada empresa: nace con la prueba gratis y se extiende con cada
 * pago. Vencida, la empresa queda en solo lectura (nunca se pierden los datos).
 */
export const companyLicenses = pgTable(
  'company_licenses',
  {
    companyId: uuid('company_id')
      .primaryKey()
      .references(() => companies.id),
    plan: varchar('plan', { length: 16 }).notNull(),
    trialEndsAt: ts('trial_ends_at').notNull(),
    /** Fin del último periodo pagado. */
    paidThrough: ts('paid_through'),
    updatedAt: updatedAt(),
  },
  (t) => [check('company_licenses_plan', sql`${t.plan} IN ('emprendedor', 'negocio')`)],
);

/**
 * Órdenes de pago de una licencia. El monto lo fija el servidor según el plan
 * y el ciclo; la licencia se extiende solo cuando el proveedor confirma el
 * cargo, una sola vez por orden y por cargo.
 */
export const licenseOrders = pgTable(
  'license_orders',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    plan: varchar('plan', { length: 16 }).notNull(),
    cycle: varchar('cycle', { length: 8 }).notNull(),
    amountCents: integer('amount_cents').notNull(),
    /** `culqi` en producción; `fake` en desarrollo y pruebas. */
    provider: varchar('provider', { length: 8 }).notNull(),
    status: orderStatus('status').notNull().default('pending'),
    /** Intentos de cobro (tarjeta rechazada); la verificación 3DS no gasta intento. */
    attempts: smallint('attempts').notNull().default(0),
    providerChargeId: varchar('provider_charge_id', { length: 64 }),
    failureCode: varchar('failure_code', { length: 40 }),
    failureMessage: varchar('failure_message', { length: 200 }),
    expiresAt: ts('expires_at').notNull(),
    chargingSince: ts('charging_since'),
    paidAt: ts('paid_at'),
    /** El periodo que pagó, para el historial y el comprobante. */
    periodStart: ts('period_start'),
    periodEnd: ts('period_end'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('license_orders_company_idx').on(t.companyId, t.createdAt),
    index('license_orders_open_idx')
      .on(t.status, t.createdAt)
      .where(sql`${t.status} IN ('pending', 'charging')`),
    // Un cargo del proveedor paga una sola orden.
    uniqueIndex('license_orders_charge_uq').on(t.providerChargeId),
    check('license_orders_plan', sql`${t.plan} IN ('emprendedor', 'negocio')`),
    check('license_orders_cycle', sql`${t.cycle} IN ('monthly', 'annual')`),
    check('license_orders_provider', sql`${t.provider} IN ('culqi', 'fake')`),
    // En soles enteros y con tope: nadie cobra de más por un error de código.
    check(
      'license_orders_amount',
      sql`${t.amountCents} BETWEEN 100 AND 500000 AND ${t.amountCents} % 100 = 0`,
    ),
    check('license_orders_attempts', sql`${t.attempts} BETWEEN 0 AND 4`),
    check(
      'license_orders_paid_fields',
      sql`(${t.status} = 'paid') = (${t.paidAt} IS NOT NULL AND ${t.providerChargeId} IS NOT NULL AND ${t.periodEnd} IS NOT NULL)`,
    ),
    check(
      'license_orders_charging_since',
      sql`${t.status} <> 'charging' OR ${t.chargingSince} IS NOT NULL`,
    ),
  ],
);

/**
 * Avisos por SMS de que vence (o venció) la prueba o el plan. Uno por empresa,
 * tipo y fecha de vencimiento: aunque corran varias instancias, sale una vez.
 */
export const licenseReminders = pgTable(
  'license_reminders',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    /** `ending`: faltan pocos días; `ended`: ya venció. */
    kind: varchar('kind', { length: 8 }).notNull(),
    endsAt: ts('ends_at').notNull(),
    /** A cuántos dueños se les mandó. */
    recipients: smallint('recipients').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('license_reminders_once_uq').on(t.companyId, t.kind, t.endsAt),
    check('license_reminders_kind', sql`${t.kind} IN ('ending', 'ended')`),
    check('license_reminders_recipients', sql`${t.recipients} BETWEEN 0 AND 3`),
  ],
);

/**
 * Comprobante electrónico (factura) de cada pago de licencia: lo emite quien
 * vende Contabili al RUC de la empresa. Se encola en la misma transacción
 * que marca la orden pagada (uno por orden) y se emite después: el número
 * se reserva al mandarlo y, si el proveedor no lo creó, se libera y se
 * reintenta.
 */
export const licenseReceipts = pgTable(
  'license_receipts',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => licenseOrders.id),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    /** `queued`: espera turno (sin número); `pending`: enviado sin respuesta de SUNAT. */
    status: varchar('status', { length: 10 }).notNull().default('queued'),
    provider: varchar('provider', { length: 16 }).notNull(),
    series: varchar('series', { length: 4 }),
    number: integer('number'),
    issueDate: date('issue_date'),
    customerRuc: varchar('customer_ruc', { length: 11 }).notNull(),
    customerName: varchar('customer_name', { length: 200 }).notNull(),
    description: varchar('description', { length: 250 }).notNull(),
    baseCents: bigint('base_cents', { mode: 'number' }).notNull(),
    igvCents: bigint('igv_cents', { mode: 'number' }).notNull(),
    totalCents: bigint('total_cents', { mode: 'number' }).notNull(),
    /** Intentos en que el proveedor no lo creó. */
    attempts: smallint('attempts').notNull().default(0),
    statusMessage: varchar('status_message', { length: 500 }),
    pdfUrl: varchar('pdf_url', { length: 500 }),
    hash: varchar('hash', { length: 120 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('license_receipts_order_uq').on(t.orderId),
    uniqueIndex('license_receipts_number_uq').on(t.series, t.number),
    index('license_receipts_company_idx').on(t.companyId, t.createdAt),
    index('license_receipts_open_idx')
      .on(t.status, t.createdAt)
      .where(sql`${t.status} IN ('queued', 'pending')`),
    check(
      'license_receipts_status',
      sql`${t.status} IN ('queued', 'pending', 'accepted', 'rejected', 'test')`,
    ),
    check('license_receipts_provider', sql`${t.provider} IN ('test', 'nubefact')`),
    // En cola, sin número; desde que se manda, con serie, número y fecha.
    check(
      'license_receipts_number',
      sql`(${t.status} = 'queued') = (${t.number} IS NULL) AND (${t.number} IS NULL) = (${t.series} IS NULL) AND (${t.number} IS NULL) = (${t.issueDate} IS NULL) AND (${t.series} IS NULL OR ${t.series} ~ '^F[A-Z0-9]{3}$') AND (${t.number} IS NULL OR ${t.number} BETWEEN 1 AND 99999999)`,
    ),
    check('license_receipts_ruc', sql`${t.customerRuc} ~ '^(10|15|16|17|20)[0-9]{9}$'`),
    check(
      'license_receipts_amounts',
      sql`${t.baseCents} >= 0 AND ${t.igvCents} >= 0 AND ${t.baseCents} + ${t.igvCents} = ${t.totalCents} AND ${t.totalCents} > 0`,
    ),
    check('license_receipts_attempts', sql`${t.attempts} BETWEEN 0 AND 50`),
  ],
);
