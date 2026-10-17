import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { rucCheckDigit } from '../src/tax/ruc.js';

/** App completa contra la base real (DATABASE_URL con las migraciones aplicadas). */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.enableShutdownHooks();
  await app.init();
  return app;
}

/** RUC de persona jurídica válido y distinto en cada llamada. */
export function randomRuc(): string {
  const first10 = '20' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
  return first10 + rucCheckDigit(first10);
}
