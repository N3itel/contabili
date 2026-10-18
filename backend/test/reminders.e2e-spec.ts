import { eq } from 'drizzle-orm';
import { RemindersService } from '../src/billing/reminders.service.js';
import { companyLicenses, licenseReminders } from '../src/db/schema/index.js';
import {
  addMember,
  constraintOf,
  createCompany,
  createTestApp,
  signUp,
  type Person,
  type TestApp,
} from './helpers.js';

const DAY = 86_400_000;

/** Un momento de día en Lima (10 a. m.), `days` días antes de `ref`. */
function daytime(ref: Date, days: number): Date {
  const d = new Date(ref.getTime() - days * DAY);
  d.setUTCHours(15, 0, 0, 0);
  return d;
}

describe('avisos de vencimiento por SMS (e2e)', () => {
  let t: TestApp;
  let reminders: RemindersService;
  let owner: Person;

  beforeAll(async () => {
    t = await createTestApp();
    reminders = t.app.get(RemindersService);
    owner = await signUp(t, undefined, 'Rosa Dueña');
  });

  afterAll(async () => {
    await t.app.close();
  });

  const messagesTo = (phone: string) => t.sms.messages.filter((m) => m.to === phone);

  it('avisa a los dueños 3 días antes y al vencer, una sola vez cada uno', async () => {
    const id = await createCompany(t, owner);
    const accountant = await signUp(t, undefined, 'Juan Contador');
    await addMember(t, id, owner, accountant, 'accountant');
    const [license] = await t.db
      .select()
      .from(companyLicenses)
      .where(eq(companyLicenses.companyId, id));
    const endsAt = license.trialEndsAt;

    // Cinco días antes todavía no toca.
    await reminders.sweep(daytime(endsAt, 5));
    expect(messagesTo(owner.phone).filter((m) => m.text.includes('prueba gratis'))).toHaveLength(0);

    const before = daytime(endsAt, 2);
    await reminders.sweep(before);
    await reminders.sweep(new Date(before.getTime() + 60 * 60_000));
    const ending = messagesTo(owner.phone).filter((m) => m.text.includes('prueba gratis'));
    expect(ending).toHaveLength(1);
    expect(ending[0].text).toMatch(/^Contabili: la prueba gratis de .+ termina el \d\d\/\d\d\. /);
    expect(ending[0].text).toContain('/mi-plan');
    // Solo a los dueños (al contador solo le llegó su código de ingreso).
    expect(messagesTo(accountant.phone).filter((m) => !m.text.includes('tu código'))).toHaveLength(
      0,
    );

    // De noche no sale nada, aunque toque.
    const night = new Date(endsAt.getTime() + DAY);
    night.setUTCHours(6, 0, 0, 0);
    await reminders.sweep(night);
    expect(messagesTo(owner.phone).filter((m) => m.text.includes('vencido'))).toHaveLength(0);

    await reminders.sweep(daytime(new Date(endsAt.getTime() + 2 * DAY), 0));
    const ended = messagesTo(owner.phone).filter((m) => m.text.includes('vencido'));
    expect(ended).toHaveLength(1);
    expect(ended[0].text).toContain('Tus datos se guardan');

    const rows = await t.db
      .select()
      .from(licenseReminders)
      .where(eq(licenseReminders.companyId, id));
    expect(rows.map((r) => [r.kind, r.recipients]).sort()).toEqual([
      ['ended', 1],
      ['ending', 1],
    ]);
  });

  it('la base no deja repetir un aviso para el mismo vencimiento', async () => {
    const id = await createCompany(t, owner);
    const endsAt = new Date('2030-01-01T05:00:00Z');
    await t.db.insert(licenseReminders).values({ companyId: id, kind: 'ending', endsAt });
    expect(
      await constraintOf(
        t.db.insert(licenseReminders).values({ companyId: id, kind: 'ending', endsAt }),
      ),
    ).toBe('license_reminders_once_uq');
    expect(
      await constraintOf(
        t.db.insert(licenseReminders).values({ companyId: id, kind: 'later', endsAt }),
      ),
    ).toBe('license_reminders_kind');
  });
});
