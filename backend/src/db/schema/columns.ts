import { timestamp, uuid } from 'drizzle-orm/pg-core';

export const id = () => uuid('id').primaryKey().defaultRandom();

/** Siempre con zona horaria: la fecha de negocio se calcula en Lima con `limaDate()`. */
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const createdAt = () => ts('created_at').notNull().defaultNow();
