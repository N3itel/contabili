import { limaDate, periodRange } from '../src/accounting/lima.js';
import { createTestApp, randomRuc, signUp, type Person, type TestApp } from './helpers.js';

describe('archivos del SIRE para SUNAT (e2e)', () => {
  let t: TestApp;
  let owner: Person;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await signUp(t, undefined, 'Rosa Dueña');
  });

  afterAll(async () => {
    await t.app.close();
  });

  const company = async (taxRegime = 'rmt') => {
    const ruc = randomRuc();
    const res = await t.http
      .post('/companies')
      .set(owner.auth)
      .send({ ruc, legalName: 'Bodega Rosa EIRL', taxRegime })
      .expect(201);
    return { id: res.body.id as string, ruc };
  };

  const record = (id: string, body: object) =>
    t.http.post(`/companies/${id}/operations`).set(owner.auth).send(body).expect(201);

  const link = (id: string, body: object) =>
    t.http.post(`/companies/${id}/exports`).set(owner.auth).send(body);

  const download = async (id: string, kind: string, from: string, to: string) => {
    const res = await link(id, { kind, from, to }).expect(201);
    return t.web.get(new URL(res.body.url).pathname).expect(200);
  };

  const sale = { type: 'sale', total: 11800, kind: 'goods', paidWith: 'cash' };
  const purchase = {
    type: 'expense',
    total: 5900,
    category: 'goods',
    paidWith: 'cash',
    withInvoice: true,
  };

  it('registro de ventas y de compras de un mes, con el nombre que pide SUNAT', async () => {
    const { id, ruc } = await company();
    const customer = randomRuc();
    const supplier = randomRuc();
    await record(id, {
      date: '2025-05-03',
      operation: sale,
      document: { type: '01', series: 'F001', number: 15, counterpartyRuc: customer },
    });
    const annulled = await record(id, {
      date: '2025-05-05',
      operation: { ...sale, total: 1180 },
      document: { type: '03', series: 'B001', number: 102 },
    });
    await t.http
      .post(`/companies/${id}/journal/${annulled.body.entry.id}/reverse`)
      .set(owner.auth)
      .send({})
      .expect(201);
    await record(id, {
      date: '2025-05-06',
      operation: purchase,
      document: { type: '01', series: 'F002', number: 9, counterpartyRuc: supplier },
    });
    await record(id, {
      date: '2025-05-07',
      operation: { ...purchase, category: 'services', withInvoice: false },
      document: { type: '02', series: 'E001', number: 7, counterpartyRuc: randomRuc() },
    });
    await record(id, {
      date: '2025-05-08',
      operation: { ...purchase, total: 2000, withInvoice: false },
      document: { type: '12', series: 'TK01', number: 31 },
    });

    const sales = await download(id, 'sire_sales', '2025-05-01', '2025-05-31');
    expect(sales.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(sales.headers['content-disposition']).toBe(
      `attachment; filename="LE${ruc}20250500140400021112.TXT"`,
    );
    const salesLines = sales.text.split('\r\n').filter(Boolean);
    expect(salesLines).toEqual([
      `${ruc}|Bodega Rosa EIRL|202505||03/05/2025||01|F001|15||6|${customer}||0.00|100.00|0.00|18.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|118.00|PEN|||||||`,
      // Lo extornado a mano se anota con importe cero.
      `${ruc}|Bodega Rosa EIRL|202505||05/05/2025||03|B001|102|||||0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|PEN|||||||`,
    ]);

    const purchases = await download(id, 'sire_purchases', '2025-05-01', '2025-05-31');
    expect(purchases.headers['content-disposition']).toBe(
      `attachment; filename="LE${ruc}20250500080400021112.TXT"`,
    );
    // Sin el recibo por honorarios: va al libro de retenciones.
    expect(purchases.text.split('\r\n').filter(Boolean)).toEqual([
      `${ruc}|Bodega Rosa EIRL|202505||06/05/2025||01|F002||9||6|${supplier}||50.00|9.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|59.00|PEN||||||||||||`,
      `${ruc}|Bodega Rosa EIRL|202505||08/05/2025||12|TK01||31|||||0.00|0.00|0.00|0.00|0.00|0.00|20.00|0.00|0.00|0.00|20.00|PEN||||||||||||`,
    ]);

    // Un mes sin comprobantes: archivo vacío con el indicador «sin información».
    const empty = await download(id, 'sire_sales', '2025-06-01', '2025-06-30');
    expect(empty.headers['content-disposition']).toContain(`LE${ruc}20250600140400021012.TXT`);
    expect(empty.text).toBe('');
  });

  it('la nota de crédito resta y lleva el DNI y el comprobante que modifica', async () => {
    const { id } = await company();
    await t.http
      .put(`/companies/${id}/einvoicing`)
      .set(owner.auth)
      .send({ provider: 'test', facturaSeries: 'F001', boletaSeries: 'B001' })
      .expect(200);
    const boleta = await t.http
      .post(`/companies/${id}/einvoices`)
      .set(owner.auth)
      .send({
        type: '03',
        saleKind: 'goods',
        paidWith: 'cash',
        customer: { docType: 'dni', number: '45678912', name: 'Juana Mamani' },
        description: 'Refrigeradora',
        total: 118000,
      })
      .expect(201);
    await t.http
      .post(`/companies/${id}/einvoices/${boleta.body.einvoice.id}/credit-note`)
      .set(owner.auth)
      .send({ reason: '06' })
      .expect(201);
    const today = limaDate(new Date());
    const { from, to } = periodRange(today.slice(0, 7));
    const lines = (await download(id, 'sire_sales', from, to)).text
      .split('\r\n')
      .filter(Boolean)
      .map((l) => l.split('|'));
    expect(lines).toHaveLength(2);
    const [sold, note] = lines;
    expect(sold.slice(6, 13)).toEqual(['03', 'B001', '1', '', '1', '45678912', 'Juana Mamani']);
    expect(note.slice(6, 13)).toEqual(['07', 'BC01', '1', '', '1', '45678912', 'Juana Mamani']);
    expect([note[14], note[16], note[25]]).toEqual(['-1000.00', '-180.00', '-1180.00']);
    const date = `${today.slice(8, 10)}/${today.slice(5, 7)}/${today.slice(0, 4)}`;
    expect(note.slice(28, 32)).toEqual([date, '03', 'B001', '1']);
  });

  it('solo en texto, de un mes y no en el Nuevo RUS', async () => {
    const { id } = await company();
    const wrong = await link(id, {
      kind: 'sire_sales',
      format: 'csv',
      from: '2025-05-01',
      to: '2025-05-31',
    }).expect(400);
    expect(wrong.body.code).toBe('sire_txt_only');
    expect(
      (
        await link(id, {
          kind: 'journal',
          format: 'txt',
          from: '2025-05-01',
          to: '2025-05-31',
        }).expect(400)
      ).body.code,
    ).toBe('sire_txt_only');
    expect(
      (await link(id, { kind: 'sire_purchases', from: '2025-05-01', to: '2025-06-30' }).expect(400))
        .body.code,
    ).toBe('one_month');
    const nrus = await company('nrus');
    expect(
      (
        await link(nrus.id, { kind: 'sire_sales', from: '2025-05-01', to: '2025-05-31' }).expect(
          400,
        )
      ).body.code,
    ).toBe('sire_not_for_nrus');
  });
});
