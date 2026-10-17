import { eq } from 'drizzle-orm';
import { phoneVerifications, sessions, userConsents } from '../src/db/schema/index.js';
import { TERMS_VERSION } from '../src/users/consent.js';
import { createTestApp, randomPhone, signUp, type TestApp } from './helpers.js';

describe('ingreso con celular (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('toda ruta pide sesión salvo las públicas', async () => {
    const res = await t.http.get('/companies').expect(401);
    expect(res.body.code).toBe('unauthorized');
    await t.http.get('/me').set({ Authorization: 'Bearer basura' }).expect(401);
  });

  it('crea la cuenta con el código y guarda la aceptación de los términos', async () => {
    const person = await signUp(t);
    const me = await t.http.get('/me').set(person.auth).expect(200);
    expect(me.body).toMatchObject({
      phone: person.phone,
      fullName: 'Ana Pérez',
      terms: { version: TERMS_VERSION, accepted: true },
    });
    const consents = await t.db
      .select()
      .from(userConsents)
      .where(eq(userConsents.userId, person.userId));
    expect(consents).toHaveLength(1);
  });

  it('exige aceptar los términos para registrarse', async () => {
    const phone = randomPhone();
    await t.http.post('/auth/code').send({ phone }).expect(200);
    const verified = await t.http
      .post('/auth/verify')
      .send({ phone, code: t.sms.lastCodeFor(phone) })
      .expect(200);
    const res = await t.http
      .post('/auth/register')
      .send({ registrationToken: verified.body.registrationToken, fullName: 'Ana Pérez' })
      .expect(400);
    expect(res.body.code).toBe('invalid_request');
  });

  it('con cuenta, el código inicia sesión; un código errado gasta intentos', async () => {
    const person = await signUp(t);
    // Espera entre envíos: se adelanta la fecha del código anterior.
    await t.db
      .update(phoneVerifications)
      .set({ createdAt: new Date(Date.now() - 120_000) })
      .where(eq(phoneVerifications.phone, person.phone));
    await t.http.post('/auth/code').send({ phone: person.phone }).expect(200);
    const real = t.sms.lastCodeFor(person.phone);
    const bad = await t.http
      .post('/auth/verify')
      .send({ phone: person.phone, code: real === '000000' ? '111111' : '000000' })
      .expect(400);
    expect(bad.body).toMatchObject({ code: 'otp_invalid', attemptsLeft: 4 });
    const ok = await t.http
      .post('/auth/verify')
      .send({ phone: person.phone, code: t.sms.lastCodeFor(person.phone) })
      .expect(200);
    expect(ok.body).toMatchObject({ status: 'signed_in', user: { id: person.userId } });
  });

  it('respeta la espera entre códigos', async () => {
    const phone = randomPhone();
    await t.http.post('/auth/code').send({ phone }).expect(200);
    const res = await t.http.post('/auth/code').send({ phone }).expect(429);
    expect(res.body.code).toBe('otp_too_soon');
  });

  it('rota el refresh token y cierra todo si llega uno ya usado', async () => {
    const person = await signUp(t);
    const first = await t.http
      .post('/auth/refresh')
      .send({ refreshToken: person.refreshToken })
      .expect(200);
    // Reintento casi inmediato: no es robo.
    await t.http.post('/auth/refresh').send({ refreshToken: person.refreshToken }).expect(409);
    // Mucho después, el token viejo sí se trata como copiado.
    await t.db
      .update(sessions)
      .set({ revokedAt: new Date(Date.now() - 60_000) })
      .where(eq(sessions.userId, person.userId));
    const reused = await t.http
      .post('/auth/refresh')
      .send({ refreshToken: person.refreshToken })
      .expect(401);
    expect(reused.body.code).toBe('session_reused');
    await t.http
      .get('/me')
      .set({ Authorization: `Bearer ${first.body.accessToken}` })
      .expect(401);
  });

  it('cerrar sesión invalida el token de acceso al instante', async () => {
    const person = await signUp(t);
    await t.http.post('/auth/logout').set(person.auth).expect(204);
    await t.http.get('/me').set(person.auth).expect(401);
  });
});
