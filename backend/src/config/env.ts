import { z } from 'zod';

/** Solo para desarrollo y pruebas; en producción el secreto es obligatorio. */
export const DEV_JWT_SECRET = 'solo-para-desarrollo-no-usar-en-produccion-0123456789';

export const envSchema = z
  .object({
    /**
     * Obligatorio y sin valor por defecto: si faltara en un servidor, la app
     * arrancaría con los secretos de desarrollo, que están en el repositorio.
     */
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\//, 'debe empezar con postgres:// o postgresql://'),
    /** Balanceadores delante de la app: así la IP real llega a los topes por IP. */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

    /** Firma los tokens de acceso y el HMAC de los códigos por SMS. */
    AUTH_JWT_SECRET: z.string().min(32, 'debe tener al menos 32 caracteres').optional(),

    /** `console` escribe el código en el log (desarrollo); `memory` lo guarda para las pruebas. */
    SMS_PROVIDER: z.enum(['console', 'memory', 'twilio']).default('console'),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    /** Número o Messaging Service SID desde el que se envían los SMS. */
    TWILIO_FROM: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const prod = env.NODE_ENV === 'production';
    if (prod && !env.AUTH_JWT_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_JWT_SECRET'],
        message: 'es obligatorio en producción',
      });
    }
    if (prod && env.SMS_PROVIDER !== 'twilio') {
      ctx.addIssue({
        code: 'custom',
        path: ['SMS_PROVIDER'],
        message: 'en producción los códigos deben enviarse por un proveedor real',
      });
    }
    if (env.SMS_PROVIDER === 'twilio') {
      for (const key of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'falta para Twilio' });
      }
    }
  })
  .transform((env) => ({ ...env, AUTH_JWT_SECRET: env.AUTH_JWT_SECRET ?? DEV_JWT_SECRET }));

export type Env = z.infer<typeof envSchema>;

/** Valida las variables de entorno al arrancar; si falta algo, la app no inicia. */
export function validateEnv(config: Record<string, unknown>): Env {
  // `CLAVE=` vacía en .env cuenta como no definida (así funciona copiar .env.example).
  const defined = Object.fromEntries(Object.entries(config).filter(([, v]) => v !== ''));
  const parsed = envSchema.safeParse(defined);
  if (!parsed.success) {
    throw new Error(`Variables de entorno inválidas:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
