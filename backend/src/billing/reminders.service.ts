import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, sql } from 'drizzle-orm';
import { SMS_SENDER, type SmsSender } from '../auth/sms.js';
import type { Env } from '../config/env.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import {
  companies,
  companyLicenses,
  companyMembers,
  licenseReminders,
  users,
} from '../db/schema/index.js';
import type { PlanCode } from './plans.js';
import {
  dueReminder,
  ENDED_REMINDER_WINDOW_DAYS,
  isReminderHour,
  MAX_REMINDER_RECIPIENTS,
  REMINDER_DAYS_BEFORE,
  reminderText,
} from './reminder-rules.js';

const DAY_MS = 86_400_000;

/**
 * Avisa por SMS a los dueños que su prueba o su plan está por vencer o ya
 * venció. Corre cada hora en todas las instancias: el aviso se reserva con
 * una inserción única antes de mandarlo, así sale una sola vez.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger('Avisos');
  private readonly planUrl: string;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @Inject(ConfigService) config: ConfigService<Env, true>,
  ) {
    this.planUrl = `${config.get('PUBLIC_WEB_URL', { infer: true })}/mi-plan`;
  }

  /** Manda los avisos que tocan; devuelve a cuántas empresas se avisó. */
  async sweep(now = new Date()): Promise<number> {
    if (!isReminderHour(now)) return 0;
    const from = new Date(now.getTime() - ENDED_REMINDER_WINDOW_DAYS * DAY_MS);
    const to = new Date(now.getTime() + REMINDER_DAYS_BEFORE * DAY_MS);
    const end = sql`greatest(${companyLicenses.trialEndsAt}, coalesce(${companyLicenses.paidThrough}, ${companyLicenses.trialEndsAt}))`;
    const candidates = await this.db
      .select({
        companyId: companyLicenses.companyId,
        plan: companyLicenses.plan,
        trialEndsAt: companyLicenses.trialEndsAt,
        paidThrough: companyLicenses.paidThrough,
        legalName: companies.legalName,
      })
      .from(companyLicenses)
      .innerJoin(companies, eq(companies.id, companyLicenses.companyId))
      .where(sql`${end} BETWEEN ${from} AND ${to}`);
    let notified = 0;
    for (const c of candidates) {
      const due = dueReminder(
        { plan: c.plan as PlanCode, trialEndsAt: c.trialEndsAt, paidThrough: c.paidThrough },
        now,
      );
      if (!due) continue;
      const [claimed] = await this.db
        .insert(licenseReminders)
        .values({ companyId: c.companyId, kind: due.kind, endsAt: due.endsAt })
        .onConflictDoNothing()
        .returning({ id: licenseReminders.id });
      if (!claimed) continue;
      const owners = await this.db
        .select({ phone: users.phone })
        .from(companyMembers)
        .innerJoin(users, eq(users.id, companyMembers.userId))
        .where(
          and(
            eq(companyMembers.companyId, c.companyId),
            eq(companyMembers.role, 'owner'),
            eq(users.status, 'active'),
          ),
        )
        .orderBy(asc(companyMembers.createdAt))
        .limit(MAX_REMINDER_RECIPIENTS);
      const text = reminderText(due, c.legalName, this.planUrl);
      let sent = 0;
      for (const owner of owners) {
        try {
          await this.sms.send(owner.phone, text);
          sent++;
        } catch (error) {
          // Sin el número en el log: solo que falló.
          this.logger.warn(`No salió un aviso de vencimiento (${(error as Error).name})`);
        }
      }
      await this.db
        .update(licenseReminders)
        .set({ recipients: sent })
        .where(eq(licenseReminders.id, claimed.id));
      notified++;
    }
    return notified;
  }
}
