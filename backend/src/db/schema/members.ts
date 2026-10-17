import { sql } from 'drizzle-orm';
import { check, index, pgTable, primaryKey, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { companies } from './accounting.js';
import { createdAt, id, ts } from './columns.js';
import { invitationStatus, memberRole } from './enums.js';
import { users } from './users.js';

/**
 * Quién trabaja en cada empresa y con qué rol. Siempre queda al menos un
 * `owner` (trigger diferido `company_members_has_owner`).
 */
export const companyMembers = pgTable(
  'company_members',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: memberRole('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'company_members_pk', columns: [t.companyId, t.userId] }),
    index('company_members_user_idx').on(t.userId),
  ],
);

/**
 * Invitaciones a una empresa, por celular. Nadie entra a una empresa sin
 * aceptar: la persona ve la invitación al ingresar con ese número.
 */
export const companyInvitations = pgTable(
  'company_invitations',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    /** Formato E.164. */
    phone: varchar('phone', { length: 16 }).notNull(),
    role: memberRole('role').notNull(),
    status: invitationStatus('status').notNull().default('pending'),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id),
    expiresAt: ts('expires_at').notNull(),
    /** Quién la aceptó, rechazó o revocó, y cuándo. */
    resolvedBy: uuid('resolved_by').references(() => users.id),
    resolvedAt: ts('resolved_at'),
    createdAt: createdAt(),
  },
  (t) => [
    // Una invitación pendiente por número y empresa.
    uniqueIndex('company_invitations_pending_uq')
      .on(t.companyId, t.phone)
      .where(sql`${t.status} = 'pending'`),
    index('company_invitations_phone_idx').on(t.phone, t.status),
    check(
      'company_invitations_resolved',
      sql`(${t.status} = 'pending') = (${t.resolvedAt} IS NULL)`,
    ),
  ],
);
