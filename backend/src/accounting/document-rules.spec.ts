import { rucCheckDigit } from '../tax/ruc.js';
import {
  type DocumentInput,
  documentDirection,
  documentLabel,
  documentProblem,
  isValidSeries,
  normalizeSeries,
} from './document-rules.js';
import type { Operation } from './operations.js';

const RUC = '20131312955';
const PERSON_RUC = `1045678912${rucCheckDigit('1045678912')}`;

const sale: Operation = { type: 'sale', total: 11800, kind: 'goods', paidWith: 'cash' };
const withInvoice: Operation = {
  type: 'expense',
  total: 11800,
  category: 'goods',
  paidWith: 'cash',
  withInvoice: true,
};
const noInvoice: Operation = { ...withInvoice, withInvoice: false };
const factura = (extra: Partial<DocumentInput> = {}): DocumentInput => ({
  type: '01',
  series: 'F001',
  number: 123,
  counterpartyRuc: RUC,
  ...extra,
});

describe('comprobantes', () => {
  it('ventas y gastos llevan comprobante; cobros y pagos, no', () => {
    expect(documentDirection(sale)).toBe('sale');
    expect(documentDirection(withInvoice)).toBe('purchase');
    expect(documentDirection({ type: 'collection', total: 100, into: 'cash' })).toBeNull();
    expect(documentProblem({ type: 'payment', total: 100, from: 'bank' }, factura(), 'rmt')).toBe(
      'document_not_allowed',
    );
  });

  it('factura de venta con el RUC del cliente', () => {
    expect(documentProblem(sale, factura(), 'rmt')).toBeNull();
    expect(documentProblem(sale, factura({ counterpartyRuc: undefined }), 'rmt')).toBe(
      'document_ruc_required',
    );
    expect(documentProblem(sale, factura({ counterpartyRuc: '20131312954' }), 'rmt')).toBe(
      'invalid_ruc',
    );
  });

  it('una boleta no pide RUC', () => {
    expect(documentProblem(sale, { type: '03', series: 'B001', number: 45 }, 'rmt')).toBeNull();
  });

  it('en el Nuevo RUS no se emiten facturas', () => {
    expect(documentProblem(sale, factura(), 'nrus')).toBe('nrus_no_factura');
    expect(documentProblem(sale, { type: '03', series: 'B001', number: 1 }, 'nrus')).toBeNull();
  });

  it('el recibo por honorarios es solo de compra y lleva RUC', () => {
    const recibo: DocumentInput = { type: '02', series: 'E001', number: 7 };
    expect(documentProblem(sale, recibo, 'rmt')).toBe('document_type_direction');
    expect(documentProblem(noInvoice, recibo, 'rmt')).toBe('document_ruc_required');
    expect(
      documentProblem(noInvoice, { ...recibo, counterpartyRuc: PERSON_RUC }, 'rmt'),
    ).toBeNull();
  });

  it('«tengo factura» va solo con factura (menos en el Nuevo RUS)', () => {
    expect(documentProblem(withInvoice, factura(), 'rmt')).toBeNull();
    expect(documentProblem(noInvoice, factura(), 'rmt')).toBe('document_mismatch');
    expect(documentProblem(withInvoice, { type: '03', series: 'B001', number: 9 }, 'rmt')).toBe(
      'document_mismatch',
    );
    expect(documentProblem(noInvoice, factura(), 'nrus')).toBeNull();
  });

  it('serie y número', () => {
    expect(normalizeSeries(' f001 ')).toBe('F001');
    expect(isValidSeries('01', 'F001')).toBe(true);
    expect(isValidSeries('01', '0001')).toBe(true);
    expect(isValidSeries('01', 'F0001')).toBe(false);
    expect(isValidSeries('03', 'B-01')).toBe(false);
    expect(isValidSeries('12', 'FFCF123456-7')).toBe(true);
    expect(documentProblem(sale, factura({ series: 'F 001' }), 'rmt')).toBeNull();
    expect(documentProblem(sale, factura({ series: 'F00001' }), 'rmt')).toBe('invalid_series');
    expect(documentProblem(sale, factura({ number: 0 }), 'rmt')).toBe('invalid_document_number');
    expect(documentProblem(sale, factura({ number: 100_000_000 }), 'rmt')).toBe(
      'invalid_document_number',
    );
    expect(documentProblem(sale, factura({ number: 1.5 }), 'rmt')).toBe('invalid_document_number');
    expect(documentLabel('F001', 123)).toBe('F001-123');
  });
});
