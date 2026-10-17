import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { parentCode, PCGE_ACCOUNTS } from '../accounting/pcge.js';
import { audit } from '../common/audit.js';
import { apiError } from '../common/http.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { accounts, companies, companyLicenses, companyMembers } from '../db/schema/index.js';
import { TRIAL_DAYS, TRIAL_PLAN } from '../billing/plans.js';
import { isValidRuc } from '../tax/ruc.js';
import { companyNotFound } from './company-access.js';
import type { MemberRole } from './roles.js';

export type TaxRegime = (typeof companies.$inferInsert)['taxRegime'];

export interface NewCompany {
  ruc: string;
  legalName: string;
  taxRegime: TaxRegime;
}

export interface CompanyDto {
  id: string;
  ruc: string;
  legalName: string;
  taxRegime: TaxRegime;
  /** Libros cerrados hasta esta fecha (inclusive). */
  closedThrough: string | null;
  /** Tu rol en la empresa. */
  role: MemberRole;
}

const companyColumns = {
  id: companies.id,
  ruc: companies.ruc,
  legalName: companies.legalName,
  taxRegime: companies.taxRegime,
  closedThrough: companies.closedThrough,
  role: companyMembers.role,
};

@Injectable()
export class CompaniesService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Crea la empresa con el PCGE base; quien la crea queda como dueño. */
  async create(input: NewCompany, ownerId: string): Promise<CompanyDto> {
    if (!isValidRuc(input.ruc)) {
      throw apiError(HttpStatus.BAD_REQUEST, 'invalid_ruc', 'El RUC no es válido.');
    }
    return this.db.transaction(async (tx) => {
      // Una persona a la vez: dos pedidos iguales no crean la empresa dos veces.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`company:${ownerId}`}))`);
      const [mine] = await tx
        .select({ id: companies.id })
        .from(companyMembers)
        .innerJoin(companies, eq(companies.id, companyMembers.companyId))
        .where(and(eq(companyMembers.userId, ownerId), eq(companies.ruc, input.ruc)));
      if (mine) {
        throw apiError(
          HttpStatus.CONFLICT,
          'ruc_already_yours',
          'Ya tienes una empresa con ese RUC.',
          { companyId: mine.id },
        );
      }
      const [company] = await tx.insert(companies).values(input).returning({ id: companies.id });
      await tx
        .insert(companyMembers)
        .values({ companyId: company.id, userId: ownerId, role: 'owner' });
      await tx.insert(companyLicenses).values({
        companyId: company.id,
        plan: TRIAL_PLAN,
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000),
      });

      const parents = new Set(PCGE_ACCOUNTS.map((a) => parentCode(a.code)));
      const ids = new Map<string, string>();
      // El plan va de madres a hijas: cada cuenta encuentra el id de su madre.
      for (const a of [...PCGE_ACCOUNTS].sort((x, y) => x.code.length - y.code.length)) {
        const parent = parentCode(a.code);
        const [row] = await tx
          .insert(accounts)
          .values({
            companyId: company.id,
            code: a.code,
            name: a.name,
            nature: a.nature,
            parentId: parent ? ids.get(parent) : null,
            allowsPosting: !parents.has(a.code),
          })
          .returning({ id: accounts.id });
        ids.set(a.code, row.id);
      }
      await audit(tx, {
        actorId: ownerId,
        action: 'company.created',
        entity: 'company',
        entityId: company.id,
      });
      return { id: company.id, ...input, closedThrough: null, role: 'owner' as const };
    });
  }

  /** Las empresas en las que participas. */
  async listFor(userId: string): Promise<CompanyDto[]> {
    return this.db
      .select(companyColumns)
      .from(companyMembers)
      .innerJoin(companies, eq(companies.id, companyMembers.companyId))
      .where(eq(companyMembers.userId, userId))
      .orderBy(asc(companies.legalName));
  }

  async get(companyId: string, userId: string): Promise<CompanyDto> {
    const [row] = await this.db
      .select(companyColumns)
      .from(companyMembers)
      .innerJoin(companies, eq(companies.id, companyMembers.companyId))
      .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)));
    if (!row) throw companyNotFound();
    return row;
  }
}
