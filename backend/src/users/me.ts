import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/db.module.js';
import { userConsents, users } from '../db/schema/index.js';
import { TERMS_VERSION } from './consent.js';

/** Lo que las apps saben del usuario con sesión iniciada. */
export interface MeDto {
  id: string;
  phone: string;
  fullName: string;
  email: string | null;
  /** Si `accepted` es falso, la app pide aceptar la versión vigente antes de seguir. */
  terms: { version: string; accepted: boolean };
}

export async function loadMe(db: Database, userId: string): Promise<MeDto | null> {
  const [row] = await db
    .select({
      id: users.id,
      phone: users.phone,
      fullName: users.fullName,
      email: users.email,
      termsAcceptedAt: userConsents.acceptedAt,
    })
    .from(users)
    .leftJoin(
      userConsents,
      and(
        eq(userConsents.userId, users.id),
        eq(userConsents.document, 'terms'),
        eq(userConsents.version, TERMS_VERSION),
      ),
    )
    .where(eq(users.id, userId));
  if (!row) return null;
  return {
    id: row.id,
    phone: row.phone,
    fullName: row.fullName,
    email: row.email,
    terms: { version: TERMS_VERSION, accepted: row.termsAcceptedAt !== null },
  };
}
