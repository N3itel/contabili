import { sql } from 'drizzle-orm';
import { documents } from '../src/db/schema/index.js';
import {
  constraintOf,
  createTestApp,
  randomRuc,
  signUp,
  type Person,
  type TestApp,
} from './helpers.js';

describe('comprobantes y registros de ventas y compras (e2e)', () => {
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
    t.http.post(`/companies/${companyId}/operations`).set(owner.auth).send(body);

  const companyWith = async (taxRegime: string) =>
    (
      await t.http
        .post('/companies')
        .set(owner.auth)
        .send({ ruc: randomRuc(), legalName: 'Bodega Rosa EIRL', taxRegime })
        .expect(201)
    ).body.id as string;

  const sale = { type: 'sale', total: 11800, kind: 'goods', paidWith: 'cash' };
  const purchase = {
    type: 'expense',
    total: 5900,
    category: 'goods',
    paidWith: 'cash',
    withInvoice: true,
  };

  it('arma el registro de ventas y el de compras del mes, sin contar lo anulado', async () => {
    const id = await companyWith('rmt');
    const customerRuc = randomRuc();
    const supplierRuc = randomRuc();
    const f1 = await record(id, {
      date: '2025-05-03',
      operation: sale,
      document: { type: '01', series: 'f001', number: 15, counterpartyRuc: customerRuc },
    }).expect(201);
    expect(f1.body.entry.document).toEqual({ type: '01', series: 'F001', number: 15 });
    expect(f1.body.entry.description).toBe('Venta de mercadería al contado · Factura F001-15');
    await record(id, {
      date: '2025-05-04',
      operation: { ...sale, total: 2360 },
      document: { type: '03', series: 'B001', number: 101 },
    }).expect(201);
    const toAnnul = await record(id, {
      date: '2025-05-05',
      operation: { ...sale, total: 1180 },
      document: { type: '03', series: 'B001', number: 102 },
    }).expect(201);
    await t.http
      .post(`/companies/${id}/journal/${toAnnul.body.entry.id}/reverse`)
      .set(owner.auth)
      .send({})
      .expect(201);
    await record(id, {
      date: '2025-05-06',
      operation: purchase,
      document: {
        type: '01',
        series: 'F010',
        number: 900,
        counterpartyRuc: supplierRuc,
        counterpartyName: 'Distribuidora Andina SAC',
      },
    }).expect(201);

    const sales = await t.http
      .get(`/companies/${id}/registers/sales?period=2025-05`)
      .set(owner.auth)
      .expect(200);
    expect(sales.body.rows).toHaveLength(3);
    expect(sales.body.rows[0]).toMatchObject({
      issueDate: '2025-05-03',
      docType: '01',
      docTypeLabel: 'Factura',
      series: 'F001',
      number: 15,
      counterpartyRuc: customerRuc,
      base: 10000,
      igv: 1800,
      total: 11800,
      annulled: false,
    });
    expect(sales.body.rows[2]).toMatchObject({ number: 102, annulled: true });
    expect(sales.body.totals).toEqual({ count: 2, base: 12000, igv: 2160, total: 14160 });

    const purchases = await t.http
      .get(`/companies/${id}/registers/purchases?period=2025-05`)
      .set(owner.auth)
      .expect(200);
    expect(purchases.body.rows).toEqual([
      expect.objectContaining({
        counterpartyRuc: supplierRuc,
        counterpartyName: 'Distribuidora Andina SAC',
        base: 5000,
        igv: 900,
        total: 5900,
      }),
    ]);

    // Para Excel, con el mismo enlace corto de las otras descargas.
    const link = await t.http
      .post(`/companies/${id}/exports`)
      .set(owner.auth)
      .send({ kind: 'sales_register', from: '2025-05-01', to: '2025-05-31' })
      .expect(201);
    const file = await t.web.get(new URL(link.body.url).pathname).expect(200);
    expect(file.headers['content-disposition']).toMatch(/registro-de-ventas-\d{11}-2025-05-01/);
    expect(file.text).toContain(
      `03/05/2025,01,Factura,F001,15,${customerRuc},,100.00,18.00,118.00,`,
    );
    expect(file.text).toContain('Anulado');
    expect(file.text).toContain(',Totales,,,,,120.00,21.60,141.60,');
  });

  it('el RUC sale del cliente o proveedor elegido', async () => {
    const id = await companyWith('rmt');
    const ruc = randomRuc();
    const supplier = await t.http
      .post(`/companies/${id}/contacts`)
      .set(owner.auth)
      .send({ kind: 'supplier', name: 'Ferretería Sol', ruc })
      .expect(201);
    await record(id, {
      operation: { ...purchase, paidWith: 'credit' },
      contactId: supplier.body.id,
      document: { type: '01', series: 'F002', number: 3 },
    }).expect(201);
    const register = await t.http
      .get(`/companies/${id}/registers/purchases`)
      .set(owner.auth)
      .expect(200);
    expect(register.body.rows[0]).toMatchObject({
      counterpartyRuc: ruc,
      counterpartyName: 'Ferretería Sol',
    });
  });

  it('no deja registrar dos veces el mismo comprobante', async () => {
    const id = await companyWith('rmt');
    const ruc = randomRuc();
    const doc = { type: '01', series: 'F001', number: 1, counterpartyRuc: ruc };
    await record(id, { operation: sale, document: doc }).expect(201);
    const again = await record(id, { operation: sale, document: doc }).expect(409);
    expect(again.body.code).toBe('document_duplicate');
    expect(again.body.message).toBe(
      'Ya registraste la factura F001-1. Revisa el número: cada comprobante tuyo va una sola vez.',
    );
    // Sin dejar el asiento a medias: solo quedó la primera venta.
    const journal = await t.http
      .get(`/companies/${id}/journal?period=${new Date().toISOString().slice(0, 7)}`)
      .set(owner.auth)
      .expect(200);
    expect(journal.body.entries).toHaveLength(1);

    // La misma factura de un proveedor tampoco; de otro proveedor, sí.
    const supplierDoc = { type: '01', series: 'F001', number: 1, counterpartyRuc: randomRuc() };
    await record(id, { operation: purchase, document: supplierDoc }).expect(201);
    const repeated = await record(id, { operation: purchase, document: supplierDoc }).expect(409);
    expect(repeated.body.message).toBe('Ya registraste la factura F001-1 de ese proveedor.');
    await record(id, {
      operation: purchase,
      document: { ...supplierDoc, counterpartyRuc: randomRuc() },
    }).expect(201);
  });

  it('reglas: Nuevo RUS sin facturas, RUC obligatorio y «tengo factura» coherente', async () => {
    const nrus = await companyWith('nrus');
    const noFactura = await record(nrus, {
      operation: sale,
      document: { type: '01', series: 'F001', number: 1, counterpartyRuc: randomRuc() },
    }).expect(400);
    expect(noFactura.body.code).toBe('nrus_no_factura');

    const rmt = await companyWith('rmt');
    const noRuc = await record(rmt, {
      operation: sale,
      document: { type: '01', series: 'F001', number: 1 },
    }).expect(400);
    expect(noRuc.body.code).toBe('document_ruc_required');
    const mismatch = await record(rmt, {
      operation: { ...purchase, withInvoice: false },
      document: { type: '01', series: 'F001', number: 1, counterpartyRuc: randomRuc() },
    }).expect(400);
    expect(mismatch.body.code).toBe('document_mismatch');
    const onCollection = await record(rmt, {
      operation: { type: 'collection', total: 100, into: 'cash' },
      document: { type: '03', series: 'B001', number: 1 },
    }).expect(400);
    expect(onCollection.body.code).toBe('document_not_allowed');
  });

  it('la base protege los comprobantes: no se editan, ni cruzan de empresa, ni descuadran', async () => {
    const id = await companyWith('rmt');
    const done = await record(id, {
      operation: sale,
      document: { type: '03', series: 'B001', number: 7 },
    }).expect(201);
    expect(
      await constraintOf(
        t.db.execute(sql`UPDATE documents SET number = 8 WHERE entry_id = ${done.body.entry.id}`),
      ),
    ).toBe('documents_immutable');
    expect(
      await constraintOf(
        t.db.execute(sql`DELETE FROM documents WHERE entry_id = ${done.body.entry.id}`),
      ),
    ).toBe('documents_immutable');

    const other = await companyWith('rmt');
    const otherSale = await record(other, { operation: sale }).expect(201);
    const row = {
      companyId: id,
      entryId: otherSale.body.entry.id as string,
      direction: 'sale' as const,
      docType: '03',
      series: 'B001',
      number: 8,
      issueDate: '2025-05-01',
      baseCents: 10000,
      igvCents: 1800,
      totalCents: 11800,
    };
    expect(await constraintOf(t.db.insert(documents).values(row))).toBe('documents_entry_fk');
    expect(
      await constraintOf(
        t.db.insert(documents).values({ ...row, companyId: other, totalCents: 11000 }),
      ),
    ).toBe('documents_amounts');
    expect(
      await constraintOf(
        t.db.insert(documents).values({ ...row, companyId: other, docType: '01' }),
      ),
    ).toBe('documents_ruc_required');
  });
});
