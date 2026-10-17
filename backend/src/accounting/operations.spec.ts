import { checkJournal } from './journal-rules.js';
import {
  buildOperation,
  isMoneyAccountCode,
  type Operation,
  operationContactKind,
} from './operations.js';

const plain = (text: string) => text.replace(/\s/g, ' ');
const rmt = { taxRegime: 'rmt' as const };
const nrus = { taxRegime: 'nrus' as const };

describe('operaciones fáciles', () => {
  it('venta al contado con IGV', () => {
    const op = buildOperation({ type: 'sale', total: 11800, kind: 'goods', paidWith: 'cash' }, rmt);
    expect(op.lines).toEqual([
      { accountCode: '1011', debit: 11800, credit: 0 },
      { accountCode: '40111', debit: 0, credit: 1800 },
      { accountCode: '7011', debit: 0, credit: 10000 },
    ]);
    expect(op.description).toBe('Venta de mercadería al contado');
    expect(plain(op.explanation)).toBe(
      'Vendiste S/ 118.00: S/ 100.00 es tu venta y S/ 18.00 es IGV que le toca a SUNAT. Entró a tu caja.',
    );
  });

  it('en el Nuevo RUS no separa IGV', () => {
    const op = buildOperation(
      { type: 'sale', total: 5000, kind: 'services', paidWith: 'credit' },
      nrus,
    );
    expect(op.lines).toEqual([
      { accountCode: '1212', debit: 5000, credit: 0 },
      { accountCode: '704', debit: 0, credit: 5000 },
    ]);
    expect(plain(op.explanation)).toBe(
      'Vendiste S/ 50.00. Queda por cobrar hasta que el cliente te pague.',
    );
  });

  it('gasto con factura descuenta el IGV; sin factura, no', () => {
    const withInvoice = buildOperation(
      { type: 'expense', total: 23600, category: 'services', paidWith: 'bank', withInvoice: true },
      rmt,
    );
    expect(withInvoice.lines).toEqual([
      { accountCode: '63', debit: 20000, credit: 0 },
      { accountCode: '40111', debit: 3600, credit: 0 },
      { accountCode: '1041', debit: 0, credit: 23600 },
    ]);
    expect(plain(withInvoice.explanation)).toContain('Como tienes factura, S/ 36.00 de IGV');

    const without = buildOperation(
      { type: 'expense', total: 23600, category: 'services', paidWith: 'cash', withInvoice: false },
      rmt,
    );
    expect(without.lines).toEqual([
      { accountCode: '63', debit: 23600, credit: 0 },
      { accountCode: '1011', debit: 0, credit: 23600 },
    ]);
    expect(without.explanation).toContain('Sin factura, el IGV no se puede descontar.');
  });

  it('sueldos e impuestos no llevan IGV aunque digan factura', () => {
    const op = buildOperation(
      {
        type: 'expense',
        total: 150000,
        category: 'payroll',
        paidWith: 'credit',
        withInvoice: true,
      },
      rmt,
    );
    expect(op.lines).toEqual([
      { accountCode: '62', debit: 150000, credit: 0 },
      { accountCode: '4212', debit: 0, credit: 150000 },
    ]);
    expect(op.explanation).not.toContain('IGV');
  });

  it('cobros y pagos mueven por cobrar y por pagar', () => {
    expect(buildOperation({ type: 'collection', total: 11800, into: 'bank' }, rmt).lines).toEqual([
      { accountCode: '1041', debit: 11800, credit: 0 },
      { accountCode: '1212', debit: 0, credit: 11800 },
    ]);
    expect(
      buildOperation(
        { type: 'payment', total: 5000, from: 'cash' },
        { ...rmt, moneyAccountCode: '10111' },
      ).lines,
    ).toEqual([
      { accountCode: '4212', debit: 5000, credit: 0 },
      { accountCode: '10111', debit: 0, credit: 5000 },
    ]);
  });

  it('todas cuadran, también con montos mínimos', () => {
    const ops: Operation[] = [
      { type: 'sale', total: 1, kind: 'goods', paidWith: 'cash' },
      { type: 'sale', total: 99999, kind: 'services', paidWith: 'credit' },
      { type: 'expense', total: 1, category: 'goods', paidWith: 'cash', withInvoice: true },
      { type: 'expense', total: 12345, category: 'other', paidWith: 'credit', withInvoice: true },
      { type: 'collection', total: 7, into: 'cash' },
      { type: 'payment', total: 7, from: 'bank' },
    ];
    for (const op of ops) {
      for (const ctx of [rmt, nrus]) expect(checkJournal(buildOperation(op, ctx).lines)).toBeNull();
    }
  });

  it('la caja o el banco elegidos son del elemento 10', () => {
    expect(isMoneyAccountCode('10411')).toBe(true);
    expect(isMoneyAccountCode('1212')).toBe(false);
    expect(isMoneyAccountCode('10')).toBe(false);
  });
});

describe('cliente o proveedor', () => {
  const contactId = '6d1f9a3e-1b2c-4d5e-8f90-123456789abc';

  it('va en la línea de por cobrar o por pagar', () => {
    const sale = buildOperation(
      { type: 'sale', total: 11800, kind: 'goods', paidWith: 'credit' },
      { ...rmt, contactId },
    );
    expect(sale.lines.find((l) => l.accountCode === '1212')?.contactId).toBe(contactId);
    expect(sale.lines.filter((l) => l.contactId)).toHaveLength(1);

    const payment = buildOperation(
      { type: 'payment', total: 500, from: 'bank' },
      { ...rmt, contactId },
    );
    expect(payment.lines.find((l) => l.accountCode === '4212')?.contactId).toBe(contactId);
  });

  it('dice qué contacto corresponde', () => {
    expect(
      operationContactKind({ type: 'sale', total: 1, kind: 'goods', paidWith: 'credit' }),
    ).toBe('customer');
    expect(
      operationContactKind({ type: 'sale', total: 1, kind: 'goods', paidWith: 'cash' }),
    ).toBeNull();
    expect(operationContactKind({ type: 'collection', total: 1, into: 'cash' })).toBe('customer');
    expect(
      operationContactKind({
        type: 'expense',
        total: 1,
        category: 'goods',
        paidWith: 'credit',
        withInvoice: true,
      }),
    ).toBe('supplier');
    expect(operationContactKind({ type: 'payment', total: 1, from: 'cash' })).toBe('supplier');
  });
});
