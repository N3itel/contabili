import type { TaxRegime } from '../companies/companies.service.js';
import { igvFromTotal } from '../tax/igv.js';
import type { JournalLineInput } from './journal-rules.js';
import { type Cents, formatSoles } from './money.js';

/**
 * Operaciones del día a día para quien no sabe de debe y haber: la persona
 * dice qué pasó («vendí», «gasté», «cobré», «pagué») y aquí se arma el asiento
 * del PCGE, con el IGV según el régimen de la empresa.
 */

/** Dónde entró o de dónde salió la plata. */
export type Money = 'cash' | 'bank';
/** Al contado (caja o banco) o al crédito (queda por cobrar o por pagar). */
export type Settlement = Money | 'credit';
export type SaleKind = 'goods' | 'services';
export type ExpenseCategory = 'goods' | 'services' | 'payroll' | 'taxes' | 'financial' | 'other';

export type Operation =
  | { type: 'sale'; total: Cents; kind: SaleKind; paidWith: Settlement }
  | {
      type: 'expense';
      total: Cents;
      category: ExpenseCategory;
      paidWith: Settlement;
      /** Con factura a nombre de la empresa: el IGV se descuenta (crédito fiscal). */
      withInvoice: boolean;
    }
  /** Un cliente pagó lo que debía. */
  | { type: 'collection'; total: Cents; into: Money }
  /** Se pagó a un proveedor lo que se le debía. */
  | { type: 'payment'; total: Cents; from: Money };

export interface OperationContext {
  taxRegime: TaxRegime;
  /** Caja o cuenta bancaria elegida, si la empresa abrió subcuentas (por ejemplo 10411). */
  moneyAccountCode?: string;
  /** Cliente o proveedor: va en la línea de por cobrar o por pagar. */
  contactId?: string;
}

/**
 * Qué contacto lleva la operación: cliente si queda por cobrar o se cobra,
 * proveedor si queda por pagar o se paga; ninguno si es al contado.
 */
export function operationContactKind(op: Operation): 'customer' | 'supplier' | null {
  switch (op.type) {
    case 'sale':
      return op.paidWith === 'credit' ? 'customer' : null;
    case 'collection':
      return 'customer';
    case 'expense':
      return op.paidWith === 'credit' ? 'supplier' : null;
    case 'payment':
      return 'supplier';
  }
}

export interface BuiltOperation {
  lines: JournalLineInput[];
  /** Glosa del asiento. */
  description: string;
  /** Qué se registró, en palabras simples, para mostrar a la persona. */
  explanation: string;
}

/** Cuentas del PCGE base que usan las operaciones. */
export const OPERATION_ACCOUNTS = {
  cash: '1011',
  bank: '1041',
  receivable: '1212',
  payable: '4212',
  igv: '40111',
  sale: { goods: '7011', services: '704' },
  expense: {
    goods: '601',
    services: '63',
    payroll: '62',
    taxes: '64',
    financial: '67',
    other: '65',
  },
} as const;

/** Gastos que llevan IGV en la factura (los sueldos, tributos e intereses no). */
const EXPENSES_WITH_IGV: ReadonlySet<ExpenseCategory> = new Set(['goods', 'services', 'other']);

const EXPENSE_LABEL: Readonly<Record<ExpenseCategory, string>> = {
  goods: 'compra de mercadería',
  services: 'servicios',
  payroll: 'sueldos',
  taxes: 'impuestos',
  financial: 'gastos del banco o intereses',
  other: 'otros gastos',
};

const soles = formatSoles;

/** El Nuevo RUS no cobra IGV aparte ni usa crédito fiscal. */
function chargesIgv(regime: TaxRegime): boolean {
  return regime !== 'nrus';
}

function moneyAccount(money: Money, ctx: OperationContext): string {
  return ctx.moneyAccountCode ?? OPERATION_ACCOUNTS[money];
}

const debit = (accountCode: string, amount: Cents): JournalLineInput => ({
  accountCode,
  debit: amount,
  credit: 0,
});
const credit = (accountCode: string, amount: Cents): JournalLineInput => ({
  accountCode,
  debit: 0,
  credit: amount,
});

/** Cuenta elegida para caja o banco: tiene que ser del elemento 10. */
export function isMoneyAccountCode(code: string): boolean {
  return /^10\d{1,6}$/.test(code);
}

export function buildOperation(op: Operation, ctx: OperationContext): BuiltOperation {
  const built = build(op, ctx);
  const contactAccount =
    operationContactKind(op) === 'customer'
      ? OPERATION_ACCOUNTS.receivable
      : operationContactKind(op) === 'supplier'
        ? OPERATION_ACCOUNTS.payable
        : null;
  return {
    ...built,
    lines: built.lines
      // Un IGV de 0 céntimos (montos mínimos) no lleva línea.
      .filter((l) => l.debit > 0 || l.credit > 0)
      .map((l) =>
        ctx.contactId && l.accountCode === contactAccount ? { ...l, contactId: ctx.contactId } : l,
      ),
  };
}

function build(op: Operation, ctx: OperationContext): BuiltOperation {
  switch (op.type) {
    case 'sale': {
      const { base, igv } = chargesIgv(ctx.taxRegime)
        ? igvFromTotal(op.total)
        : { base: op.total, igv: 0 };
      const target =
        op.paidWith === 'credit' ? OPERATION_ACCOUNTS.receivable : moneyAccount(op.paidWith, ctx);
      const where =
        op.paidWith === 'credit'
          ? 'Queda por cobrar hasta que el cliente te pague.'
          : op.paidWith === 'cash'
            ? 'Entró a tu caja.'
            : 'Entró a tu cuenta del banco.';
      return {
        lines: [
          debit(target, op.total),
          credit(OPERATION_ACCOUNTS.igv, igv),
          credit(OPERATION_ACCOUNTS.sale[op.kind], base),
        ],
        description: `Venta ${op.kind === 'goods' ? 'de mercadería' : 'de servicios'} ${op.paidWith === 'credit' ? 'al crédito' : 'al contado'}`,
        explanation:
          igv > 0
            ? `Vendiste ${soles(op.total)}: ${soles(base)} es tu venta y ${soles(igv)} es IGV que le toca a SUNAT. ${where}`
            : `Vendiste ${soles(op.total)}. ${where}`,
      };
    }
    case 'expense': {
      const deductible =
        op.withInvoice && chargesIgv(ctx.taxRegime) && EXPENSES_WITH_IGV.has(op.category);
      const { base, igv } = deductible ? igvFromTotal(op.total) : { base: op.total, igv: 0 };
      const source =
        op.paidWith === 'credit' ? OPERATION_ACCOUNTS.payable : moneyAccount(op.paidWith, ctx);
      const where =
        op.paidWith === 'credit'
          ? 'Queda por pagar al proveedor.'
          : op.paidWith === 'cash'
            ? 'Salió de tu caja.'
            : 'Salió de tu cuenta del banco.';
      const igvNote = deductible
        ? ` Como tienes factura, ${soles(igv)} de IGV te ayuda a pagar menos IGV a SUNAT.`
        : op.withInvoice || !EXPENSES_WITH_IGV.has(op.category) || !chargesIgv(ctx.taxRegime)
          ? ''
          : ' Sin factura, el IGV no se puede descontar.';
      return {
        lines: [
          debit(OPERATION_ACCOUNTS.expense[op.category], base),
          debit(OPERATION_ACCOUNTS.igv, igv),
          credit(source, op.total),
        ],
        description: `Gasto: ${EXPENSE_LABEL[op.category]}${op.paidWith === 'credit' ? ' al crédito' : ''}`,
        explanation: `Gastaste ${soles(op.total)} en ${EXPENSE_LABEL[op.category]}. ${where}${igvNote}`,
      };
    }
    case 'collection':
      return {
        lines: [
          debit(moneyAccount(op.into, ctx), op.total),
          credit(OPERATION_ACCOUNTS.receivable, op.total),
        ],
        description: 'Cobro a cliente',
        explanation: `Un cliente te pagó ${soles(op.total)} de lo que te debía.`,
      };
    case 'payment':
      return {
        lines: [
          debit(OPERATION_ACCOUNTS.payable, op.total),
          credit(moneyAccount(op.from, ctx), op.total),
        ],
        description: 'Pago a proveedor',
        explanation: `Pagaste ${soles(op.total)} de lo que le debías a un proveedor.`,
      };
  }
}
