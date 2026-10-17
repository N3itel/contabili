import { and, eq } from 'drizzle-orm';
import { accounts, journalLines } from '../src/db/schema/index.js';
import {
  addMember,
  constraintOf,
  createCompany,
  createTestApp,
  randomRuc,
  signUp,
  type Person,
  type TestApp,
} from './helpers.js';

describe('clientes y proveedores (e2e)', () => {
  let t: TestApp;
  let owner: Person;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await signUp(t, undefined, 'Rosa Dueña');
  });

  afterAll(async () => {
    await t.app.close();
  });

  const contact = async (companyId: string, kind: string, name: string, ruc?: string) =>
    (
      await t.http
        .post(`/companies/${companyId}/contacts`)
        .set(owner.auth)
        .send({ kind, name, ruc })
        .expect(201)
    ).body.id as string;

  const record = (companyId: string, body: object) =>
    t.http.post(`/companies/${companyId}/operations`).set(owner.auth).send(body);

  it('sabe cuánto debe cada cliente y cuánto se le debe a cada proveedor', async () => {
    const companyId = await createCompany(t, owner);
    const ana = await contact(companyId, 'customer', 'Restaurante Ana', randomRuc());
    const molino = await contact(companyId, 'supplier', 'Molino Andino SAC');

    await record(companyId, {
      date: '2025-03-05',
      contactId: ana,
      operation: { type: 'sale', total: 11800, kind: 'goods', paidWith: 'credit' },
    }).expect(201);
    await record(companyId, {
      date: '2025-03-10',
      contactId: ana,
      operation: { type: 'collection', total: 5000, into: 'bank' },
    }).expect(201);
    await record(companyId, {
      date: '2025-03-06',
      contactId: molino,
      operation: {
        type: 'expense',
        total: 5900,
        category: 'goods',
        paidWith: 'credit',
        withInvoice: true,
      },
    }).expect(201);

    const customers = await t.http
      .get(`/companies/${companyId}/contacts?kind=customer`)
      .set(owner.auth)
      .expect(200);
    expect(customers.body).toEqual([
      expect.objectContaining({ id: ana, name: 'Restaurante Ana', balance: 6800 }),
    ]);
    const suppliers = await t.http
      .get(`/companies/${companyId}/contacts?kind=supplier`)
      .set(owner.auth)
      .expect(200);
    expect(suppliers.body[0]).toMatchObject({ id: molino, balance: 5900 });

    const detail = await t.http
      .get(`/companies/${companyId}/contacts/${ana}`)
      .set(owner.auth)
      .expect(200);
    expect(detail.body.movements.map((m: { amount: number }) => m.amount)).toEqual([11800, -5000]);
    expect(detail.body.movements.map((m: { balance: number }) => m.balance)).toEqual([11800, 6800]);

    // El asiento muestra el cliente en su línea de por cobrar.
    const journal = await t.http
      .get(`/companies/${companyId}/journal?period=2025-03`)
      .set(owner.auth)
      .expect(200);
    const sale = journal.body.entries[0];
    expect(
      sale.lines.find((l: { accountCode: string }) => l.accountCode === '1212').contact,
    ).toEqual({
      id: ana,
      name: 'Restaurante Ana',
    });

    // Anular la venta también la saca del saldo del cliente.
    await t.http
      .post(`/companies/${companyId}/journal/${sale.id}/reverse`)
      .set(owner.auth)
      .send({})
      .expect(201);
    const after = await t.http.get(`/companies/${companyId}/contacts/${ana}`).set(owner.auth);
    expect(after.body.contact.balance).toBe(-5000);
  });

  it('rechaza contactos que no corresponden', async () => {
    const companyId = await createCompany(t, owner);
    const other = await createCompany(t, owner);
    const customer = await contact(companyId, 'customer', 'Cliente Uno');
    const supplier = await contact(companyId, 'supplier', 'Proveedor Uno');
    const foreign = await contact(other, 'customer', 'De otra empresa');
    const cases: [object, string][] = [
      [
        {
          contactId: customer,
          operation: { type: 'sale', total: 100, kind: 'goods', paidWith: 'cash' },
        },
        'contact_not_needed',
      ],
      [
        { contactId: supplier, operation: { type: 'collection', total: 100, into: 'cash' } },
        'contact_wrong_kind',
      ],
      [
        { contactId: foreign, operation: { type: 'collection', total: 100, into: 'cash' } },
        'contact_not_found',
      ],
    ];
    for (const [body, code] of cases) {
      const res = await record(companyId, body).expect(400);
      expect(res.body.code, code).toBe(code);
    }

    // Archivado: deja de aparecer y no se usa al anotar.
    await t.http
      .patch(`/companies/${companyId}/contacts/${customer}`)
      .set(owner.auth)
      .send({ archived: true })
      .expect(200);
    const list = await t.http.get(`/companies/${companyId}/contacts`).set(owner.auth).expect(200);
    expect(list.body.map((c: { id: string }) => c.id)).toEqual([supplier]);
    const archived = await record(companyId, {
      contactId: customer,
      operation: { type: 'collection', total: 100, into: 'cash' },
    }).expect(400);
    expect(archived.body.code).toBe('contact_not_found');
  });

  it('valida el RUC y no lo repite en el mismo tipo', async () => {
    const companyId = await createCompany(t, owner);
    const ruc = randomRuc();
    await contact(companyId, 'customer', 'Tienda Sol', ruc);
    const dup = await t.http
      .post(`/companies/${companyId}/contacts`)
      .set(owner.auth)
      .send({ kind: 'customer', name: 'Tienda Sol 2', ruc })
      .expect(409);
    expect(dup.body.code).toBe('contact_exists');
    // El mismo RUC puede ser también proveedor.
    await contact(companyId, 'supplier', 'Tienda Sol', ruc);
    const bad = await t.http
      .post(`/companies/${companyId}/contacts`)
      .set(owner.auth)
      .send({ kind: 'customer', name: 'Mal RUC', ruc: '20131312954' })
      .expect(400);
    expect(bad.body.code).toBe('invalid_ruc');
  });

  it('quien solo consulta ve los contactos pero no los crea', async () => {
    const companyId = await createCompany(t, owner);
    const viewer = await signUp(t);
    await addMember(t, companyId, owner, viewer, 'viewer');
    await t.http.get(`/companies/${companyId}/contacts`).set(viewer.auth).expect(200);
    await t.http
      .post(`/companies/${companyId}/contacts`)
      .set(viewer.auth)
      .send({ kind: 'customer', name: 'No debería' })
      .expect(403);
  });

  it('la base no deja ligar un contacto de otra empresa', async () => {
    const a = await createCompany(t, owner);
    const b = await createCompany(t, owner);
    const foreign = await contact(b, 'customer', 'Ajeno');
    const [cash] = await t.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.companyId, a), eq(accounts.code, '1011')));
    const entry = await record(a, {
      date: '2025-03-05',
      operation: { type: 'sale', total: 100, kind: 'goods', paidWith: 'cash' },
    }).expect(201);
    expect(
      await constraintOf(
        t.db.insert(journalLines).values({
          entryId: entry.body.entry.id,
          companyId: a,
          lineNo: 9,
          accountId: cash.id,
          debitCents: 1,
          contactId: foreign,
        }),
      ),
    ).toBe('journal_lines_contact_fk');
  });
});
