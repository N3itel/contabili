import {
  addMember,
  createTestApp,
  randomRuc,
  signUp,
  type Person,
  type TestApp,
} from './helpers.js';

describe('operaciones fáciles y resumen (e2e)', () => {
  let t: TestApp;
  let owner: Person;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await signUp(t, undefined, 'Rosa Dueña');
  });

  afterAll(async () => {
    await t.app.close();
  });

  const company = async (taxRegime: string) =>
    (
      await t.http
        .post('/companies')
        .set(owner.auth)
        .send({ ruc: randomRuc(), legalName: 'Bodega Rosa EIRL', taxRegime })
        .expect(201)
    ).body.id as string;

  const record = (companyId: string, body: object, person = owner) =>
    t.http.post(`/companies/${companyId}/operations`).set(person.auth).send(body);

  it('arma los asientos y el resumen del mes cuadra con lo que pasó', async () => {
    const id = await company('rmt');
    const ops = [
      {
        date: '2025-03-05',
        operation: { type: 'sale', total: 11800, kind: 'goods', paidWith: 'cash' },
      },
      {
        date: '2025-03-06',
        operation: {
          type: 'expense',
          total: 5900,
          category: 'services',
          paidWith: 'bank',
          withInvoice: true,
        },
        reference: 'F002-881',
      },
      {
        date: '2025-03-07',
        operation: { type: 'sale', total: 23600, kind: 'services', paidWith: 'credit' },
      },
      { date: '2025-03-08', operation: { type: 'collection', total: 10000, into: 'bank' } },
      {
        date: '2025-03-09',
        operation: {
          type: 'expense',
          total: 11800,
          category: 'goods',
          paidWith: 'credit',
          withInvoice: true,
        },
      },
      { date: '2025-03-10', operation: { type: 'payment', total: 5000, from: 'cash' } },
      // De abril: no entra en el resumen de marzo.
      {
        date: '2025-04-02',
        operation: { type: 'sale', total: 1000, kind: 'goods', paidWith: 'cash' },
      },
    ];
    const results = [];
    for (const op of ops) results.push((await record(id, op).expect(201)).body);

    expect(results[0].entry.lines.map((l: { accountCode: string }) => l.accountCode)).toEqual([
      '1011',
      '40111',
      '7011',
    ]);
    expect(results[0].explanation.replace(/\s/g, ' ')).toContain('S/ 18.00 es IGV');
    expect(results[1].entry.description).toBe('Gasto: servicios · F002-881');

    const summary = await t.http
      .get(`/companies/${id}/summary?period=2025-03`)
      .set(owner.auth)
      .expect(200);
    expect(summary.body).toEqual({
      period: '2025-03',
      asOf: '2025-03-31',
      money: { cash: 6800, bank: 4100, total: 10900 },
      receivable: 13600,
      payable: 6800,
      igv: { month: 2700, balance: 2700 },
      month: { sales: 30000, expenses: 15000, result: 15000 },
    });
  });

  it('en el Nuevo RUS la venta va sin IGV', async () => {
    const id = await company('nrus');
    const res = await record(id, {
      date: '2025-03-05',
      operation: { type: 'sale', total: 5000, kind: 'goods', paidWith: 'cash' },
    }).expect(201);
    expect(res.body.entry.lines).toHaveLength(2);
  });

  it('con subcuentas de banco, pide elegir cuál', async () => {
    const id = await company('general');
    await t.http
      .post(`/companies/${id}/accounts`)
      .set(owner.auth)
      .send({ code: '10411', name: 'BCP soles' })
      .expect(201);
    const op = { type: 'collection', total: 100, into: 'bank' };
    const res = await record(id, { operation: op }).expect(400);
    expect(res.body.code).toBe('account_not_postable');
    await record(id, { operation: op, moneyAccountCode: '10411' }).expect(201);
    const bad = await record(id, { operation: op, moneyAccountCode: '1212' }).expect(400);
    expect(bad.body.code).toBe('invalid_money_account');
  });

  it('quien solo consulta ve el resumen pero no registra', async () => {
    const id = await company('rer');
    const viewer = await signUp(t);
    await addMember(t, id, owner, viewer, 'viewer');
    await record(
      id,
      { operation: { type: 'collection', total: 100, into: 'cash' } },
      viewer,
    ).expect(403);
    await t.http.get(`/companies/${id}/summary`).set(viewer.auth).expect(200);
    await t.http
      .post(`/companies/${id}/operations`)
      .set(owner.auth)
      .send({ operation: { type: 'sale', total: 0, kind: 'goods', paidWith: 'cash' } })
      .expect(400);
  });
});
