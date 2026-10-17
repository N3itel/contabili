import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, like, sql, type SQL } from 'drizzle-orm';
import { apiError } from '../common/http.js';
import { CompanyAccess } from '../companies/company-access.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { accounts, journalEntries, journalLines } from '../db/schema/index.js';
import { balanceSides, natureBalance, runningBalances } from './balances.js';
import type { Cents } from './money.js';
import type { AccountNature } from './pcge.js';

/** Movimientos por consulta del mayor; los totales y el saldo final cubren todo el rango. */
export const LEDGER_MAX_MOVEMENTS = 1000;

const sumDebit = sql<number>`coalesce(sum(${journalLines.debitCents}), 0)`.mapWith(Number);
const sumCredit = sql<number>`coalesce(sum(${journalLines.creditCents}), 0)`.mapWith(Number);

export interface LedgerDto {
  account: { code: string; name: string; nature: AccountNature };
  from: string;
  to: string;
  /** Saldos del lado normal de la cuenta (ver `natureBalance`). */
  openingBalance: Cents;
  movements: {
    entryId: string;
    number: number;
    entryDate: string;
    description: string;
    accountCode: string;
    debit: Cents;
    credit: Cents;
    balance: Cents;
  }[];
  /** Hay más movimientos de los que se muestran: acota el rango de fechas. */
  truncated: boolean;
  totals: { debit: Cents; credit: Cents };
  closingBalance: Cents;
}

export interface TrialBalanceDto {
  from: string;
  to: string;
  rows: {
    code: string;
    name: string;
    debit: Cents;
    credit: Cents;
    debitBalance: Cents;
    creditBalance: Cents;
  }[];
  totals: { debit: Cents; credit: Cents; debitBalance: Cents; creditBalance: Cents };
}

@Injectable()
export class ReportsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(CompanyAccess) private readonly access: CompanyAccess,
  ) {}

  /**
   * Libro mayor de una cuenta entre dos fechas. Una cuenta madre incluye los
   * movimientos de todas sus subcuentas.
   */
  async ledger(
    companyId: string,
    actorId: string,
    code: string,
    from: string,
    to: string,
  ): Promise<LedgerDto> {
    await this.access.require(companyId, actorId, 'viewer');
    const [account] = await this.db
      .select({ code: accounts.code, name: accounts.name, nature: accounts.nature })
      .from(accounts)
      .where(and(eq(accounts.companyId, companyId), eq(accounts.code, code)));
    if (!account) {
      throw apiError(HttpStatus.NOT_FOUND, 'account_not_found', `La cuenta ${code} no existe.`);
    }
    // Los códigos son solo dígitos: el prefijo no tiene comodines.
    const inAccount = and(
      eq(journalLines.companyId, companyId),
      like(accounts.code, `${code}%`),
    ) as SQL;

    const sums = (dates: SQL) =>
      this.db
        .select({ debit: sumDebit, credit: sumCredit })
        .from(journalLines)
        .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
        .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
        .where(and(inAccount, dates));
    const inRange = sql`${journalEntries.entryDate} BETWEEN ${from} AND ${to}`;

    const [[before], [totals], rows] = await Promise.all([
      sums(sql`${journalEntries.entryDate} < ${from}`),
      sums(inRange),
      this.db
        .select({
          entryId: journalEntries.id,
          number: journalEntries.number,
          entryDate: journalEntries.entryDate,
          description: journalEntries.description,
          accountCode: accounts.code,
          debit: journalLines.debitCents,
          credit: journalLines.creditCents,
        })
        .from(journalLines)
        .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
        .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
        .where(and(inAccount, inRange))
        .orderBy(
          asc(journalEntries.entryDate),
          asc(journalEntries.fiscalYear),
          asc(journalEntries.number),
          asc(journalLines.lineNo),
        )
        .limit(LEDGER_MAX_MOVEMENTS + 1),
    ]);

    const openingBalance = natureBalance(account.nature, before.debit, before.credit);
    const shown = rows.slice(0, LEDGER_MAX_MOVEMENTS);
    const balances = runningBalances(account.nature, openingBalance, shown);
    return {
      account,
      from,
      to,
      openingBalance,
      movements: shown.map((m, i) => ({ ...m, balance: balances[i] })),
      truncated: rows.length > LEDGER_MAX_MOVEMENTS,
      totals,
      closingBalance: openingBalance + natureBalance(account.nature, totals.debit, totals.credit),
    };
  }

  /**
   * Balance de comprobación: sumas del debe y del haber de cada cuenta con
   * movimientos entre dos fechas, y su saldo deudor o acreedor.
   */
  async trialBalance(
    companyId: string,
    actorId: string,
    from: string,
    to: string,
  ): Promise<TrialBalanceDto> {
    await this.access.require(companyId, actorId, 'viewer');
    const sums = await this.db
      .select({ code: accounts.code, name: accounts.name, debit: sumDebit, credit: sumCredit })
      .from(journalLines)
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .where(
        and(
          eq(journalLines.companyId, companyId),
          sql`${journalEntries.entryDate} BETWEEN ${from} AND ${to}`,
        ),
      )
      .groupBy(accounts.id, accounts.code, accounts.name)
      .orderBy(asc(accounts.code));

    const rows = sums.map((r) => ({ ...r, ...balanceSides(r.debit, r.credit) }));
    const totals = rows.reduce(
      (t, r) => ({
        debit: t.debit + r.debit,
        credit: t.credit + r.credit,
        debitBalance: t.debitBalance + r.debitBalance,
        creditBalance: t.creditBalance + r.creditBalance,
      }),
      { debit: 0, credit: 0, debitBalance: 0, creditBalance: 0 },
    );
    return { from, to, rows, totals };
  }
}
