import { writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { PAYMENT_PROVIDER, type FakePaymentProvider } from '../src/billing/payments.js';
import { RECEIPT_PROVIDER, ReceiptsService } from '../src/billing/receipts.service.js';
import { licenseReceipts } from '../src/db/schema/index.js';
import type { EinvoiceProvider } from '../src/einvoicing/providers.js';
import {
  addMember,
  constraintOf,
  createCompany,
  createTestApp,
  signUp,
  type Person,
  type TestApp,
} from './helpers.js';

const SAMPLES = process.env.PDF_SAMPLES;
const WEBHOOK = '/payments/culqi/webhook/webhook-de-culqi-solo-para-pruebas-e2e-0123';

describe('comprobante de cada pago de licencia (e2e)', () => {
  let t: TestApp;
  let owner: Person;
  let fake: FakePaymentProvider;
  let provider: EinvoiceProvider;
  let receipts: ReceiptsService;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await signUp(t, undefined, 'Rosa Dueña');
    fake = t.app.get(PAYMENT_PROVIDER);
    provider = t.app.get(RECEIPT_PROVIDER);
    receipts = t.app.get(ReceiptsService);
  });

  afterAll(async () => {
    await t.app.close();
  });

  /** Crea la orden y la paga con la tarjeta de prueba. */
  const pay = async (companyId: string, tokenId = 'fake_ok') => {
    const res = await t.http
      .post(`/companies/${companyId}/billing/orders`)
      .set(owner.auth)
      .send({ plan: 'negocio', cycle: 'monthly' })
      .expect(201);
    const token = new URL(res.body.checkoutUrl).hash.replace('#t=', '');
    const paid = await t.http
      .post(`/payments/orders/${res.body.id}/charge`)
      .send({ token, tokenId, email: 'rosa@example.com' })
      .expect(200);
    return { orderId: res.body.id as string, status: paid.body.status as string };
  };

  const billing = async (companyId: string) =>
    (await t.http.get(`/companies/${companyId}/billing`).set(owner.auth).expect(200)).body;

  const receiptOf = async (orderId: string) =>
    (await t.db.select().from(licenseReceipts).where(eq(licenseReceipts.orderId, orderId)))[0];

  it('al pagar sale la factura al RUC de la empresa y se ve su PDF', async () => {
    const companyId = await createCompany(t, owner);
    const { orderId, status } = await pay(companyId);
    expect(status).toBe('paid');

    const row = await receiptOf(orderId);
    expect(row).toMatchObject({
      status: 'test',
      series: 'F001',
      customerName: 'Bodega Prueba SAC',
      baseCents: 4153,
      igvCents: 747,
      totalCents: 4900,
    });
    expect(row.description).toMatch(
      /^Licencia de Contabili, plan Negocio por 1 mes: del \d{2}\/\d{2}\/\d{4} al \d{2}\/\d{2}\/\d{4}$/,
    );

    const status1 = await billing(companyId);
    expect(status1.orders[0].receipt).toEqual({
      id: row.id,
      label: `F001-${String(row.number).padStart(8, '0')}`,
      status: 'test',
    });

    const link = await t.http
      .post(`/companies/${companyId}/billing/receipts/${row.id}/link`)
      .set(owner.auth)
      .expect(200);
    const pdf = await t.web
      .get(new URL(link.body.url).pathname)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(pdf.headers['content-disposition']).toMatch(/factura-contabili-\d{11}-F001-\d{8}\.pdf/);
    expect((pdf.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    if (SAMPLES) writeFileSync(`${SAMPLES}/factura-de-licencia.pdf`, pdf.body as Buffer);

    // Los números siguen: el siguiente pago lleva el siguiente.
    const other = await createCompany(t, owner);
    const next = await receiptOf((await pay(other)).orderId);
    expect(next.number).toBe((row.number as number) + 1);
  });

  it('por el webhook también sale una sola vez', async () => {
    const companyId = await createCompany(t, owner);
    const { orderId, status } = await pay(companyId, 'fake_timeout');
    expect(status).toBe('charging');
    expect(await receiptOf(orderId)).toBeUndefined();
    const chargeId = fake.chargeFor(orderId)!.chargeId;
    const event = { type: 'charge.succeeded', data: JSON.stringify({ id: chargeId }) };
    await t.http.post(WEBHOOK).send(event).expect(200);
    await t.http.post(WEBHOOK).send(event).expect(200);
    const rows = await t.db
      .select()
      .from(licenseReceipts)
      .where(eq(licenseReceipts.orderId, orderId));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('test');
  });

  it('si el proveedor no lo crea, el número se libera y el barrido lo reintenta', async () => {
    const companyId = await createCompany(t, owner);
    const emit = vi
      .spyOn(provider, 'emit')
      .mockResolvedValueOnce({ status: 'error', message: 'Serie no registrada' });
    const { orderId, status } = await pay(companyId);
    // El pago no depende del comprobante.
    expect(status).toBe('paid');
    const queued = await receiptOf(orderId);
    expect(queued).toMatchObject({ status: 'queued', number: null, series: null, attempts: 1 });
    expect((await billing(companyId)).orders[0].receipt).toMatchObject({
      label: null,
      status: 'queued',
    });
    const early = await t.http
      .post(`/companies/${companyId}/billing/receipts/${queued.id}/link`)
      .set(owner.auth)
      .expect(409);
    expect(early.body.code).toBe('receipt_not_ready');

    // Se cortó la conexión: queda pendiente con su número y se consulta después.
    emit.mockResolvedValueOnce({ status: 'pending', message: 'No supimos si llegó' });
    await receipts.sweep();
    const pending = await receiptOf(orderId);
    expect(pending).toMatchObject({ status: 'pending', series: 'F001' });
    const check = vi.spyOn(provider, 'check').mockResolvedValueOnce({
      status: 'accepted',
      message: 'Aceptada',
      pdfUrl: 'https://www.nubefact.com/cpe/f.pdf',
    });
    await receipts.sweep(new Date(Date.now() + 2 * 60_000));
    expect(await receiptOf(orderId)).toMatchObject({
      status: 'accepted',
      number: pending.number,
      pdfUrl: 'https://www.nubefact.com/cpe/f.pdf',
    });
    const link = await t.http
      .post(`/companies/${companyId}/billing/receipts/${queued.id}/link`)
      .set(owner.auth)
      .expect(200);
    expect(link.body.url).toBe('https://www.nubefact.com/cpe/f.pdf');
    emit.mockRestore();
    check.mockRestore();
  });

  it('lo ve quien es parte de la empresa; nadie más', async () => {
    const companyId = await createCompany(t, owner);
    const { orderId } = await pay(companyId);
    const row = await receiptOf(orderId);
    const viewer = await signUp(t, undefined, 'Ana Consulta');
    await addMember(t, companyId, owner, viewer, 'viewer');
    await t.http
      .post(`/companies/${companyId}/billing/receipts/${row.id}/link`)
      .set(viewer.auth)
      .expect(200);
    const stranger = await signUp(t, undefined, 'Otra Persona');
    const strangerCompany = await createCompany(t, stranger);
    await t.http
      .post(`/companies/${companyId}/billing/receipts/${row.id}/link`)
      .set(stranger.auth)
      .expect(404);
    // Con su propia empresa tampoco: el comprobante es de otra.
    const cross = await t.http
      .post(`/companies/${strangerCompany}/billing/receipts/${row.id}/link`)
      .set(stranger.auth)
      .expect(404);
    expect(cross.body.code).toBe('receipt_not_found');

    // La base: uno por orden y sin número mientras espera turno.
    const { id: _id, createdAt: _c, updatedAt: _u, ...copy } = row;
    expect(await constraintOf(t.db.insert(licenseReceipts).values(copy))).toBe(
      'license_receipts_order_uq',
    );
    expect(
      await constraintOf(
        t.db.insert(licenseReceipts).values({ ...copy, orderId: row.orderId, status: 'queued' }),
      ),
    ).toBe('license_receipts_number');
  });
});
