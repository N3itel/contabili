import { createTestApp, type TestApp } from './helpers.js';

describe('GET /health (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('responde 200 sin sesión si la base responde', async () => {
    const res = await t.http.get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', database: 'ok' });
  });
});
