import type { TaxRegime } from '../companies/companies.service.js';
import { isValidRuc } from '../tax/ruc.js';
import type { Operation } from './operations.js';

/**
 * Comprobantes de pago (Reglamento de Comprobantes de Pago de SUNAT): con
 * ellos se arman el registro de ventas y el de compras. Los códigos son los
 * de la tabla 10 de SUNAT.
 */
export type DocumentType = '01' | '02' | '03' | '12' | '00';
export type DocumentDirection = 'sale' | 'purchase';

export const DOCUMENT_TYPES: Readonly<
  Record<DocumentType, { label: string; directions: readonly DocumentDirection[] }>
> = {
  '01': { label: 'Factura', directions: ['sale', 'purchase'] },
  '03': { label: 'Boleta de venta', directions: ['sale', 'purchase'] },
  '02': { label: 'Recibo por honorarios', directions: ['purchase'] },
  '12': { label: 'Ticket', directions: ['sale', 'purchase'] },
  '00': { label: 'Otro comprobante', directions: ['sale', 'purchase'] },
};

export const DOCUMENT_TYPE_CODES = Object.keys(DOCUMENT_TYPES) as DocumentType[];

/** Número correlativo: hasta 8 dígitos, como en los comprobantes electrónicos. */
export const MAX_DOCUMENT_NUMBER = 99_999_999;

export interface DocumentInput {
  type: DocumentType;
  /** F001, B001, E001 o la serie impresa (0001). */
  series: string;
  number: number;
  /** RUC de quien compra (ventas) o de quien vende (compras). */
  counterpartyRuc?: string;
  counterpartyName?: string;
}

export type DocumentProblem =
  | 'document_not_allowed'
  | 'document_type_direction'
  | 'invalid_series'
  | 'invalid_document_number'
  | 'nrus_no_factura'
  | 'document_ruc_required'
  | 'invalid_ruc'
  | 'document_mismatch';

export const DOCUMENT_PROBLEM_MESSAGES: Readonly<Record<DocumentProblem, string>> = {
  document_not_allowed: 'Solo las ventas y los gastos llevan comprobante.',
  document_type_direction: 'Ese comprobante no corresponde: un recibo por honorarios es de compra.',
  invalid_series:
    'Revisa la serie: son hasta 4 letras o números (F001, B001, E001 o 0001); en tickets, hasta 20.',
  invalid_document_number: 'Revisa el número del comprobante: va de 1 a 99 999 999.',
  nrus_no_factura: 'En el Nuevo RUS solo emites boletas o tickets, no facturas.',
  document_ruc_required: 'Escribe el RUC: una factura o un recibo por honorarios siempre lo lleva.',
  invalid_ruc: 'El RUC del comprobante no es válido. Revisa los 11 dígitos.',
  document_mismatch:
    'El comprobante no coincide con el gasto: con factura, marca «tengo factura»; con otro comprobante, no.',
};

/** Si la operación lleva comprobante, de qué lado: venta (lo das) o compra (te lo dan). */
export function documentDirection(op: Operation): DocumentDirection | null {
  if (op.type === 'sale') return 'sale';
  if (op.type === 'expense') return 'purchase';
  return null;
}

/** Normaliza la serie: sin espacios y en mayúsculas («f001» → «F001»). */
export function normalizeSeries(series: string): string {
  return series.replace(/\s+/g, '').toUpperCase();
}

export function isValidSeries(type: DocumentType, series: string): boolean {
  return type === '12' || type === '00'
    ? /^[A-Z0-9-]{1,20}$/.test(series)
    : /^[A-Z0-9]{1,4}$/.test(series);
}

/** Revisa el comprobante de una operación; null si está bien. */
export function documentProblem(
  op: Operation,
  doc: DocumentInput,
  regime: TaxRegime,
): DocumentProblem | null {
  const direction = documentDirection(op);
  if (!direction) return 'document_not_allowed';
  if (!DOCUMENT_TYPES[doc.type].directions.includes(direction)) return 'document_type_direction';
  if (!isValidSeries(doc.type, normalizeSeries(doc.series))) return 'invalid_series';
  if (!Number.isInteger(doc.number) || doc.number < 1 || doc.number > MAX_DOCUMENT_NUMBER) {
    return 'invalid_document_number';
  }
  if (direction === 'sale' && doc.type === '01' && regime === 'nrus') return 'nrus_no_factura';
  const needsRuc = doc.type === '01' || doc.type === '02';
  if (needsRuc && !doc.counterpartyRuc) return 'document_ruc_required';
  if (doc.counterpartyRuc && !isValidRuc(doc.counterpartyRuc)) return 'invalid_ruc';
  // En un gasto, «tengo factura» (crédito fiscal) va solo con factura. En el
  // Nuevo RUS no hay crédito fiscal, así que no importa.
  if (op.type === 'expense' && regime !== 'nrus' && op.withInvoice !== (doc.type === '01')) {
    return 'document_mismatch';
  }
  return null;
}

/** «F001-123»: como se escribe un comprobante. */
export function documentLabel(series: string, number: number): string {
  return `${series}-${number}`;
}
