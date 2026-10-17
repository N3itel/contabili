import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  smallint,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, ts, updatedAt } from './columns.js';
import { userStatus } from './enums.js';

/** Cada persona que usa Contabili; entra con su celular. */
export const users = pgTable('users', {
  id: id(),
  /** Formato E.164, por ejemplo +51987654321. */
  phone: varchar('phone', { length: 16 }).notNull().unique('users_phone_uq'),
  phoneVerifiedAt: ts('phone_verified_at'),
  fullName: varchar('full_name', { length: 120 }).notNull(),
  email: varchar('email', { length: 254 }),
  status: userStatus('status').notNull().default('active'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Aceptaciones de los términos y la política de privacidad, con la versión
 * que la persona aceptó (Ley 29733: el consentimiento debe poder probarse).
 */
export const userConsents = pgTable(
  'user_consents',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    document: varchar('document', { length: 16 }).notNull(),
    version: varchar('version', { length: 20 }).notNull(),
    acceptedAt: ts('accepted_at').notNull().defaultNow(),
  },
  (t) => [
    unique('user_consents_once_uq').on(t.userId, t.document, t.version),
    check('user_consents_document', sql`${t.document} IN ('terms')`),
  ],
);

/**
 * Códigos enviados por SMS para iniciar sesión. Solo se guarda el HMAC del
 * código: quien lea la base no puede usarlos.
 */
export const phoneVerifications = pgTable(
  'phone_verifications',
  {
    id: id(),
    phone: varchar('phone', { length: 16 }).notNull(),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    attempts: smallint('attempts').notNull().default(0),
    expiresAt: ts('expires_at').notNull(),
    consumedAt: ts('consumed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('phone_verifications_phone_idx').on(t.phone, t.createdAt),
    check('phone_verifications_attempts_check', sql`${t.attempts} between 0 and 5`),
  ],
);

/**
 * Una sesión por dispositivo. El refresh token rota en cada uso; si llega uno
 * ya rotado, alguien lo copió y se cierran todas las sesiones del usuario.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 del refresh token; el token en claro solo lo tiene el dispositivo. */
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique('sessions_token_hash_uq'),
    deviceName: varchar('device_name', { length: 80 }),
    expiresAt: ts('expires_at').notNull(),
    lastUsedAt: ts('last_used_at'),
    revokedAt: ts('revoked_at'),
    /** Sesión que la reemplazó al rotar el token. */
    replacedById: uuid('replaced_by_id'),
    /** Cuándo se ingresó el código que abrió la sesión; se conserva al rotar. */
    authenticatedAt: ts('authenticated_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/** Registro de acciones sensibles (quién entra a una empresa, cambios de rol, extornos). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    actorId: uuid('actor_id').references(() => users.id),
    action: varchar('action', { length: 60 }).notNull(),
    entity: varchar('entity', { length: 60 }).notNull(),
    entityId: varchar('entity_id', { length: 64 }).notNull(),
    data: jsonb('data'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_entity_idx').on(t.entity, t.entityId)],
);
