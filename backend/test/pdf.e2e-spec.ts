import { writeFileSync } from 'node:fs';
import {
  createCompany,
  createTestApp,
  randomRuc,
  signUp,
  type Person,
  type TestApp,
} from './helpers.js';

/** Si se define, las pruebas dejan los PDF ahí para revisarlos a ojo. */
const SAMPLES = process.env.PDF_SAMPLES;

describe('reportes en PDF (e2e)', () => {
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

  const download = async (companyId: string, body: object) => {
    const link = await t.http
      .post(`/companies/${companyId}/exports`)
      .set(owner.auth)
      .send(body)
      .expect(201);
    return t.web
      .get(new URL(link.body.url).pathname)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
  };

  const isPdf = (body: Buffer) => body.subarray(0, 5).toString('latin1') === '%PDF-';
  const pages = (body: Buffer) => (body.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;

  it('reporte del mes, registros, balance y diario en PDF con la marca', async () => {
    const id = await createCompany(t, owner);
    await record(id, {
      date: '2025-06-03',
      operation: { type: 'sale', total: 118000, kind: 'goods', paidWith: 'cash' },
      document: {
        type: '01',
        series: 'F001',
        number: 1,
        counterpartyRuc: randomRuc(),
        counterpartyName: 'Comercial Andina SAC',
      },
    });
    await record(id, {
      date: '2025-06-04',
      operation: { type: 'sale', total: 23600, kind: 'services', paidWith: 'bank' },
      document: { type: '03', series: 'B001', number: 10 },
    });
    await record(id, {
      date: '2025-06-05',
      operation: {
        type: 'expense',
        total: 47200,
        category: 'goods',
        paidWith: 'bank',
        withInvoice: true,
      },
      document: {
        type: '01',
        series: 'F020',
        number: 77,
        counterpartyRuc: randomRuc(),
        counterpartyName: 'Distribuidora del Sur EIRL',
      },
    });

    const month = await download(id, {
      kind: 'monthly_report',
      from: '2025-06-01',
      to: '2025-06-30',
    });
    expect(month.headers['content-type']).toBe('application/pdf');
    expect(month.headers['content-disposition']).toMatch(
      /filename="reporte-del-mes-\d{11}-2025-06\.pdf"/,
    );
    expect(isPdf(month.body)).toBe(true);
    expect(pages(month.body)).toBeGreaterThanOrEqual(1);
    // Las letras de la marca van incrustadas.
    expect(month.body.toString('latin1')).toMatch(/Saira/);
    expect(month.body.toString('latin1')).toMatch(/Lexend/);

    const sales = await download(id, {
      kind: 'sales_register',
      format: 'pdf',
      from: '2025-06-01',
      to: '2025-06-30',
    });
    expect(sales.headers['content-disposition']).toMatch(
      /registro-de-ventas-\d{11}-2025-06-01-al-2025-06-30\.pdf/,
    );
    expect(isPdf(sales.body)).toBe(true);

    const balance = await download(id, {
      kind: 'trial_balance',
      format: 'pdf',
      from: '2025-01-01',
      to: '2025-06-30',
    });
    expect(isPdf(balance.body)).toBe(true);
    const journal = await download(id, {
      kind: 'journal',
      format: 'pdf',
      from: '2025-06-01',
      to: '2025-06-30',
    });
    expect(isPdf(journal.body)).toBe(true);

    if (SAMPLES) {
      writeFileSync(`${SAMPLES}/reporte-del-mes.pdf`, month.body);
      writeFileSync(`${SAMPLES}/registro-de-ventas.pdf`, sales.body);
      writeFileSync(`${SAMPLES}/balance.pdf`, balance.body);
      writeFileSync(`${SAMPLES}/diario.pdf`, journal.body);
    }
  });

  it('una tabla larga sigue en otra página con su encabezado', async () => {
    const id = await createCompany(t, owner);
    for (let n = 1; n <= 70; n++) {
      await record(id, {
        date: '2025-07-01',
        operation: { type: 'sale', total: 1180 + n, kind: 'goods', paidWith: 'cash' },
        document: { type: '03', series: 'B001', number: n },
      });
    }
    const sales = await download(id, {
      kind: 'sales_register',
      format: 'pdf',
      from: '2025-07-01',
      to: '2025-07-31',
    });
    expect(pages(sales.body)).toBeGreaterThanOrEqual(2);
    if (SAMPLES) writeFileSync(`${SAMPLES}/registro-largo.pdf`, sales.body);
  });

  it('el reporte del mes es solo PDF y de un mes', async () => {
    const id = await createCompany(t, owner);
    const csv = await t.http
      .post(`/companies/${id}/exports`)
      .set(owner.auth)
      .send({ kind: 'monthly_report', format: 'csv', from: '2025-06-01', to: '2025-06-30' })
      .expect(400);
    expect(csv.body.code).toBe('pdf_only');
    const twoMonths = await t.http
      .post(`/companies/${id}/exports`)
      .set(owner.auth)
      .send({ kind: 'monthly_report', from: '2025-06-01', to: '2025-07-31' })
      .expect(400);
    expect(twoMonths.body.code).toBe('one_month');
  });
});
