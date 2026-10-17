import { journalEntries } from '../src/db/schema/index.js';
import {
  addMember,
  constraintOf,
  createCompany,
  createTestApp,
  signUp,
  type Person,
  type TestApp,
} from './helpers.js';

const sale = (entryDate: string) => ({
  entryDate,
  description: 'Venta del día',
  lines: [
    { accountCode: '1011', debit: 11800, credit: 0 },
    { accountCode: '40111', debit: 0, credit: 1800 },
    { accountCode: '7011', debit: 0, credit: 10000 },
  ],
});

describe('cierre de periodos (e2e)', () => {
  let t: TestApp;
  let owner: Person;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await signUp(t, undefined, 'Rosa Dueña');
  });

  afterAll(async () => {
    await t.app.close();
  });

  const post = (companyId: string, person: Person, body: object) =>
    t.http.post(`/companies/${companyId}/journal`).set(person.auth).send(body);

  it('un mes cerrado (y lo anterior) no recibe asientos; el dueño lo reabre con motivo', async () => {
    const companyId = await createCompany(t, owner);
    const accountant = await signUp(t, undefined, 'Carlos Contador');
    await addMember(t, companyId, owner, accountant, 'accountant');
    const first = await post(companyId, accountant, sale('2025-03-10')).expect(201);

    const closed = await t.http
      .post(`/companies/${companyId}/periods/close`)
      .set(accountant.auth)
      .send({ period: '2025-03' })
      .expect(200);
    expect(closed.body.closedThrough).toBe('2025-03-31');

    for (const date of ['2025-03-31', '2025-02-10']) {
      const res = await post(companyId, accountant, sale(date)).expect(409);
      expect(res.body.code).toBe('period_closed');
      expect(res.body.message).toContain('31/03/2025');
    }
    await post(companyId, accountant, sale('2025-04-01')).expect(201);

    const again = await t.http
      .post(`/companies/${companyId}/periods/close`)
      .set(accountant.auth)
      .send({ period: '2025-02' })
      .expect(409);
    expect(again.body.code).toBe('already_closed');

    // El extorno de un asiento de un mes cerrado va con fecha de hoy.
    await t.http
      .post(`/companies/${companyId}/journal/${first.body.id}/reverse`)
      .set(accountant.auth)
      .send({})
      .expect(201);

    await t.http
      .post(`/companies/${companyId}/periods/reopen`)
      .set(accountant.auth)
      .send({ period: '2025-03', reason: 'Falta una factura de marzo' })
      .expect(403);
    await t.http
      .post(`/companies/${companyId}/periods/reopen`)
      .set(owner.auth)
      .send({ period: '2025-03' })
      .expect(400);
    const reopened = await t.http
      .post(`/companies/${companyId}/periods/reopen`)
      .set(owner.auth)
      .send({ period: '2025-03', reason: 'Falta una factura de marzo' })
      .expect(200);
    expect(reopened.body.closedThrough).toBe('2025-02-28');
    expect(reopened.body.history.map((h: { action: string }) => h.action)).toEqual([
      'reopen',
      'close',
    ]);
    expect(reopened.body.history[0]).toMatchObject({
      actor: 'Rosa Dueña',
      reason: 'Falta una factura de marzo',
      previousClosedThrough: '2025-03-31',
    });

    await post(companyId, accountant, sale('2025-03-31')).expect(201);
    await post(companyId, accountant, sale('2025-02-10')).expect(409);

    const company = await t.http.get(`/companies/${companyId}`).set(owner.auth).expect(200);
    expect(company.body.closedThrough).toBe('2025-02-28');
  });

  it('no cierra un mes que no terminó ni deja cerrar a quien solo consulta', async () => {
    const companyId = await createCompany(t, owner);
    const now = new Date();
    const thisMonth = `${now.getFullYear() + 1}-01`;
    const res = await t.http
      .post(`/companies/${companyId}/periods/close`)
      .set(owner.auth)
      .send({ period: thisMonth })
      .expect(400);
    expect(res.body.code).toBe('period_not_ended');

    const viewer = await signUp(t);
    await addMember(t, companyId, owner, viewer, 'viewer');
    await t.http
      .post(`/companies/${companyId}/periods/close`)
      .set(viewer.auth)
      .send({ period: '2025-01' })
      .expect(403);
    const periods = await t.http
      .get(`/companies/${companyId}/periods`)
      .set(viewer.auth)
      .expect(200);
    expect(periods.body).toEqual({ closedThrough: null, history: [] });
  });

  it('la base rechaza un asiento con fecha cerrada aunque no pase por la API', async () => {
    const companyId = await createCompany(t, owner);
    await t.http
      .post(`/companies/${companyId}/periods/close`)
      .set(owner.auth)
      .send({ period: '2025-05' })
      .expect(200);
    expect(
      await constraintOf(
        t.db.insert(journalEntries).values({
          companyId,
          fiscalYear: 2025,
          number: 1,
          entryDate: '2025-05-15',
          description: 'Directo a la base',
          createdBy: owner.userId,
        }),
      ),
    ).toBe('period_closed');
  });
});
