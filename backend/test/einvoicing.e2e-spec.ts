import { writeFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { einvoices, einvoiceSettings } from '../src/db/schema/index.js';
import { EINVOICE_PROVIDERS } from '../src/einvoicing/einvoicing.service.js';
import type { EinvoiceProvider, EmitResult, ProviderCode } from '../src/einvoicing/providers.js';
import {
  addMember,
  constraintOf,
  createTestApp,
  randomRuc,
  signUp,
  type Person,
  type TestApp,
} from './helpers.js';

const SAMPLES = process.env.PDF_SAMPLES;

/** Un Nubefact de mentira: responde lo que la prueba le diga. */
class ScriptedProvider implements EinvoiceProvider {
  next: EmitResult = {
    status: 'accepted',
    message: 'Aceptada',
    pdfUrl: 'https://www.nubefact.com/cpe/x.pdf',
  };
  checks: EmitResult = { status: 'accepted', message: 'Aceptada' };
  calls = 0;
  async emit(): Promise<EmitResult> {
    this.calls++;
    return this.next;
  }
  async check(): Promise<EmitResult> {
    return this.checks;
  }
}

describe('facturación electrónica beta (e2e)', () => {
  let t: TestApp;
  let owner: Person;
  let providers: Record<ProviderCode, EinvoiceProvider>;
  const scripted = new ScriptedProvider();

  beforeAll(async () => {
    t = await createTestApp();
    owner = await signUp(t, undefined, 'Rosa Dueña');
    providers = t.app.get(EINVOICE_PROVIDERS);
    providers.nubefact = scripted;
  });

  afterAll(async () => {
    await t.app.close();
  });

  const company = async (taxRegime = 'rmt') =>
    (
      await t.http
        .post('/companies')
        .set(owner.auth)
        .send({ ruc: randomRuc(), legalName: 'Bodega Rosa EIRL', taxRegime })
        .expect(201)
    ).body.id as string;

  const configure = (
    id: string,
    body: object = { provider: 'test', facturaSeries: 'F001', boletaSeries: 'B001' },
  ) => t.http.put(`/companies/${id}/einvoicing`).set(owner.auth).send(body);

  const emit = (id: string, body: object) =>
    t.http.post(`/companies/${id}/einvoices`).set(owner.auth).send(body);

  const boleta = {
    type: '03',
    saleKind: 'goods',
    paidWith: 'cash',
    customer: { docType: 'none' },
    description: 'Abarrotes varios',
    total: 11800,
  };

  it('modo de prueba: numera, anota la venta con su comprobante y da su PDF', async () => {
    const id = await company();
    const none = await emit(id, boleta).expect(409);
    expect(none.body.code).toBe('einvoice_not_configured');
    await configure(id).expect(200);
    const settings = await t.http.get(`/companies/${id}/einvoicing`).set(owner.auth).expect(200);
    expect(settings.body).toEqual({
      enabled: true,
      provider: 'test',
      facturaSeries: 'F001',
      boletaSeries: 'B001',
      endpointHost: null,
      hasToken: false,
    });

    const first = await emit(id, boleta).expect(201);
    expect(first.body.recordError).toBeNull();
    expect(first.body.einvoice).toMatchObject({
      label: 'B001-00000001',
      status: 'test',
      base: 10000,
      igv: 1800,
      total: 11800,
      recorded: true,
    });
    const second = await emit(id, {
      ...boleta,
      type: '01',
      saleKind: 'services',
      customer: { docType: 'ruc', number: randomRuc(), name: 'Comercial Andina SAC' },
      description: 'Servicio de transporte',
      total: 23600,
    }).expect(201);
    expect(second.body.einvoice.label).toBe('F001-00000001');
    const third = await emit(id, boleta).expect(201);
    expect(third.body.einvoice.label).toBe('B001-00000002');

    // Las ventas quedaron en el registro de ventas con su serie y número.
    const register = await t.http
      .get(`/companies/${id}/registers/sales`)
      .set(owner.auth)
      .expect(200);
    expect(
      register.body.rows.map((r: { series: string; number: number }) => `${r.series}-${r.number}`),
    ).toEqual(['F001-1', 'B001-1', 'B001-2']);
    expect(register.body.totals.total).toBe(11800 + 23600 + 11800);

    const list = await t.http.get(`/companies/${id}/einvoices`).set(owner.auth).expect(200);
    expect(list.body).toHaveLength(3);

    // El PDF de prueba sale por un enlace corto y lleva la marca de agua.
    const link = await t.http
      .post(`/companies/${id}/einvoices/${first.body.einvoice.id}/link`)
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
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toMatch(/boleta-\d{11}-B001-00000001\.pdf/);
    expect((pdf.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    if (SAMPLES) writeFileSync(`${SAMPLES}/boleta-de-prueba.pdf`, pdf.body as Buffer);
  });

  it('reglas: Nuevo RUS, factura con RUC, boleta grande con DNI', async () => {
    const nrus = await company('nrus');
    expect((await configure(nrus).expect(400)).body.code).toBe('einvoice_nrus');

    const id = await company();
    await configure(id).expect(200);
    expect(
      (
        await emit(id, {
          ...boleta,
          type: '01',
          customer: { docType: 'dni', number: '45678912', name: 'Juana' },
        }).expect(400)
      ).body.code,
    ).toBe('factura_needs_ruc');
    expect((await emit(id, { ...boleta, total: 80000 }).expect(400)).body.code).toBe(
      'boleta_needs_id',
    );
    await emit(id, {
      ...boleta,
      total: 80000,
      customer: { docType: 'dni', number: '45678912', name: 'Juana Mamani' },
    }).expect(201);
  });

  it('Nubefact: guarda el token cifrado, libera el número si no lo crea y consulta lo pendiente', async () => {
    const id = await company();
    const bad = await configure(id, {
      provider: 'nubefact',
      facturaSeries: 'F001',
      boletaSeries: 'B001',
      endpoint: 'https://169.254.169.254/latest',
      token: 'token-de-nubefact-123',
    }).expect(400);
    expect(bad.body.code).toBe('invalid_endpoint');
    const ok = await configure(id, {
      provider: 'nubefact',
      facturaSeries: 'F002',
      boletaSeries: 'B002',
      endpoint: 'https://api.nubefact.com/api/v1/abc-123',
      token: 'token-de-nubefact-123',
    }).expect(200);
    expect(ok.body).toMatchObject({
      provider: 'nubefact',
      endpointHost: 'api.nubefact.com',
      hasToken: true,
    });
    const [stored] = await t.db
      .select()
      .from(einvoiceSettings)
      .where(eq(einvoiceSettings.companyId, id));
    expect(stored.tokenEncrypted).not.toContain('token-de-nubefact');
    expect(stored.tokenEncrypted?.startsWith('v1:')).toBe(true);

    // El proveedor no lo creó: error claro y el número no se gasta.
    scripted.next = {
      status: 'error',
      message: 'Tu proveedor de facturación no lo aceptó: Serie no registrada.',
    };
    const refused = await emit(id, boleta).expect(400);
    expect(refused.body).toMatchObject({
      code: 'einvoice_provider_error',
      message: 'Tu proveedor de facturación no lo aceptó: Serie no registrada.',
    });

    // Se cortó la conexión: queda pendiente con su número y no se anota todavía.
    scripted.next = { status: 'pending', message: 'No supimos si llegó a tu proveedor.' };
    const pending = await emit(id, boleta).expect(201);
    expect(pending.body.einvoice).toMatchObject({
      label: 'B002-00000001',
      status: 'pending',
      recorded: false,
    });

    // Al consultar, SUNAT ya lo aceptó: se anota la venta.
    scripted.checks = {
      status: 'accepted',
      message: 'La Boleta numero B002-1, ha sido aceptada',
      pdfUrl: 'https://www.nubefact.com/cpe/b.pdf',
    };
    const refreshed = await t.http
      .post(`/companies/${id}/einvoices/${pending.body.einvoice.id}/refresh`)
      .set(owner.auth)
      .expect(200);
    expect(refreshed.body.einvoice).toMatchObject({ status: 'accepted', recorded: true });
    const link = await t.http
      .post(`/companies/${id}/einvoices/${pending.body.einvoice.id}/link`)
      .set(owner.auth)
      .expect(200);
    expect(link.body.url).toBe('https://www.nubefact.com/cpe/b.pdf');

    // SUNAT lo rechaza: el número se usó y la venta no se anota.
    scripted.next = { status: 'rejected', message: 'El RUC del emisor no está habilitado' };
    const rejected = await emit(id, boleta).expect(201);
    expect(rejected.body.einvoice).toMatchObject({
      label: 'B002-00000002',
      status: 'rejected',
      recorded: false,
    });
  });

  it('si no se pudo anotar la venta, el comprobante queda y se reintenta', async () => {
    const id = await company();
    await configure(id).expect(200);
    // Alguien anotó a mano una boleta con el mismo número que tocará.
    await t.http
      .post(`/companies/${id}/operations`)
      .set(owner.auth)
      .send({
        operation: { type: 'sale', total: 500, kind: 'goods', paidWith: 'cash' },
        document: { type: '03', series: 'B001', number: 1 },
      })
      .expect(201);
    const out = await emit(id, boleta).expect(201);
    expect(out.body.einvoice).toMatchObject({ status: 'test', recorded: false });
    expect(out.body.recordError).toMatch(
      /^El comprobante salió, pero no se pudo anotar la venta: Ya registraste la boleta/,
    );
    const retry = await t.http
      .post(`/companies/${id}/einvoices/${out.body.einvoice.id}/record`)
      .set(owner.auth)
      .expect(200);
    expect(retry.body.recordError).toMatch(/no se pudo anotar/);
  });

  it('solo el dueño configura; quien consulta no emite; la base cuida los números', async () => {
    const id = await company();
    const viewer = await signUp(t, undefined, 'Ana Consulta');
    await addMember(t, id, owner, viewer, 'viewer');
    await t.http
      .put(`/companies/${id}/einvoicing`)
      .set(viewer.auth)
      .send({ provider: 'test', facturaSeries: 'F001', boletaSeries: 'B001' })
      .expect(403);
    await configure(id).expect(200);
    await t.http.post(`/companies/${id}/einvoices`).set(viewer.auth).send(boleta).expect(403);

    const done = await emit(id, boleta).expect(201);
    const [row] = await t.db
      .select()
      .from(einvoices)
      .where(eq(einvoices.id, done.body.einvoice.id));
    const { id: _id, createdAt: _c, updatedAt: _u, entryId: _e, ...copy } = row;
    expect(await constraintOf(t.db.insert(einvoices).values(copy))).toBe('einvoices_number_uq');
    expect(
      await constraintOf(t.db.insert(einvoices).values({ ...copy, number: 99, series: 'F001' })),
    ).toBe('einvoices_series');
    expect(
      await constraintOf(
        t.db.insert(einvoices).values({ ...copy, number: 100, totalCents: 90000 }),
      ),
    ).toBe('einvoices_amounts');
    expect(
      await constraintOf(
        t.db.execute(
          sql`UPDATE einvoices SET status = 'pending', entry_id = ${row.entryId} WHERE id = ${row.id}`,
        ),
      ),
    ).toBe('einvoices_entry_status');
  });
});
