import type { INestApplication } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { CompaniesService } from '../src/accounting/companies.service.js';
import { JournalService } from '../src/accounting/journal.service.js';
import { DRIZZLE, type Database } from '../src/db/db.module.js';
import { accounts, journalEntries, journalLines } from '../src/db/schema/index.js';
import { createTestApp, randomRuc } from './helpers.js';

/** Error de PostgreSQL detrás del de drizzle: restricción que saltó. */
async function constraintOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (e) {
    const err = e as { constraint?: string; cause?: { constraint?: string } };
    return err.cause?.constraint ?? err.constraint;
  }
  throw new Error('Se esperaba un error de la base');
}

describe('libro diario (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let companiesService: CompaniesService;
  let journal: JournalService;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DRIZZLE);
    companiesService = app.get(CompaniesService);
    journal = app.get(JournalService);
  });

  afterAll(async () => {
    await app.close();
  });

  const newCompany = () =>
    companiesService.create({ ruc: randomRuc(), legalName: 'Bodega Prueba SAC', taxRegime: 'rmt' });

  const sale = (entryDate = '2026-10-17') => ({
    entryDate,
    description: 'Venta con factura F001-1',
    lines: [
      { accountCode: '1212', debit: 11800, credit: 0 },
      { accountCode: '40111', debit: 0, credit: 1800 },
      { accountCode: '7011', debit: 0, credit: 10000 },
    ],
  });

  it('crea la empresa con el PCGE y solo deja asentar en cuentas de detalle', async () => {
    const { id } = await newCompany();
    const rows = await db.select().from(accounts).where(eq(accounts.companyId, id));
    const byCode = new Map(rows.map((r) => [r.code, r]));
    expect(byCode.get('40')?.allowsPosting).toBe(false);
    expect(byCode.get('40111')?.allowsPosting).toBe(true);
    expect(byCode.get('40111')?.parentId).toBe(byCode.get('4011')?.id);
  });

  it('rechaza un RUC inválido o repetido', async () => {
    await expect(
      companiesService.create({ ruc: '20131312954', legalName: 'X', taxRegime: 'general' }),
    ).rejects.toMatchObject({ response: { code: 'invalid_ruc' } });
    const ruc = randomRuc();
    await companiesService.create({ ruc, legalName: 'X', taxRegime: 'general' });
    await expect(
      companiesService.create({ ruc, legalName: 'Y', taxRegime: 'general' }),
    ).rejects.toMatchObject({ response: { code: 'ruc_taken' } });
  });

  it('numera los asientos por ejercicio, también en paralelo', async () => {
    const { id } = await newCompany();
    const results = await Promise.all(Array.from({ length: 5 }, () => journal.post(id, sale())));
    expect(results.map((r) => r.number).sort()).toEqual([1, 2, 3, 4, 5]);
    expect((await journal.post(id, sale('2027-01-02'))).number).toBe(1);
  });

  it('rechaza asientos descuadrados o a cuentas que solo agrupan', async () => {
    const { id } = await newCompany();
    const bad = sale();
    await expect(
      journal.post(id, { ...bad, lines: [bad.lines[0], { ...bad.lines[2], credit: 11799 }] }),
    ).rejects.toMatchObject({ response: { code: 'unbalanced' } });
    await expect(
      journal.post(id, {
        ...bad,
        lines: [{ ...bad.lines[0], accountCode: '12' }, ...bad.lines.slice(1)],
      }),
    ).rejects.toMatchObject({ response: { code: 'account_not_postable' } });
    await expect(
      journal.post(id, {
        ...bad,
        lines: [{ ...bad.lines[0], accountCode: '1299' }, ...bad.lines.slice(1)],
      }),
    ).rejects.toMatchObject({ response: { code: 'account_not_found' } });
  });

  describe('restricciones de la base', () => {
    it('no deja descuadrar un asiento al confirmar', async () => {
      const { id } = await newCompany();
      const entry = await journal.post(id, sale());
      const [line] = await db
        .select({ id: journalLines.id })
        .from(journalLines)
        .where(and(eq(journalLines.entryId, entry.id), eq(journalLines.lineNo, 1)));

      expect(
        await constraintOf(
          db.update(journalLines).set({ debitCents: 11700 }).where(eq(journalLines.id, line.id)),
        ),
      ).toBe('journal_entries_balanced');
      expect(await constraintOf(db.delete(journalLines).where(eq(journalLines.id, line.id)))).toBe(
        'journal_entries_balanced',
      );
      // Borrar el asiento completo sí cuadra.
      await db.delete(journalEntries).where(eq(journalEntries.id, entry.id));
    });

    it('no deja un asiento sin líneas', async () => {
      const { id } = await newCompany();
      expect(
        await constraintOf(
          db.insert(journalEntries).values({
            companyId: id,
            fiscalYear: 2026,
            number: 1,
            entryDate: '2026-10-17',
            description: 'Vacío',
          }),
        ),
      ).toBe('journal_entries_min_lines');
    });

    it('exige un solo lado por línea y cuentas de la misma empresa', async () => {
      const a = await newCompany();
      const b = await newCompany();
      const entry = await journal.post(a.id, sale());
      const [otherAccount] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.companyId, b.id), eq(accounts.code, '1011')));

      expect(
        await constraintOf(
          db.execute(
            sql`update journal_lines set credit_cents = 1 where entry_id = ${entry.id} and line_no = 1`,
          ),
        ),
      ).toBe('journal_lines_one_side');
      expect(
        await constraintOf(
          db
            .update(journalLines)
            .set({ accountId: otherAccount.id })
            .where(eq(journalLines.entryId, entry.id)),
        ),
      ).toBe('journal_lines_account_fk');
    });

    it('el ejercicio coincide con la fecha', async () => {
      const { id } = await newCompany();
      expect(
        await constraintOf(
          db.insert(journalEntries).values({
            companyId: id,
            fiscalYear: 2025,
            number: 1,
            entryDate: '2026-10-17',
            description: 'Mal año',
          }),
        ),
      ).toBe('journal_entries_fiscal_year');
    });
  });
});
