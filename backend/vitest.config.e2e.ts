import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// En local toma DATABASE_URL de .env; en CI viene del entorno del job.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

// Pruebas e2e: usan PostgreSQL real (DATABASE_URL) con las migraciones aplicadas.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    fileParallelism: false,
    env: { NODE_ENV: 'test', SMS_PROVIDER: 'memory' },
  },
});
