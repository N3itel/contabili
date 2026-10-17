import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, count, eq } from 'drizzle-orm';
import { licenseState, PLANS, type PlanCode } from '../billing/plans.js';
import { apiError } from '../common/http.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { companyLicenses, companyMembers } from '../db/schema/index.js';
import { hasRole, type MemberRole } from './roles.js';

/** Misma respuesta si la empresa no existe o si no eres parte de ella. */
export const companyNotFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'company_not_found', 'No encontramos la empresa.');

export const licenseExpired = () =>
  apiError(
    HttpStatus.PAYMENT_REQUIRED,
    'license_expired',
    'El plan de esta empresa venció. Tus datos siguen aquí para consultarlos; renueva el plan para seguir registrando.',
  );

type Reader = Pick<Database, 'select'>;

/**
 * Permisos dentro de una empresa, leídos de la base en cada pedido: sacar a
 * alguien o bajarle el rol tiene efecto inmediato. Las escrituras exigen
 * además la licencia vigente; leer siempre se puede.
 */
@Injectable()
export class CompanyAccess {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async require(companyId: string, userId: string, min: MemberRole): Promise<MemberRole> {
    const [member] = await this.db
      .select({ role: companyMembers.role })
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)));
    if (!member) throw companyNotFound();
    if (!hasRole(member.role, min)) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'forbidden',
        min === 'owner'
          ? 'Solo quien es dueño de la empresa puede hacer esto.'
          : 'Tu rol en esta empresa solo permite consultar.',
      );
    }
    return member.role;
  }

  /** Como `require`, y además con la licencia de la empresa vigente. */
  async requireWritable(companyId: string, userId: string, min: MemberRole): Promise<MemberRole> {
    const role = await this.require(companyId, userId, min);
    await assertLicenseActive(this.db, companyId);
    return role;
  }
}

/** Plan vigente de la empresa; si venció, error 402. */
export async function assertLicenseActive(db: Reader, companyId: string): Promise<PlanCode> {
  const [license] = await db
    .select()
    .from(companyLicenses)
    .where(eq(companyLicenses.companyId, companyId));
  if (!license) throw licenseExpired();
  const state = licenseState(
    {
      plan: license.plan as PlanCode,
      trialEndsAt: license.trialEndsAt,
      paidThrough: license.paidThrough,
    },
    new Date(),
  );
  if (state.status === 'expired') throw licenseExpired();
  return state.plan;
}

/** Cuántas personas hay en la empresa y cuántas permite su plan. */
export async function memberRoom(
  db: Reader,
  companyId: string,
  plan: PlanCode,
): Promise<{ members: number; max: number }> {
  const [row] = await db
    .select({ n: count() })
    .from(companyMembers)
    .where(eq(companyMembers.companyId, companyId));
  return { members: row.n, max: PLANS[plan].maxMembers };
}

export const planFull = (max: number) =>
  apiError(
    HttpStatus.CONFLICT,
    'plan_member_limit',
    `El plan de esta empresa permite hasta ${max} personas. Cambia de plan o saca a alguien antes.`,
  );
