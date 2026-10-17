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

    /** Dirección pública del sitio (enlaces de pago). En producción, https. */
    PUBLIC_WEB_URL: z
      .url()
      .default('http://localhost:3000')
      .transform((url) => url.replace(/\/+$/, '')),

    /**
     * Cobro de las licencias. `fake`: la página de pago tiene botones de
     * prueba (desarrollo); `culqi`: tarjeta y Yape con Culqi.
     */
    PAYMENTS_PROVIDER: z.enum(['fake', 'culqi']).default('fake'),
    CULQI_PUBLIC_KEY: z
      .string()
      .regex(/^pk_(live|test)_[A-Za-z0-9]+$/, 'debe empezar con pk_live_ o pk_test_')
      .optional(),
    CULQI_SECRET_KEY: z
      .string()
      .regex(/^sk_(live|test)_[A-Za-z0-9]+$/, 'debe empezar con sk_live_ o sk_test_')
      .optional(),
    /** Va al final de la dirección del webhook en CulqiPanel: …/payments/culqi/webhook/<secreto>. */
    CULQI_WEBHOOK_SECRET: z.string().min(32, 'debe tener al menos 32 caracteres').optional(),

    /** Datos de quien vende Contabili, para el sitio y los términos. */
    COMPANY_LEGAL_NAME: z.string().min(3).max(200).optional(),
    COMPANY_RUC: z
      .string()
      .regex(/^\d{11}$/)
      .optional(),
    SUPPORT_EMAIL: z.email().optional(),

    /**
     * Descargas que muestra /descargas: solo aparecen las configuradas.
     * Instaladores del programa de escritorio y enlaces a las tiendas.
     */
    DESKTOP_VERSION: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/)
      .optional(),
    DOWNLOAD_WINDOWS_URL: z.url({ protocol: /^https$/ }).optional(),
    DOWNLOAD_MACOS_URL: z.url({ protocol: /^https$/ }).optional(),
    DOWNLOAD_LINUX_URL: z.url({ protocol: /^https$/ }).optional(),
    APP_ANDROID_URL: z.url({ protocol: /^https$/ }).optional(),
    APP_IOS_URL: z.url({ protocol: /^https$/ }).optional(),
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
    if (prod && !env.PUBLIC_WEB_URL.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['PUBLIC_WEB_URL'],
        message: 'en producción el sitio va por https',
      });
    }
    if (prod && env.PAYMENTS_PROVIDER !== 'culqi') {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENTS_PROVIDER'],
        message: 'en producción las licencias se cobran con Culqi',
      });
    }
    if (prod) {
      for (const key of ['COMPANY_LEGAL_NAME', 'COMPANY_RUC', 'SUPPORT_EMAIL'] as const) {
        if (!env[key]) {
          ctx.addIssue({ code: 'custom', path: [key], message: 'es obligatorio en producción' });
        }
      }
    }
    if (env.PAYMENTS_PROVIDER === 'culqi') {
      for (const key of ['CULQI_PUBLIC_KEY', 'CULQI_SECRET_KEY', 'CULQI_WEBHOOK_SECRET'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'falta para Culqi' });
      }
      const mode = (key?: string) => key?.split('_')[1];
      // En producción, con llaves de prueba las tarjetas de prueba activarían licencias reales.
      if (
        prod &&
        (mode(env.CULQI_PUBLIC_KEY) === 'test' || mode(env.CULQI_SECRET_KEY) === 'test')
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['CULQI_SECRET_KEY'],
          message: 'en producción las llaves de Culqi son las de producción (pk_live_/sk_live_)',
        });
      }
      if (
        env.CULQI_PUBLIC_KEY &&
        env.CULQI_SECRET_KEY &&
        mode(env.CULQI_PUBLIC_KEY) !== mode(env.CULQI_SECRET_KEY)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['CULQI_SECRET_KEY'],
          message: 'las dos llaves deben ser de prueba o las dos de producción',
        });
      }
    }
    if (env.SMS_PROVIDER === 'twilio') {
      for (const key of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'falta para Twilio' });
      }
    }
  })
  .transform((env) => ({
    ...env,
    AUTH_JWT_SECRET: env.AUTH_JWT_SECRET ?? DEV_JWT_SECRET,
    // Solo en desarrollo y pruebas: en producción son obligatorios.
    COMPANY_LEGAL_NAME: env.COMPANY_LEGAL_NAME ?? 'Contabili (empresa en constitución)',
    SUPPORT_EMAIL: env.SUPPORT_EMAIL ?? 'soporte@contabili.pe',
  }));

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
