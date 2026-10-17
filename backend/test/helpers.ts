import { randomInt } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { CODE_LIMITER } from '../src/auth/auth.controller.js';
import { type MemorySmsSender, SMS_SENDER } from '../src/auth/sms.js';
import { RateLimiter } from '../src/common/http.js';
import { DRIZZLE, type Database } from '../src/db/db.module.js';
import { API_PREFIX, PREFIX_EXCLUDE } from '../src/main-prefix.js';
import { rucCheckDigit } from '../src/tax/ruc.js';

type Agent = ReturnType<typeof request>;

export interface TestApp {
  app: INestApplication;
  /** La API: `t.http.get('/companies')` pide /api/v1/companies. */
  http: Pick<Agent, 'get' | 'post' | 'patch' | 'delete'>;
  /** Las páginas del sitio, sin prefijo. */
  web: Agent;
  sms: MemorySmsSender;
  db: Database;
}

/** App completa contra la base real, con SMS en memoria y sin tope por IP. */
export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CODE_LIMITER)
    .useValue(new RateLimiter(1_000_000, 3600_000))
    .compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix(API_PREFIX, { exclude: PREFIX_EXCLUDE });
  app.enableShutdownHooks();
  await app.init();
  const web = request(app.getHttpServer());
  const api = (path: string) => `/${API_PREFIX}${path}`;
  return {
    app,
    http: {
      get: (path: string) => web.get(api(path)),
      post: (path: string) => web.post(api(path)),
      patch: (path: string) => web.patch(api(path)),
      delete: (path: string) => web.delete(api(path)),
    },
    web,
    sms: app.get(SMS_SENDER),
    db: app.get(DRIZZLE),
  };
}

/** Celular peruano distinto en cada llamada. */
export function randomPhone(): string {
  return `+519${String(randomInt(0, 1e8)).padStart(8, '0')}`;
}

/** RUC de persona jurídica válido y distinto en cada llamada. */
export function randomRuc(): string {
  const first10 = `20${String(randomInt(0, 1e8)).padStart(8, '0')}`;
  return first10 + rucCheckDigit(first10);
}

export interface Person {
  userId: string;
  phone: string;
  token: string;
  refreshToken: string;
  /** Cabecera de autorización para supertest: `.set(person.auth)`. */
  auth: { Authorization: string };
}

/** Crea una cuenta con código por SMS y devuelve su sesión. */
export async function signUp(
  t: TestApp,
  phone = randomPhone(),
  fullName = 'Ana Pérez',
): Promise<Person> {
  await t.http.post('/auth/code').send({ phone }).expect(200);
  const code = t.sms.lastCodeFor(phone);
  const verified = await t.http.post('/auth/verify').send({ phone, code }).expect(200);
  const registered = await t.http
    .post('/auth/register')
    .send({
      registrationToken: verified.body.registrationToken,
      fullName,
      acceptTerms: true,
    })
    .expect(200);
  return {
    userId: registered.body.user.id,
    phone,
    token: registered.body.accessToken,
    refreshToken: registered.body.refreshToken,
    auth: { Authorization: `Bearer ${registered.body.accessToken}` },
  };
}

/** Crea una empresa con `owner` como dueño y devuelve su id. */
export async function createCompany(t: TestApp, owner: Person): Promise<string> {
  const res = await t.http
    .post('/companies')
    .set(owner.auth)
    .send({ ruc: randomRuc(), legalName: 'Bodega Prueba SAC', taxRegime: 'rmt' })
    .expect(201);
  return res.body.id;
}

/** Invita a `person` con `role` y la hace aceptar. */
export async function addMember(
  t: TestApp,
  companyId: string,
  owner: Person,
  person: Person,
  role: 'owner' | 'accountant' | 'viewer',
): Promise<void> {
  const invite = await t.http
    .post(`/companies/${companyId}/invitations`)
    .set(owner.auth)
    .send({ phone: person.phone, role })
    .expect(201);
  await t.http.post(`/invitations/${invite.body.id}/accept`).set(person.auth).expect(200);
}

/** Error de PostgreSQL detrás del de drizzle: restricción que saltó. */
export async function constraintOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (e) {
    const err = e as { constraint?: string; cause?: { constraint?: string } };
    return err.cause?.constraint ?? err.constraint;
  }
  throw new Error('Se esperaba un error de la base');
}
