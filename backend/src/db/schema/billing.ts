import { sql } from 'drizzle-orm';
import {
  check,
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
