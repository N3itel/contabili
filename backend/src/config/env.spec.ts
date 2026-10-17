import { validateEnv } from './env.js';

describe('variables de entorno', () => {
  it('exige NODE_ENV y DATABASE_URL', () => {
    expect(() => validateEnv({})).toThrow(/NODE_ENV/);
    expect(() => validateEnv({ NODE_ENV: 'test', DATABASE_URL: 'mysql://x' })).toThrow(/postgres/);
  });

  it('trata las claves vacías como no definidas', () => {
    const env = validateEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgres://x', PORT: '' });
    expect(env.PORT).toBe(3000);
  });
});
