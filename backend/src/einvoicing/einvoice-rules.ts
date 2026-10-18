import type { TaxRegime } from '../companies/companies.service.js';
import type { Cents } from '../accounting/money.js';
import { igvFromTotal } from '../tax/igv.js';
import { isValidRuc } from '../tax/ruc.js';

/**
 * Facturación electrónica (beta): boletas y facturas que la empresa emite
 * por un proveedor autorizado (PSE). Aquí, las reglas que se revisan antes
 * de mandarlas; el proveedor y SUNAT revisan el resto.
 */

export type EinvoiceType = '01' | '03';
export const EINVOICE_TYPES: Readonly<Record<EinvoiceType, string>> = {
  '01': 'Factura electrónica',
  '03': 'Boleta de venta electrónica',
};

/** Documento de quien compra: RUC, DNI o ninguno («clientes varios», solo en boletas chicas). */
export type CustomerDocType = 'ruc' | 'dni' | 'none';

/** Una boleta de más de S/ 700 identifica a quien compra (nombre y DNI o RUC). */
export const BOLETA_ID_THRESHOLD: Cents = 70_000;

export interface EinvoiceInput {
  type: EinvoiceType;
  customer: { docType: CustomerDocType; number?: string; name?: string };
  /** Qué se vendió, como irá en el comprobante. */
  description: string;
  total: Cents;
}

export type EinvoiceProblem =
  | 'einvoice_nrus'
  | 'factura_needs_ruc'
  | 'boleta_needs_id'
  | 'invalid_ruc'
  | 'invalid_dni'
  | 'customer_name_required'
  | 'invalid_description';

export const EINVOICE_PROBLEM_MESSAGES: Readonly<Record<EinvoiceProblem, string>> = {
  einvoice_nrus:
    'En el Nuevo RUS, la facturación electrónica llegará más adelante. Por ahora anota tus boletas a mano.',
  factura_needs_ruc: 'Una factura va con el RUC de tu cliente. Si no tiene RUC, emite una boleta.',
  boleta_needs_id: 'Una boleta de más de S/ 700 lleva el nombre y el DNI (o RUC) de quien compra.',
  invalid_ruc: 'El RUC no es válido. Revisa los 11 dígitos.',
  invalid_dni: 'El DNI tiene 8 dígitos.',
  customer_name_required: 'Escribe el nombre de tu cliente.',
  invalid_description: 'Escribe qué vendiste (de 3 a 250 letras).',
};

export function einvoiceProblem(input: EinvoiceInput, regime: TaxRegime): EinvoiceProblem | null {
  if (regime === 'nrus') return 'einvoice_nrus';
  const { docType, number, name } = input.customer;
  if (input.type === '01' && docType !== 'ruc') return 'factura_needs_ruc';
  if (input.type === '03' && docType === 'none' && input.total > BOLETA_ID_THRESHOLD) {
    return 'boleta_needs_id';
  }
  if (docType === 'ruc' && !isValidRuc(number ?? '')) return 'invalid_ruc';
  if (docType === 'dni' && !/^\d{8}$/.test(number ?? '')) return 'invalid_dni';
  if (docType !== 'none' && (name ?? '').trim().length < 2) return 'customer_name_required';
  const description = input.description.trim();
  if (description.length < 3 || description.length > 250) return 'invalid_description';
  return null;
}

/** Series electrónicas: F y 3 letras o números para facturas, B para boletas (F001, B001). */
export function isValidEinvoiceSeries(type: EinvoiceType, series: string): boolean {
  return new RegExp(`^${type === '01' ? 'F' : 'B'}[A-Z0-9]{3}$`).test(series);
}

/** Base e IGV del total, con la misma regla de todo Contabili (`tax/igv.ts`). */
export function einvoiceAmounts(total: Cents): { base: Cents; igv: Cents; total: Cents } {
  const { base, igv } = igvFromTotal(total);
  return { base, igv, total };
}

/** «B001-00000045»: así se imprime el número (8 dígitos). */
export function einvoiceNumberLabel(series: string, number: number): string {
  return `${series}-${String(number).padStart(8, '0')}`;
}

// ─── El monto en letras, como lo pide la representación impresa ───────────

const UNITS = [
  '',
  'uno',
  'dos',
  'tres',
  'cuatro',
  'cinco',
  'seis',
  'siete',
  'ocho',
  'nueve',
  'diez',
  'once',
  'doce',
  'trece',
  'catorce',
  'quince',
  'dieciséis',
  'diecisiete',
  'dieciocho',
  'diecinueve',
  'veinte',
  'veintiuno',
  'veintidós',
  'veintitrés',
  'veinticuatro',
  'veinticinco',
  'veintiséis',
  'veintisiete',
  'veintiocho',
  'veintinueve',
];
const TENS = [
  '',
  '',
  '',
  'treinta',
  'cuarenta',
  'cincuenta',
  'sesenta',
  'setenta',
  'ochenta',
  'noventa',
];
const HUNDREDS = [
  '',
  'ciento',
  'doscientos',
  'trescientos',
  'cuatrocientos',
  'quinientos',
  'seiscientos',
  'setecientos',
  'ochocientos',
  'novecientos',
];

/** Delante de «mil» o «millones», «uno» se acorta: veintiún mil, treinta y un mil. */
function apocope(words: string): string {
  return words.replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un');
}

function belowThousand(n: number): string {
  if (n === 100) return 'cien';
  const parts: string[] = [];
  if (n >= 100) parts.push(HUNDREDS[Math.floor(n / 100)]);
  const rest = n % 100;
  if (rest > 0 && rest < 30) parts.push(UNITS[rest]);
  else if (rest >= 30) {
    const unit = rest % 10;
    parts.push(
      unit ? `${TENS[Math.floor(rest / 10)]} y ${UNITS[unit]}` : TENS[Math.floor(rest / 10)],
    );
  }
  return parts.join(' ');
}

/** Un entero en palabras (hasta 999 999 999): 1180 → «mil ciento ochenta». */
export function integerInWords(n: number): string {
  if (n === 0) return 'cero';
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions)
    parts.push(millions === 1 ? 'un millón' : `${apocope(belowThousand(millions))} millones`);
  if (thousands) parts.push(thousands === 1 ? 'mil' : `${apocope(belowThousand(thousands))} mil`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(' ');
}

/** «SON: CIENTO DIECIOCHO CON 00/100 SOLES». */
export function amountInWords(total: Cents): string {
  const soles = Math.floor(total / 100);
  const cents = String(total % 100).padStart(2, '0');
  return `SON: ${integerInWords(soles).toUpperCase()} CON ${cents}/100 SOLES`;
}
