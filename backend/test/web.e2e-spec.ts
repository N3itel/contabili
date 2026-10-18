import { createHash } from 'node:crypto';
import { createTestApp, type TestApp } from './helpers.js';

const PAGES = ['/', '/precios', '/descargas', '/mi-plan', '/terminos', '/privacidad'];

describe('sitio público (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  it.each(PAGES)(
    '%s se sirve sin sesión, con CSP que coincide con su script y estilo',
    async (path) => {
      const res = await t.web.get(path).expect(200);
      expect(res.headers['content-type']).toContain('text/html');
      const csp = res.headers['content-security-policy'];
      expect(csp).toContain("default-src 'none'");
      // Los atributos style="" los bloquearía la CSP por hash.
      expect(res.text).not.toMatch(/\sstyle="/);
      const hash = (text: string) =>
        `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
      const style = res.text.match(/<style>([\s\S]*?)<\/style>/)![1];
      expect(csp).toContain(hash(style));
      const script = res.text.match(/<script>([\s\S]*?)<\/script>/);
      if (script) expect(csp).toContain(hash(script[1]));
    },
  );

  it('sirve sus propias letras, sin recursos de terceros', async () => {
    for (const file of ['saira.woff2', 'lexend.woff2']) {
      const res = await t.web.get(`/fonts/${file}`).expect(200);
      expect(res.headers['content-type']).toBe('font/woff2');
      expect(res.headers['cache-control']).toContain('immutable');
      // El archivo tal cual (un WOFF2 empieza con «wOF2»), no convertido a JSON.
      expect((res.body as Buffer).subarray(0, 4).toString('latin1')).toBe('wOF2');
      expect(Number(res.headers['content-length'])).toBe((res.body as Buffer).length);
    }
    await t.web.get('/fonts/otra.woff2').expect(404);
    await t.web.get('/fonts/constructor').expect(404);
    const home = await t.web.get('/').expect(200);
    expect(home.text).toContain('/fonts/saira.woff2');
  });

  it('los precios salen de los planes', async () => {
    const res = await t.web.get('/precios').expect(200);
    expect(res.text).toContain('S/ 25');
    expect(res.text).toContain('S/ 490');
    expect(res.text).toContain('30 días gratis');
  });

  it('la API queda bajo /api/v1 y el sitio fuera', async () => {
    await t.web.get('/api/v1/precios').expect(404);
    await t.web.get('/companies').expect(404);
    const config = await t.http.get('/app/config').expect(200);
    expect(config.body).toMatchObject({
      trialDays: 30,
      publicWebUrl: 'https://contabili.test',
      downloads: { windows: null, android: null },
    });
    expect(config.body.plans).toHaveLength(2);
  });
});
