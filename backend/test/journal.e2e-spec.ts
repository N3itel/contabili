import { and, eq, sql } from 'drizzle-orm';
import { accounts, journalEntries, journalLines } from '../src/db/schema/index.js';
import {
  addMember,
  constraintOf,
  createCompany,
  createTestApp,
  signUp,
  type Person,
  type TestApp,
} from './helpers.js';

const line = (accountCode: string, debit: number, credit: number) => ({
  accountCode,
  debit,
  credit,
});

/** Venta de S/ 100 + IGV al crédito. */
const sale = (entryDate: string, description = 'Venta con factura F001-1') => ({
  entryDate,
  description,
  lines: [line('1212', 11800, 0), line('40111', 0, 1800), line('7011', 0, 10000)],
});

/** Cobro de esa venta en caja. */
const collection = (entryDate: string) => ({
  entryDate,
  description: 'Cobro de la factura F001-1',
  lines: [line('1011', 11800, 0), line('1212', 0, 11800)],
});

describe('libro diario, mayor y balance (e2e)', () => {
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

  it('registra el asiento con su número, autor y totales', async () => {
    const companyId = await createCompany(t, owner);
    const res = await post(companyId, owner, sale('2025-03-10')).expect(201);
    expect(res.body).toMatchObject({
      fiscalYear: 2025,
      number: 1,
      entryDate: '2025-03-10',
      createdBy: { id: owner.userId, fullName: 'Rosa Dueña' },
      totals: { debit: 11800, credit: 11800 },
      reversesEntryId: null,
      reversedByEntryId: null,
    });
    expect(res.body.lines[1]).toEqual({
      lineNo: 2,
      accountCode: '40111',
      accountName: 'IGV – Cuenta propia',
      debit: 0,
      credit: 1800,
    });
  });

  it('numera por ejercicio, también con pedidos en paralelo', async () => {
    const companyId = await createCompany(t, owner);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => post(companyId, owner, sale('2025-06-30'))),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(results.map((r) => r.body.number).sort()).toEqual([1, 2, 3, 4, 5]);
    const other = await post(companyId, owner, sale('2024-06-30')).expect(201);
    expect(other.body.number).toBe(1);
  });

  it('rechaza asientos que no cuadran, a cuentas madre, inexistentes o con fecha futura', async () => {
    const companyId = await createCompany(t, owner);
    const base = sale('2025-03-10');
    const cases: [object, string][] = [
      [{ ...base, lines: [base.lines[0], line('7011', 0, 11799)] }, 'unbalanced'],
      [{ ...base, lines: [line('12', 11800, 0), ...base.lines.slice(1)] }, 'account_not_postable'],
      [{ ...base, lines: [line('1299', 11800, 0), ...base.lines.slice(1)] }, 'account_not_found'],
      [{ ...base, lines: [line('1212', 100, 100), line('7011', 0, 0)] }, 'debit_and_credit'],
      [{ ...base, entryDate: '2999-01-01' }, 'future_date'],
      [{ ...base, entryDate: '2025-02-30' }, 'invalid_request'],
      [{ ...base, lines: [line('1212', 10.5, 0), line('7011', 0, 10.5)] }, 'invalid_request'],
    ];
    for (const [body, code] of cases) {
      const res = await post(companyId, owner, body).expect(400);
      expect(res.body.code, code).toBe(code);
    }
  });

  it('quien solo consulta no registra asientos', async () => {
    const companyId = await createCompany(t, owner);
    const viewer = await signUp(t);
    await addMember(t, companyId, owner, viewer, 'viewer');
    const res = await post(companyId, viewer, sale('2025-03-10')).expect(403);
    expect(res.body.code).toBe('forbidden');
    const accountant = await signUp(t);
    await addMember(t, companyId, owner, accountant, 'accountant');
    await post(companyId, accountant, sale('2025-03-10')).expect(201);
  });

  it('lista el diario de un periodo por páginas', async () => {
    const companyId = await createCompany(t, owner);
    await post(companyId, owner, sale('2025-03-10')).expect(201);
    await post(companyId, owner, collection('2025-03-20')).expect(201);
    await post(companyId, owner, sale('2025-04-01')).expect(201);
    const march = await t.http
      .get(`/companies/${companyId}/journal?period=2025-03`)
      .set(owner.auth)
      .expect(200);
    expect(march.body.entries.map((e: { number: number }) => e.number)).toEqual([1, 2]);
    expect(march.body.nextAfter).toBeNull();
    const after = await t.http
      .get(`/companies/${companyId}/journal?period=2025-03&after=1`)
      .set(owner.auth)
      .expect(200);
    expect(after.body.entries.map((e: { number: number }) => e.number)).toEqual([2]);
    await t.http.get(`/companies/${companyId}/journal?period=2025-13`).set(owner.auth).expect(400);
  });

  it('extorna una sola vez, con los montos al revés', async () => {
    const companyId = await createCompany(t, owner);
    const original = await post(companyId, owner, sale('2025-03-10')).expect(201);
    const url = `/companies/${companyId}/journal/${original.body.id}/reverse`;
    const early = await t.http
      .post(url)
      .set(owner.auth)
      .send({ entryDate: '2025-03-09' })
      .expect(400);
    expect(early.body.code).toBe('reversal_before_entry');

    const reversal = await t.http
      .post(url)
      .set(owner.auth)
      .send({ entryDate: '2025-03-11' })
      .expect(201);
    expect(reversal.body).toMatchObject({
      number: 2,
      reversesEntryId: original.body.id,
      description: 'Extorno del asiento 1-2025',
    });
    expect(reversal.body.lines[0]).toMatchObject({ accountCode: '1212', debit: 0, credit: 11800 });

    const again = await t.http
      .post(url)
      .set(owner.auth)
      .send({ entryDate: '2025-03-11' })
      .expect(409);
    expect(again.body.code).toBe('already_reversed');
    const ofReversal = await t.http
      .post(`/companies/${companyId}/journal/${reversal.body.id}/reverse`)
      .set(owner.auth)
      .send({})
      .expect(409);
    expect(ofReversal.body.code).toBe('is_reversal');

    const reread = await t.http
      .get(`/companies/${companyId}/journal/${original.body.id}`)
      .set(owner.auth)
      .expect(200);
    expect(reread.body.reversedByEntryId).toBe(reversal.body.id);
  });

  it('abre subcuentas: la madre pasa a agrupar y una cuenta con asientos no se divide', async () => {
    const companyId = await createCompany(t, owner);
    const created = await t.http
      .post(`/companies/${companyId}/accounts`)
      .set(owner.auth)
      .send({ code: '10411', name: 'BCP soles' })
      .expect(201);
    expect(created.body).toMatchObject({
      nature: 'debit',
      parentCode: '1041',
      allowsPosting: true,
    });
    const list = await t.http.get(`/companies/${companyId}/accounts`).set(owner.auth).expect(200);
    expect(list.body.find((a: { code: string }) => a.code === '1041').allowsPosting).toBe(false);

    await post(companyId, owner, sale('2025-03-10')).expect(201);
    const split = await t.http
      .post(`/companies/${companyId}/accounts`)
      .set(owner.auth)
      .send({ code: '12121', name: 'Clientes locales' })
      .expect(409);
    expect(split.body.code).toBe('parent_has_entries');
    const orphan = await t.http
      .post(`/companies/${companyId}/accounts`)
      .set(owner.auth)
      .send({ code: '18111', name: 'Seguros' })
      .expect(400);
    expect(orphan.body.code).toBe('parent_not_found');
    const dup = await t.http
      .post(`/companies/${companyId}/accounts`)
      .set(owner.auth)
      .send({ code: '10411', name: 'BCP otra vez' })
      .expect(409);
    expect(dup.body.code).toBe('account_exists');
    const top = await t.http
      .post(`/companies/${companyId}/accounts`)
      .set(owner.auth)
      .send({ code: '29', name: 'Desvalorización de existencias', nature: 'credit' })
      .expect(201);
    expect(top.body.nature).toBe('credit');
  });

  it('el mayor da saldo inicial, saldos acumulados y final; las madres suman sus subcuentas', async () => {
    const companyId = await createCompany(t, owner);
    await post(companyId, owner, sale('2025-02-27')).expect(201);
    await post(companyId, owner, sale('2025-03-10')).expect(201);
    await post(companyId, owner, collection('2025-03-20')).expect(201);

    const ledger = await t.http
      .get(`/companies/${companyId}/ledger/1212?from=2025-03-01&to=2025-03-31`)
      .set(owner.auth)
      .expect(200);
    expect(ledger.body).toMatchObject({
      account: { code: '1212', nature: 'debit' },
      openingBalance: 11800,
      totals: { debit: 11800, credit: 11800 },
      closingBalance: 11800,
      truncated: false,
    });
    expect(ledger.body.movements.map((m: { balance: number }) => m.balance)).toEqual([
      23600, 11800,
    ]);

    // La 40 (madre) incluye el IGV de la 40111, con saldo acreedor positivo.
    const taxes = await t.http
      .get(`/companies/${companyId}/ledger/40?from=2025-01-01&to=2025-12-31`)
      .set(owner.auth)
      .expect(200);
    expect(taxes.body.closingBalance).toBe(3600);
    expect(taxes.body.movements[0].accountCode).toBe('40111');

    await t.http.get(`/companies/${companyId}/ledger/9999`).set(owner.auth).expect(404);
    const range = await t.http
      .get(`/companies/${companyId}/ledger/1212?from=2025-04-01&to=2025-03-01`)
      .set(owner.auth)
      .expect(400);
    expect(range.body.code).toBe('invalid_range');
  });

  it('el balance de comprobación cuadra', async () => {
    const companyId = await createCompany(t, owner);
    await post(companyId, owner, sale('2025-03-10')).expect(201);
    await post(companyId, owner, collection('2025-03-20')).expect(201);
    const res = await t.http
      .get(`/companies/${companyId}/trial-balance?from=2025-01-01&to=2025-12-31`)
      .set(owner.auth)
      .expect(200);
    expect(res.body.rows).toEqual([
      expect.objectContaining({ code: '1011', debit: 11800, credit: 0, debitBalance: 11800 }),
      expect.objectContaining({
        code: '1212',
        debit: 11800,
        credit: 11800,
        debitBalance: 0,
        creditBalance: 0,
      }),
      expect.objectContaining({ code: '40111', creditBalance: 1800 }),
      expect.objectContaining({ code: '7011', creditBalance: 10000 }),
    ]);
    expect(res.body.totals).toEqual({
      debit: 23600,
      credit: 23600,
      debitBalance: 11800,
      creditBalance: 11800,
    });
  });

  describe('restricciones de la base', () => {
    it('los asientos no se editan ni se borran', async () => {
      const companyId = await createCompany(t, owner);
      const entry = await post(companyId, owner, sale('2025-03-10')).expect(201);
      expect(
        await constraintOf(
          t.db
            .update(journalLines)
            .set({ debitCents: 11700 })
            .where(eq(journalLines.entryId, entry.body.id)),
        ),
      ).toBe('journal_immutable');
      expect(
        await constraintOf(t.db.delete(journalEntries).where(eq(journalEntries.id, entry.body.id))),
      ).toBe('journal_immutable');
    });

    it('una línea suelta que descuadra un asiento se rechaza al confirmar', async () => {
      const companyId = await createCompany(t, owner);
      const entry = await post(companyId, owner, sale('2025-03-10')).expect(201);
      const [cash] = await t.db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.companyId, companyId), eq(accounts.code, '1011')));
      expect(
        await constraintOf(
          t.db.insert(journalLines).values({
            entryId: entry.body.id,
            companyId,
            lineNo: 4,
            accountId: cash.id,
            debitCents: 100,
          }),
        ),
      ).toBe('journal_entries_balanced');
    });

    it('no deja un asiento sin líneas ni con el ejercicio cambiado', async () => {
      const companyId = await createCompany(t, owner);
      const values = {
        companyId,
        fiscalYear: 2025,
        number: 99,
        entryDate: '2025-03-10',
        description: 'Vacío',
        createdBy: owner.userId,
      };
      expect(await constraintOf(t.db.insert(journalEntries).values(values))).toBe(
        'journal_entries_min_lines',
      );
      expect(
        await constraintOf(t.db.insert(journalEntries).values({ ...values, fiscalYear: 2024 })),
      ).toBe('journal_entries_fiscal_year');
    });

    it('exige un solo lado por línea y cuentas de la misma empresa', async () => {
      const a = await createCompany(t, owner);
      const b = await createCompany(t, owner);
      const entry = await post(a, owner, sale('2025-03-10')).expect(201);
      const [otherCash] = await t.db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.companyId, b), eq(accounts.code, '1011')));
      const lineOf = (accountId: string, debitCents: number, creditCents: number) =>
        t.db.transaction(async (tx) => {
          await tx.insert(journalLines).values([
            {
              entryId: entry.body.id,
              companyId: a,
              lineNo: 10,
              accountId,
              debitCents,
              creditCents,
            },
          ]);
          await tx.execute(sql`set constraints all immediate`);
        });
      expect(await constraintOf(lineOf(otherCash.id, 100, 100))).toBe('journal_lines_one_side');
      expect(await constraintOf(lineOf(otherCash.id, 100, 0))).toBe('journal_lines_account_fk');
    });
  });
});
