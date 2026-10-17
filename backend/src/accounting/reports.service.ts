import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, type AnyColumn, asc, eq, like, sql, type SQL } from 'drizzle-orm';
import { apiError } from '../common/http.js';
import { CompanyAccess } from '../companies/company-access.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { accounts, journalEntries, journalLines } from '../db/schema/index.js';
import { balanceSides, natureBalance, runningBalances } from './balances.js';
import { periodRange } from './lima.js';
import type { Cents } from './money.js';
import type { AccountNature } from './pcge.js';
import { buildSummary, type FinanceSummary } from './summary-rules.js';
import { companies } from '../db/schema/index.js';
import {
  type MonthFlows,
  monthlyTaxes,
  type MonthlyTaxes,
  type Regime,
} from '../tax/monthly-taxes.js';
import { trendMonths, type TrendPoint } from './trend-rules.js';

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

  /**
   * Resumen de finanzas del mes 'AAAA-MM': saldos a la fecha (hoy o el fin del
   * mes, lo que sea antes) y ventas y gastos del mes.
   */
  async summary(
    companyId: string,
    actorId: string,
    period: string,
    today: string,
  ): Promise<FinanceSummary & { period: string; asOf: string }> {
    await this.access.require(companyId, actorId, 'viewer');
    const { from, to } = periodRange(period);
    const asOf = to < today ? to : today;
    const toDate = sql`${journalEntries.entryDate} <= ${asOf}`;
    const inPeriod = sql`${journalEntries.entryDate} BETWEEN ${from} AND ${asOf}`;
    const sumIf = (column: AnyColumn, cond: SQL) =>
      sql<number>`coalesce(sum(${column}) filter (where ${cond}), 0)`.mapWith(Number);
    const rows = await this.db
      .select({
        code: accounts.code,
        debitToDate: sumIf(journalLines.debitCents, toDate),
        creditToDate: sumIf(journalLines.creditCents, toDate),
        debitInPeriod: sumIf(journalLines.debitCents, inPeriod),
        creditInPeriod: sumIf(journalLines.creditCents, inPeriod),
      })
      .from(journalLines)
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .where(and(eq(journalLines.companyId, companyId), toDate))
      .groupBy(accounts.code);
    return { period, asOf, ...buildSummary(rows) };
  }

  /** Ventas y gastos por mes (sin IGV), de todos los meses hasta `to` (AAAA-MM). */
  private async monthlyFlows(
    companyId: string,
    toPeriod: string,
  ): Promise<(MonthFlows & { expenses: number })[]> {
    const month = sql<string>`to_char(${journalEntries.entryDate}, 'YYYY-MM')`;
    const code = accounts.code;
    const isTaxPayment = sql`${journalEntries.source} = 'tax_payment'`;
    const rows = await this.db
      .select({
        period: month,
        netSales:
          sql<number>`coalesce(sum(case when ${code} like '70%' then ${journalLines.creditCents} - ${journalLines.debitCents} else 0 end), 0)`.mapWith(
            Number,
          ),
        expenses:
          sql<number>`coalesce(sum(case when ${code} ~ '^6[0-8]' then ${journalLines.debitCents} - ${journalLines.creditCents} else 0 end), 0)`.mapWith(
            Number,
          ),
        igvSales:
          sql<number>`coalesce(sum(case when ${code} = '40111' then ${journalLines.creditCents} else 0 end), 0)`.mapWith(
            Number,
          ),
        igvPurchases:
          sql<number>`coalesce(sum(case when ${code} = '40111' and not (${isTaxPayment}) then ${journalLines.debitCents} else 0 end), 0)`.mapWith(
            Number,
          ),
      })
      .from(journalLines)
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .where(and(eq(journalLines.companyId, companyId), sql`${month} <= ${toPeriod}`))
      .groupBy(month)
      .orderBy(month);
    return rows;
  }

  /** Lo que toca pagar a SUNAT en el mes 'AAAA-MM', estimado con lo registrado. */
  async taxes(companyId: string, actorId: string, period: string): Promise<MonthlyTaxes> {
    await this.access.require(companyId, actorId, 'viewer');
    const [company] = await this.db
      .select({ regime: companies.taxRegime })
      .from(companies)
      .where(eq(companies.id, companyId));
    const months = await this.monthlyFlows(companyId, period);
    // El mes pedido va siempre al final, aunque no tenga movimientos.
    const flows = months.filter((m) => m.period < period);
    flows.push(
      months.find((m) => m.period === period) ?? {
        period,
        netSales: 0,
        expenses: 0,
        igvSales: 0,
        igvPurchases: 0,
      },
    );
    return monthlyTaxes(company.regime as Regime, flows);
  }

  /** Ventas y gastos (sin IGV) de los últimos `count` meses hasta `toPeriod`. */
  async trend(
    companyId: string,
    actorId: string,
    toPeriod: string,
    count: number,
  ): Promise<TrendPoint[]> {
    await this.access.require(companyId, actorId, 'viewer');
    return trendMonths(await this.monthlyFlows(companyId, toPeriod), toPeriod, count);
  }
}
