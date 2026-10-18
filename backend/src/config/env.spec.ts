import { DEV_JWT_SECRET, validateEnv } from './env.js';

const base = { NODE_ENV: 'test', DATABASE_URL: 'postgres://x' };

describe('variables de entorno', () => {
  it('exige NODE_ENV y DATABASE_URL', () => {
    expect(() => validateEnv({})).toThrow(/NODE_ENV/);
    expect(() => validateEnv({ ...base, DATABASE_URL: 'mysql://x' })).toThrow(/postgres/);
  });

  it('trata las claves vacías como no definidas', () => {
    const env = validateEnv({ ...base, PORT: '', AUTH_JWT_SECRET: '' });
    expect(env.PORT).toBe(3000);
    expect(env.AUTH_JWT_SECRET).toBe(DEV_JWT_SECRET);
  });

  it('en producción exige secreto propio y SMS real', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(/AUTH_JWT_SECRET/);
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', AUTH_JWT_SECRET: 's'.repeat(40) }),
    ).toThrow(/SMS_PROVIDER/);
    expect(() => validateEnv({ ...base, SMS_PROVIDER: 'twilio' })).toThrow(/TWILIO_FROM/);
  });

  it('en producción cobra con Culqi con llaves de producción y por https', () => {
    const prod = {
      ...base,
      NODE_ENV: 'production',
      AUTH_JWT_SECRET: 's'.repeat(40),
      SMS_PROVIDER: 'twilio',
      TWILIO_ACCOUNT_SID: 'AC1',
      TWILIO_AUTH_TOKEN: 't',
      TWILIO_FROM: '+15550000000',
      PUBLIC_WEB_URL: 'https://contabili.pe',
      COMPANY_LEGAL_NAME: 'Contabili SAC',
      COMPANY_RUC: '20131312955',
      SUPPORT_EMAIL: 'soporte@contabili.pe',
      RECEIPTS_PROVIDER: 'nubefact',
      RECEIPTS_NUBEFACT_URL: 'https://api.nubefact.com/api/v1/abc-123',
      RECEIPTS_NUBEFACT_TOKEN: 'token-de-nubefact-123',
    };
    expect(() => validateEnv(prod)).toThrow(/PAYMENTS_PROVIDER/);
    const culqi = {
      ...prod,
      PAYMENTS_PROVIDER: 'culqi',
      CULQI_PUBLIC_KEY: 'pk_test_abc',
      CULQI_SECRET_KEY: 'sk_test_abc',
      CULQI_WEBHOOK_SECRET: 'w'.repeat(40),
    };
    expect(() => validateEnv(culqi)).toThrow(/producción/);
    expect(() => validateEnv({ ...culqi, PUBLIC_WEB_URL: 'http://contabili.pe' })).toThrow(/https/);
    expect(
      validateEnv({ ...culqi, CULQI_PUBLIC_KEY: 'pk_live_abc', CULQI_SECRET_KEY: 'sk_live_abc' })
        .PAYMENTS_PROVIDER,
    ).toBe('culqi');
  });

  it('en producción los comprobantes de las licencias salen por Nubefact', () => {
    const prod = {
      ...base,
      NODE_ENV: 'production',
      AUTH_JWT_SECRET: 's'.repeat(40),
      COMPANY_RUC: '20131312955',
    };
    expect(() => validateEnv(prod)).toThrow(/RECEIPTS_PROVIDER/);
    expect(() => validateEnv({ ...base, RECEIPTS_PROVIDER: 'nubefact' })).toThrow(
      /RECEIPTS_NUBEFACT_TOKEN/,
    );
    // Solo rutas de Nubefact: el servidor no llama a direcciones inventadas.
    expect(() =>
      validateEnv({ ...base, RECEIPTS_NUBEFACT_URL: 'https://169.254.169.254/latest' }),
    ).toThrow(/RUTA/);
    expect(validateEnv(base).RECEIPTS_SERIES).toBe('F001');
  });

  it('las descargas van por https', () => {
    expect(() => validateEnv({ ...base, DOWNLOAD_WINDOWS_URL: 'http://x.pe/a.exe' })).toThrow();
    expect(
      validateEnv({ ...base, DOWNLOAD_WINDOWS_URL: 'https://x.pe/a.exe' }).DOWNLOAD_WINDOWS_URL,
    ).toBe('https://x.pe/a.exe');
  });
});
