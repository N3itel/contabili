import { z } from 'zod';

export const envSchema = z.object({
  /** Obligatorio: así un servidor nunca arranca creyéndose de desarrollo por descuido. */
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'debe empezar con postgres:// o postgresql://'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  // `CLAVE=` vacía en .env cuenta como no definida (así funciona copiar .env.example).
  const defined = Object.fromEntries(Object.entries(config).filter(([, v]) => v !== ''));
  const parsed = envSchema.safeParse(defined);
  if (!parsed.success) {
    throw new Error(`Variables de entorno inválidas:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
