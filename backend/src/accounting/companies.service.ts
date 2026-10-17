import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { apiError } from '../common/http.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { accounts, companies } from '../db/schema/index.js';
import { isValidRuc } from '../tax/ruc.js';
import { parentCode, PCGE_ACCOUNTS } from './pcge.js';

export interface NewCompany {
  ruc: string;
  legalName: string;
  taxRegime: (typeof companies.$inferInsert)['taxRegime'];
}

@Injectable()
export class CompaniesService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Crea la empresa con el PCGE base: las cuentas con hijas solo agrupan. */
  async create(input: NewCompany): Promise<{ id: string }> {
    if (!isValidRuc(input.ruc)) {
      throw apiError(HttpStatus.BAD_REQUEST, 'invalid_ruc', 'El RUC no es válido.');
    }
    return this.db.transaction(async (tx) => {
      const [company] = await tx
        .insert(companies)
        .values(input)
        .onConflictDoNothing()
        .returning({ id: companies.id });
      if (!company) {
        throw apiError(HttpStatus.CONFLICT, 'ruc_taken', 'Ya hay una empresa con ese RUC.');
      }

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
      return company;
    });
  }
}
