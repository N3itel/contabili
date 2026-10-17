import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { audit } from '../common/audit.js';
import { apiError } from '../common/http.js';
import { CompanyAccess } from '../companies/company-access.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { accounts, journalLines } from '../db/schema/index.js';
import { isValidAccountCode, natureForCode, parentCode, type AccountNature } from './pcge.js';

export interface AccountDto {
  code: string;
  name: string;
  nature: AccountNature;
  parentCode: string | null;
  /** Falso en las cuentas que solo agrupan: los asientos van a sus subcuentas. */
  allowsPosting: boolean;
}

@Injectable()
export class AccountsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(CompanyAccess) private readonly access: CompanyAccess,
  ) {}

  async list(companyId: string, actorId: string): Promise<AccountDto[]> {
    await this.access.require(companyId, actorId, 'viewer');
    const parent = alias(accounts, 'parent');
    return this.db
      .select({
        code: accounts.code,
        name: accounts.name,
        nature: accounts.nature,
        parentCode: parent.code,
        allowsPosting: accounts.allowsPosting,
      })
      .from(accounts)
      .leftJoin(parent, eq(parent.id, accounts.parentId))
      .where(eq(accounts.companyId, companyId))
      .orderBy(asc(accounts.code));
  }

  /**
   * Abre una cuenta. Las de 2 dígitos son cuentas del PCGE: toman la
   * naturaleza de su elemento salvo que se indique otra (como la 39, que resta
   * del activo). Las demás son subcuentas: heredan la naturaleza de su madre,
   * que desde entonces solo agrupa. Una cuenta con
   * movimientos no se divide: sus asientos quedarían en una cuenta madre.
   */
  async create(
    companyId: string,
    actorId: string,
    input: { code: string; name: string; nature?: AccountNature },
  ): Promise<AccountDto> {
    await this.access.requireWritable(companyId, actorId, 'accountant');
    if (!isValidAccountCode(input.code)) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'invalid_account_code',
        'El código tiene de 2 a 8 dígitos y no empieza en 0.',
      );
    }
    const parentCodeValue = parentCode(input.code);

    return this.db.transaction(async (tx) => {
      let nature = input.nature ?? natureForCode(input.code);
      let parentId: string | null = null;
      if (parentCodeValue) {
        // Bloquea la madre: nadie asienta en ella mientras pasa a solo agrupar.
        const [parent] = await tx
          .select({ id: accounts.id, nature: accounts.nature })
          .from(accounts)
          .where(and(eq(accounts.companyId, companyId), eq(accounts.code, parentCodeValue)))
          .for('update');
        if (!parent) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'parent_not_found',
            `Primero abre la cuenta ${parentCodeValue}.`,
          );
        }
        const [used] = await tx
          .select({ id: journalLines.id })
          .from(journalLines)
          .where(eq(journalLines.accountId, parent.id))
          .limit(1);
        if (used) {
          throw apiError(
            HttpStatus.CONFLICT,
            'parent_has_entries',
            `La cuenta ${parentCodeValue} ya tiene asientos: no se puede dividir en subcuentas.`,
          );
        }
        if (input.nature && input.nature !== parent.nature) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'nature_mismatch',
            `Una subcuenta tiene la misma naturaleza que la cuenta ${parentCodeValue}.`,
          );
        }
        await tx.update(accounts).set({ allowsPosting: false }).where(eq(accounts.id, parent.id));
        nature = parent.nature;
        parentId = parent.id;
      }

      const [created] = await tx
        .insert(accounts)
        .values({ companyId, code: input.code, name: input.name, nature, parentId })
        .onConflictDoNothing()
        .returning({ id: accounts.id });
      if (!created) {
        throw apiError(HttpStatus.CONFLICT, 'account_exists', `La cuenta ${input.code} ya existe.`);
      }
      await audit(tx, {
        actorId,
        action: 'account.created',
        entity: 'company',
        entityId: companyId,
        data: { code: input.code },
      });
      return {
        code: input.code,
        name: input.name,
        nature,
        parentCode: parentCodeValue,
        allowsPosting: true,
      };
    });
  }
}
