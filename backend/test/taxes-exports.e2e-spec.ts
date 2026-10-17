import { limaDate } from '../src/accounting/lima.js';
import {
  addMember,
  createCompany,
  createTestApp,
  randomRuc,
  signUp,
  type Person,
  type TestApp,
} from './helpers.js';

describe('impuestos del mes, tendencia y descargas (e2e)', () => {
  let t: TestApp;
  let owner: Person;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await signUp(t, undefined, 'Rosa Dueña');
  });

  afterAll(async () => {
    await t.app.close();
  });

  const record = (companyId: string, body: object) =>
    t.http.post(`/companies/${companyId}/operations`).set(owner.auth).send(body).expect(201);

  const companyWith = async (taxRegime: string) =>
    (
      await t.http
        .post('/companies')
        .set(owner.auth)
        .send({ ruc: randomRuc(), legalName: 'Bodega Rosa EIRL', taxRegime })
        .expect(201)
    ).body.id as string;

  it('RMT: IGV de ventas menos compras, 1 % de renta y el pago de IGV no cuenta como compra', async () => {
    const id = await companyWith('rmt');
    await record(id, {
      date: '2025-03-05',
      operation: { type: 'sale', total: 11800, kind: 'goods', paidWith: 'cash' },
    });
    await record(id, {
      date: '2025-03-06',
      operation: {
        type: 'expense',
        total: 5900,
        category: 'services',
        paidWith: 'cash',
        withInvoice: true,
      },
    });
    const march = await t.http
      .get(`/companies/${id}/taxes?period=2025-03`)
      .set(owner.auth)
      .expect(200);
    expect(march.body.igv).toEqual({
      sales: 1800,
      purchases: 900,
      previousCredit: 0,
      toPay: 900,
      nextCredit: 0,
    });
    expect(march.body.income).toMatchObject({
      kind: 'monthly_payment',
      ratePercent: 1,
      amount: 100,
    });
    expect(march.body.total).toBe(1000);

    // En abril paga el IGV de marzo: no es una compra y baja lo que debe a SUNAT.
    const paid = await record(id, {
      date: '2025-04-10',
      operation: { type: 'tax_payment', total: 900, tax: 'igv', from: 'bank' },
    });
    expect(paid.body.entry).toMatchObject({
      source: 'tax_payment',
      description: 'Pago de IGV a SUNAT',
    });
    const april = await t.http
      .get(`/companies/${id}/taxes?period=2025-04`)
      .set(owner.auth)
      .expect(200);
    expect(april.body.igv).toMatchObject({ purchases: 0, toPay: 0 });
    const summary = await t.http
      .get(`/companies/${id}/summary?period=2025-04`)
      .set(owner.auth)
      .expect(200);
    expect(summary.body.igv.balance).toBe(0);
  });

  it('Nuevo RUS: cuota fija y sin IGV', async () => {
    const id = await companyWith('nrus');
    await record(id, {
      date: '2025-03-05',
      operation: { type: 'sale', total: 450000, kind: 'goods', paidWith: 'cash' },
    });
    const res = await t.http
      .get(`/companies/${id}/taxes?period=2025-03`)
      .set(owner.auth)
      .expect(200);
    expect(res.body.igv).toBeNull();
    expect(res.body.income).toMatchObject({ kind: 'nrus_quota', nrusCategory: 1, amount: 2000 });
  });

  it('la tendencia trae los últimos meses con ceros donde no hubo nada', async () => {
    const id = await createCompany(t, owner);
    await record(id, {
      operation: { type: 'sale', total: 11800, kind: 'goods', paidWith: 'cash' },
    });
    const res = await t.http.get(`/companies/${id}/trend?months=3`).set(owner.auth).expect(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[2]).toEqual({
      period: limaDate(new Date()).slice(0, 7),
      sales: 10000,
      expenses: 0,
    });
    expect(res.body[0]).toMatchObject({ sales: 0, expenses: 0 });
  });

  it('descarga el libro diario para Excel con un enlace corto y seguro', async () => {
    const id = await createCompany(t, owner);
    await record(id, {
      date: '2025-03-05',
      operation: { type: 'sale', total: 11800, kind: 'goods', paidWith: 'cash' },
    });
    await t.http
      .post(`/companies/${id}/journal`)
      .set(owner.auth)
      .send({
        entryDate: '2025-03-06',
        description: '=HYPERLINK("http://malo")',
        lines: [
          { accountCode: '1011', debit: 100, credit: 0 },
          { accountCode: '7011', debit: 0, credit: 100 },
        ],
      })
      .expect(201);

    const link = await t.http
      .post(`/companies/${id}/exports`)
      .set(owner.auth)
      .send({ kind: 'journal', from: '2025-03-01', to: '2025-03-31' })
      .expect(201);
    const path = new URL(link.body.url).pathname;
    const file = await t.web.get(path).expect(200);
    expect(file.headers['content-type']).toContain('text/csv');
    expect(file.headers['content-disposition']).toMatch(
      /attachment; filename="libro-diario-\d{11}-2025-03-01-al-2025-03-31\.csv"/,
    );
    expect(file.text.startsWith('﻿Asiento,Fecha,Glosa')).toBe(true);
    expect(file.text).toContain(
      '1-2025,05/03/2025,Venta de mercadería al contado,1011,Caja,118.00,0.00,',
    );
    // La glosa con fórmula queda como texto.
    expect(file.text).toContain(`"'=HYPERLINK(""http://malo"")"`);

    const balance = await t.http
      .post(`/companies/${id}/exports`)
      .set(owner.auth)
      .send({ kind: 'trial_balance', from: '2025-01-01', to: '2025-12-31' })
      .expect(201);
    const csv = await t.web.get(new URL(balance.body.url).pathname).expect(200);
    expect(csv.text).toContain(',Totales,119.00,119.00,');

    await t.web.get('/api/v1/exports/esto-no-es-un-enlace').expect(404);
    await t.http
      .post(`/companies/${id}/exports`)
      .set(owner.auth)
      .send({ kind: 'journal', from: '2024-01-01', to: '2025-03-31' })
      .expect(400);
  });

  it('quien sale de la empresa ya no puede usar sus enlaces', async () => {
    const id = await createCompany(t, owner);
    const viewer = await signUp(t);
    await addMember(t, id, owner, viewer, 'viewer');
    const link = await t.http
      .post(`/companies/${id}/exports`)
      .set(viewer.auth)
      .send({ kind: 'journal', from: '2025-01-01', to: '2025-12-31' })
      .expect(201);
    await t.http.delete(`/companies/${id}/members/${viewer.userId}`).set(owner.auth).expect(204);
    await t.web.get(new URL(link.body.url).pathname).expect(404);
  });
});
