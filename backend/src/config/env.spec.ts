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
});
