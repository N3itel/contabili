/**
 * Nombre de la restricción única que violó un INSERT/UPDATE (código 23505),
 * o null si el error es otro. drizzle a veces envuelve el error de `pg` en `cause`.
 */
export function uniqueViolation(error: unknown): string | null {
  for (const e of [error, (error as { cause?: unknown })?.cause]) {
    const pg = e as { code?: string; constraint?: string } | undefined;
    if (pg?.code === '23505') return pg.constraint ?? '';
  }
  return null;
}
