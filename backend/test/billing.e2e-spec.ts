import { eq } from 'drizzle-orm';
import { FakePaymentProvider, PAYMENT_PROVIDER } from '../src/billing/payments.js';
import { addMonths } from '../src/billing/plans.js';
import { companyLicenses } from '../src/db/schema/index.js';
import {
  addMember,
  createCompany,
  createTestApp,
  signUp,
  type Person,
  type TestApp,
} from './helpers.js';

const WEBHOOK = '/payments/culqi/webhook/webhook-de-culqi-solo-para-pruebas-e2e-0123';

describe('licencias y pagos (e2e)', () => {
  let t: TestApp;
  let owner: Person;
  let fake: FakePaymentProvider;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await signUp(t, undefined, 'Rosa Dueña');
    fake = t.app.get(PAYMENT_PROVIDER);
  });

  afterAll(async () => {
    await t.app.close();
  });

  /** Crea la orden y separa el id y el código de la dirección de pago. */
  const order = async (companyId: string, plan = 'emprendedor', cycle = 'monthly') => {
    const res = await t.http
      .post(`/companies/${companyId}/billing/orders`)
      .set(owner.auth)
      .send({ plan, cycle })
      .expect(201);
    const url = new URL(res.body.checkoutUrl);
    return { ...res.body, token: url.hash.replace('#t=', ''), path: url.pathname };
  };

  const charge = (id: string, token: string, tokenId: string, extra: object = {}) =>
    t.http
      .post(`/payments/orders/${id}/charge`)
      .send({ token, tokenId, email: 'rosa@example.com', ...extra })
      .expect(200);

  it('cada empresa nueva empieza con 30 días de prueba del plan Negocio', async () => {
    const companyId = await createCompany(t, owner);
    const res = await t.http.get(`/companies/${companyId}/billing`).set(owner.auth).expect(200);
    expect(res.body.license).toMatchObject({
      status: 'trial',
      plan: 'negocio',
      planName: 'Negocio',
      daysLeft: 30,
      members: 1,
      maxMembers: 6,
    });
    expect(res.body.plans.map((p: { code: string }) => p.code)).toEqual(['emprendedor', 'negocio']);
  });

  it('paga con rechazo y verificación del banco; el plan empieza al terminar la prueba', async () => {
    const companyId = await createCompany(t, owner);
    const o = await order(companyId);
    expect(o).toMatchObject({ amountCents: 2900, status: 'pending', path: `/pagar/${o.id}` });

    // La página de pago se sirve fija, con su CSP.
    const page = await t.web.get(o.path).expect(200);
    expect(page.text).toContain('Contabili');
    expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'");

    const session = await t.http
      .post(`/payments/orders/${o.id}/session`)
      .send({ token: o.token })
      .expect(200);
    expect(session.body).toMatchObject({
      provider: 'fake',
      amountCents: 2900,
      planName: 'Emprendedor',
      cycleLabel: '1 mes',
      companyName: 'Bodega Prueba SAC',
      attemptsLeft: 4,
    });
    await t.http
      .post(`/payments/orders/${o.id}/session`)
      .send({ token: 'x'.repeat(43) })
      .expect(404);

    const declined = await charge(o.id, o.token, 'fake_declined');
    expect(declined.body).toMatchObject({ status: 'declined', attemptsLeft: 3 });
    expect((await charge(o.id, o.token, 'fake_3ds')).body).toEqual({ status: 'needs_3ds' });
    const paid = await charge(o.id, o.token, 'fake_3ds', {
      authentication3DS: { eci: '05', protocolVersion: '2.1.0' },
    });
    expect(paid.body.status).toBe('paid');

    const [license] = await t.db
      .select()
      .from(companyLicenses)
      .where(eq(companyLicenses.companyId, companyId));
    expect(license.paidThrough).toEqual(addMonths(license.trialEndsAt, 1));
    expect(license.plan).toBe('emprendedor');

    // Pagar de nuevo la misma orden no cobra ni extiende otra vez.
    const again = await charge(o.id, o.token, 'fake_ok');
    expect(again.body.status).toBe('paid');
    const status = await t.http.get(`/companies/${companyId}/billing`).set(owner.auth).expect(200);
    expect(status.body.license).toMatchObject({ status: 'active', plan: 'emprendedor' });
    expect(status.body.orders[0]).toMatchObject({ status: 'paid', checkoutUrl: null });
  });

  it('si el cobro no responde, lo confirma el webhook una sola vez', async () => {
    const companyId = await createCompany(t, owner);
    const o = await order(companyId, 'negocio', 'annual');
    expect((await charge(o.id, o.token, 'fake_timeout')).body.status).toBe('charging');
    const busy = await t.http
      .post(`/companies/${companyId}/billing/orders`)
      .set(owner.auth)
      .send({ plan: 'negocio', cycle: 'monthly' })
      .expect(409);
    expect(busy.body.code).toBe('order_in_progress');

    const chargeId = fake.chargeFor(o.id)!.chargeId;
    const event = { type: 'charge.succeeded', data: JSON.stringify({ id: chargeId }) };
    await t.http.post('/payments/culqi/webhook/otro-secreto').send(event).expect(404);
    await t.http.post(WEBHOOK).send(event).expect(200);
    const [first] = await t.db
      .select()
      .from(companyLicenses)
      .where(eq(companyLicenses.companyId, companyId));
    await t.http.post(WEBHOOK).send(event).expect(200);
    const [second] = await t.db
      .select()
      .from(companyLicenses)
      .where(eq(companyLicenses.companyId, companyId));
    expect(first.paidThrough).not.toBeNull();
    expect(second.paidThrough).toEqual(first.paidThrough);
    expect(first.paidThrough!.getTime() - first.trialEndsAt.getTime()).toBeGreaterThan(
      364 * 86_400_000,
    );
  });

  it('vencida, la empresa queda en solo lectura y puede pagar', async () => {
    const companyId = await createCompany(t, owner);
    const sale = {
      operation: { type: 'sale', total: 11800, kind: 'goods', paidWith: 'cash' },
      date: '2025-03-05',
    };
    await t.http.post(`/companies/${companyId}/operations`).set(owner.auth).send(sale).expect(201);
    await t.db
      .update(companyLicenses)
      .set({ trialEndsAt: new Date(Date.now() - 1000) })
      .where(eq(companyLicenses.companyId, companyId));

    const blocked = await t.http
      .post(`/companies/${companyId}/operations`)
      .set(owner.auth)
      .send(sale)
      .expect(402);
    expect(blocked.body.code).toBe('license_expired');
    await t.http
      .post(`/companies/${companyId}/accounts`)
      .set(owner.auth)
      .send({ code: '10411', name: 'BCP soles' })
      .expect(402);
    // Leer siempre se puede.
    await t.http.get(`/companies/${companyId}/journal?period=2025-03`).set(owner.auth).expect(200);
    await t.http.get(`/companies/${companyId}/summary?period=2025-03`).set(owner.auth).expect(200);

    const o = await order(companyId);
    await charge(o.id, o.token, 'fake_ok');
    await t.http.post(`/companies/${companyId}/operations`).set(owner.auth).send(sale).expect(201);
  });

  it('no cambia de plan con un periodo pagado ni baja a uno donde no entra el equipo', async () => {
    const paidCompany = await createCompany(t, owner);
    const o = await order(paidCompany, 'emprendedor');
    await charge(o.id, o.token, 'fake_ok');
    const change = await t.http
      .post(`/companies/${paidCompany}/billing/orders`)
      .set(owner.auth)
      .send({ plan: 'negocio', cycle: 'monthly' })
      .expect(409);
    expect(change.body.code).toBe('plan_change_while_paid');

    // Con Emprendedor (2 personas), no entra una tercera.
    const second = await signUp(t);
    await addMember(t, paidCompany, owner, second, 'accountant');
    const third = await signUp(t);
    const full = await t.http
      .post(`/companies/${paidCompany}/invitations`)
      .set(owner.auth)
      .send({ phone: third.phone, role: 'viewer' })
      .expect(409);
    expect(full.body.code).toBe('plan_member_limit');

    const team = await createCompany(t, owner);
    for (let i = 0; i < 2; i++) await addMember(t, team, owner, await signUp(t), 'viewer');
    const small = await t.http
      .post(`/companies/${team}/billing/orders`)
      .set(owner.auth)
      .send({ plan: 'emprendedor', cycle: 'monthly' })
      .expect(409);
    expect(small.body.code).toBe('plan_too_small');
  });

  it('solo el dueño crea órdenes; una nueva reemplaza a la anterior sin pagar', async () => {
    const companyId = await createCompany(t, owner);
    const accountant = await signUp(t);
    await addMember(t, companyId, owner, accountant, 'accountant');
    await t.http
      .post(`/companies/${companyId}/billing/orders`)
      .set(accountant.auth)
      .send({ plan: 'negocio', cycle: 'monthly' })
      .expect(403);
    const first = await order(companyId, 'negocio');
    await order(companyId, 'negocio', 'annual');
    const res = await charge(first.id, first.token, 'fake_ok');
    expect(res.body).toMatchObject({ status: 'failed' });
  });
});
