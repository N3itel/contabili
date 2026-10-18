import {
  dueReminder,
  GSM7,
  gsmSafe,
  isReminderHour,
  licenseEnd,
  reminderText,
  type DueReminder,
} from './reminder-rules.js';

const day = 86_400_000;
const now = new Date('2026-11-10T15:00:00Z');
const at = (days: number) => new Date(now.getTime() + days * day);
const trial = (endsInDays: number) => ({
  plan: 'negocio' as const,
  trialEndsAt: at(endsInDays),
  paidThrough: null,
});

describe('avisos de vencimiento', () => {
  it('avisa 3 días antes y otra vez al vencer, hasta una semana después', () => {
    expect(dueReminder(trial(5), now)).toBeNull();
    expect(dueReminder(trial(3), now)).toEqual({ kind: 'ending', endsAt: at(3), trial: true });
    expect(dueReminder(trial(0.5), now)?.kind).toBe('ending');
    expect(dueReminder(trial(-1), now)).toEqual({ kind: 'ended', endsAt: at(-1), trial: true });
    expect(dueReminder(trial(-7), now)?.kind).toBe('ended');
    expect(dueReminder(trial(-8), now)).toBeNull();
  });

  it('con un periodo pagado, cuenta el pago y no la prueba', () => {
    const paid = { plan: 'negocio' as const, trialEndsAt: at(-40), paidThrough: at(2) };
    expect(licenseEnd(paid)).toEqual(at(2));
    expect(dueReminder(paid, now)).toEqual({ kind: 'ending', endsAt: at(2), trial: false });
    // Pagó antes de que terminara la prueba: el periodo empieza al terminar la prueba.
    const early = { plan: 'negocio' as const, trialEndsAt: at(1), paidThrough: at(31) };
    expect(dueReminder(early, now)).toBeNull();
  });

  it('el SMS entra en un solo mensaje GSM-7, sin tildes', () => {
    const name = 'Bodega Doña Rosa Pérez y Asociados SAC';
    const reminders: DueReminder[] = [
      { kind: 'ending', endsAt: at(3), trial: true },
      { kind: 'ending', endsAt: at(3), trial: false },
      { kind: 'ended', endsAt: at(-1), trial: false },
    ];
    for (const r of reminders) {
      const text = reminderText(r, name, 'https://contabili.pe/mi-plan');
      expect(text.length).toBeLessThanOrEqual(160);
      expect([...text].every((c) => GSM7.includes(c))).toBe(true);
      expect(text).toContain('contabili.pe/mi-plan');
      expect(text).toContain('Bodega Doña Rosa Perez.');
    }
    expect(reminderText(reminders[0], 'Ferretería Sol', 'https://contabili.pe/mi-plan')).toBe(
      'Contabili: la prueba gratis de Ferreteria Sol termina el 13/11. Elige tu plan en contabili.pe/mi-plan y sigue anotando.',
    );
  });

  it('solo de día en Lima (9 a. m. a 8 p. m.)', () => {
    expect(isReminderHour(new Date('2026-11-10T13:59:00Z'))).toBe(false); // 8:59
    expect(isReminderHour(new Date('2026-11-10T14:00:00Z'))).toBe(true); // 9:00
    expect(isReminderHour(new Date('2026-11-11T00:59:00Z'))).toBe(true); // 19:59
    expect(isReminderHour(new Date('2026-11-11T01:00:00Z'))).toBe(false); // 20:00
  });

  it('quita tildes pero deja la ñ', () => {
    expect(gsmSafe('Ácido Ñandú Ómnibus')).toBe('Acido Ñandu Omnibus');
  });
});
