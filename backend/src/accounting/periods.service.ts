import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { audit } from '../common/audit.js';
import { apiError } from '../common/http.js';
import { CompanyAccess } from '../companies/company-access.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { companies, periodClosings, users } from '../db/schema/index.js';
import { limaDate, periodRange } from './lima.js';
import { closeProblem, reopenTarget } from './period-rules.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface PeriodsDto {
  /** Libros cerrados hasta esta fecha (inclusive); null si no hay nada cerrado. */
  closedThrough: string | null;
  history: {
    action: string;
    closedThrough: string | null;
    previousClosedThrough: string | null;
    reason: string | null;
    actor: string;
    createdAt: Date;
  }[];
}

@Injectable()
export class PeriodsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(CompanyAccess) private readonly access: CompanyAccess,
  ) {}

  async get(companyId: string, actorId: string): Promise<PeriodsDto> {
    await this.access.require(companyId, actorId, 'viewer');
    const [company] = await this.db
      .select({ closedThrough: companies.closedThrough })
      .from(companies)
      .where(eq(companies.id, companyId));
    const history = await this.db
      .select({
        action: periodClosings.action,
        closedThrough: periodClosings.closedThrough,
        previousClosedThrough: periodClosings.previousClosedThrough,
        reason: periodClosings.reason,
        actor: users.fullName,
        createdAt: periodClosings.createdAt,
      })
      .from(periodClosings)
      .innerJoin(users, eq(users.id, periodClosings.actorId))
      .where(eq(periodClosings.companyId, companyId))
      .orderBy(desc(periodClosings.createdAt))
      .limit(50);
    return { closedThrough: company?.closedThrough ?? null, history };
  }

  /** Cierra el mes 'AAAA-MM' (y todo lo anterior). Lo hace quien registra asientos. */
  async close(companyId: string, actorId: string, period: string): Promise<PeriodsDto> {
    await this.access.require(companyId, actorId, 'accountant');
    await this.db.transaction(async (tx) => {
      const previous = await this.lock(tx, companyId);
      const problem = closeProblem({
        period,
        today: limaDate(new Date()),
        closedThrough: previous,
      });
      if (problem === 'period_not_ended') {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          problem,
          'Ese mes todavía no termina: podrás cerrarlo desde el primer día del mes siguiente.',
        );
      }
      if (problem === 'already_closed') {
        throw apiError(HttpStatus.CONFLICT, problem, 'Ese mes ya está cerrado.');
      }
      await this.apply(tx, companyId, actorId, {
        action: 'close',
        previous,
        next: periodRange(period).to,
        reason: null,
      });
    });
    return this.get(companyId, actorId);
  }

  /** Reabre desde el mes 'AAAA-MM'. Solo el dueño, y diciendo por qué. */
  async reopen(
    companyId: string,
    actorId: string,
    period: string,
    reason: string,
  ): Promise<PeriodsDto> {
    await this.access.require(companyId, actorId, 'owner');
    await this.db.transaction(async (tx) => {
      const previous = await this.lock(tx, companyId);
      const target = reopenTarget({ period, closedThrough: previous });
      if (target === 'not_closed') {
        throw apiError(HttpStatus.CONFLICT, 'not_closed', 'Ese mes no está cerrado.');
      }
      await this.apply(tx, companyId, actorId, {
        action: 'reopen',
        previous,
        // Lo anterior al mes reabierto sigue cerrado.
        next: target.closedThrough,
        reason,
      });
    });
    return this.get(companyId, actorId);
  }

  /** Bloquea la empresa: los asientos esperan a que termine el cierre. */
  private async lock(tx: Tx, companyId: string): Promise<string | null> {
    const [company] = await tx
      .select({ closedThrough: companies.closedThrough })
      .from(companies)
      .where(eq(companies.id, companyId))
      .for('update');
    return company.closedThrough;
  }

  private async apply(
    tx: Tx,
    companyId: string,
    actorId: string,
    change: {
      action: 'close' | 'reopen';
      previous: string | null;
      next: string;
      reason: string | null;
    },
  ): Promise<void> {
    await tx
      .update(companies)
      .set({ closedThrough: change.next })
      .where(eq(companies.id, companyId));
    await tx.insert(periodClosings).values({
      companyId,
      action: change.action,
      previousClosedThrough: change.previous,
      closedThrough: change.next,
      reason: change.reason,
      actorId,
    });
    await audit(tx, {
      actorId,
      action: change.action === 'close' ? 'period.closed' : 'period.reopened',
      entity: 'company',
      entityId: companyId,
      data: { from: change.previous, to: change.next },
    });
  }
}
