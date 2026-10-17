import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/** Aplica las migraciones pendientes de ./drizzle. Uso: pnpm db:migrate */
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('Falta DATABASE_URL (copia .env.example a .env)');
}

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
const pool = new pg.Pool({ connectionString: url });

try {
  await migrate(drizzle(pool), { migrationsFolder });
  console.log('Migraciones aplicadas.');
} finally {
  await pool.end();
}
