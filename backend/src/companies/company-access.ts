import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { apiError } from '../common/http.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { companyMembers } from '../db/schema/index.js';
import { hasRole, type MemberRole } from './roles.js';

/** Misma respuesta si la empresa no existe o si no eres parte de ella. */
export const companyNotFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'company_not_found', 'No encontramos la empresa.');

/**
 * Permisos dentro de una empresa, leídos de la base en cada pedido: sacar a
 * alguien o bajarle el rol tiene efecto inmediato.
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
}
