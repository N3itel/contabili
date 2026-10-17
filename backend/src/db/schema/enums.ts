import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Regímenes tributarios de SUNAT: Nuevo RUS, Régimen Especial, Régimen MYPE
 * Tributario y Régimen General. Deciden los libros que lleva la empresa.
 */
export const taxRegime = pgEnum('tax_regime', ['nrus', 'rer', 'rmt', 'general']);

/** Naturaleza de la cuenta: deudora (aumenta en el debe) o acreedora (en el haber). */
export const accountNature = pgEnum('account_nature', ['debit', 'credit']);
