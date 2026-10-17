import type { Database } from '../db/db.module.js';
import { auditLog } from '../db/schema/index.js';

/** Transacción de drizzle o la conexión normal: ambas sirven para escribir. */
type Writer = Pick<Database, 'insert'>;

/**
 * Deja constancia de una acción sensible (aprobar, rechazar, bloquear).
 * `data` nunca lleva DNI, teléfonos ni ubicaciones.
 */
export async function audit(
  db: Writer,
  entry: {
    actorId: string | null;
    action: string;
    entity: string;
    entityId: string;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(auditLog).values({ ...entry, data: entry.data ?? null });
}
