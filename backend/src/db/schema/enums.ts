import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Regímenes tributarios de SUNAT: Nuevo RUS, Régimen Especial, Régimen MYPE
 * Tributario y Régimen General. Deciden los libros que lleva la empresa.
 */
export const taxRegime = pgEnum('tax_regime', ['nrus', 'rer', 'rmt', 'general']);

/** Naturaleza de la cuenta: deudora (aumenta en el debe) o acreedora (en el haber). */
export const accountNature = pgEnum('account_nature', ['debit', 'credit']);

export const userStatus = pgEnum('user_status', ['active', 'blocked']);

/**
 * Qué puede hacer cada persona en una empresa: `owner` todo, incluido quién
 * entra; `accountant` registra cuentas y asientos; `viewer` solo consulta.
 */
export const memberRole = pgEnum('member_role', ['owner', 'accountant', 'viewer']);

export const invitationStatus = pgEnum('invitation_status', [
  'pending',
  'accepted',
  'declined',
  'revoked',
  'expired',
]);
