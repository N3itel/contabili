import { defineConfig } from 'vitest/config';

// Pruebas unitarias: rápidas, sin base de datos.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
  },
});
