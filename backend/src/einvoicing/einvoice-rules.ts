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
/** Lo que se guarda: boletas, facturas y las notas de crédito que las anulan (07). */
export type EinvoiceDocType = EinvoiceType | '07';
export const EINVOICE_TYPES: Readonly<Record<EinvoiceDocType, string>> = {
  '01': 'Factura electrónica',
  '03': 'Boleta de venta electrónica',
  '07': 'Nota de crédito electrónica',
};

/**
 * Motivos de una nota de crédito que anula todo el comprobante (catálogo 09
 * de SUNAT). Las notas por una parte del monto no van en la beta.
 */
export type CreditReason = '01' | '02' | '06';
export const CREDIT_REASONS: Readonly<Record<CreditReason, string>> = {
  '01': 'Anulación de la operación',
  '02': 'Anulación por error en el RUC',
  '06': 'Devolución total',
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
  | 'einvoice_nrus_test_only'
  | 'nrus_no_factura'
  | 'factura_needs_ruc'
  | 'boleta_needs_id'
  | 'invalid_ruc'
  | 'invalid_dni'
  | 'customer_name_required'
  | 'invalid_description';

export const EINVOICE_PROBLEM_MESSAGES: Readonly<Record<EinvoiceProblem, string>> = {
  einvoice_nrus_test_only:
    'En el Nuevo RUS, la facturación electrónica por ahora es solo de prueba: todavía no mandamos tus boletas a SUNAT. Emite las reales como siempre y anótalas en Contabili.',
  nrus_no_factura: 'En el Nuevo RUS solo emites boletas, no facturas.',
  factura_needs_ruc: 'Una factura va con el RUC de tu cliente. Si no tiene RUC, emite una boleta.',
  boleta_needs_id: 'Una boleta de más de S/ 700 lleva el nombre y el DNI (o RUC) de quien compra.',
  invalid_ruc: 'El RUC no es válido. Revisa los 11 dígitos.',
  invalid_dni: 'El DNI tiene 8 dígitos.',
  customer_name_required: 'Escribe el nombre de tu cliente.',
  invalid_description: 'Escribe qué vendiste (de 3 a 250 letras).',
};

/**
 * En el Nuevo RUS, la beta emite solo en modo de prueba: falta confirmar
 * cómo va el IGV en una boleta electrónica de ese régimen antes de mandarla
 * a SUNAT.
 */
export function einvoiceProviderProblem(
  provider: 'test' | 'nubefact',
  regime: TaxRegime,
): EinvoiceProblem | null {
  return regime === 'nrus' && provider !== 'test' ? 'einvoice_nrus_test_only' : null;
}

export function einvoiceProblem(input: EinvoiceInput, regime: TaxRegime): EinvoiceProblem | null {
  if (regime === 'nrus' && input.type === '01') return 'nrus_no_factura';
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

/**
 * Series electrónicas: F y 3 letras o números para facturas, B para boletas
 * (F001, B001). La nota de crédito de una factura también va con F (FC01) y
 * la de una boleta, con B (BC01).
 */
export function isValidEinvoiceSeries(type: EinvoiceType, series: string): boolean {
  return new RegExp(`^${type === '01' ? 'F' : 'B'}[A-Z0-9]{3}$`).test(series);
}

export type CreditNoteProblem =
  | 'credit_note_not_einvoice'
  | 'credit_note_not_issued'
  | 'credit_note_not_recorded'
  | 'credit_note_exists'
  | 'credit_reason_ruc';

export const CREDIT_NOTE_PROBLEM_MESSAGES: Readonly<Record<CreditNoteProblem, string>> = {
  credit_note_not_einvoice: 'Solo se anula con nota de crédito una boleta o una factura.',
  credit_note_not_issued:
    'Ese comprobante no salió (está pendiente o SUNAT lo rechazó): no hace falta anularlo.',
  credit_note_not_recorded:
    'Primero anota la venta de ese comprobante («Anotar la venta») y después anúlalo.',
  credit_note_exists: 'Ese comprobante ya tiene su nota de crédito.',
  credit_reason_ruc: 'El error en el RUC solo se corrige en una factura.',
};

/** Revisa si se puede anular el comprobante con una nota de crédito; null si se puede. */
export function creditNoteProblem(
  original: { docType: EinvoiceDocType; status: string; recorded: boolean; hasNote: boolean },
  reason: CreditReason,
): CreditNoteProblem | null {
  if (original.docType === '07') return 'credit_note_not_einvoice';
  if (original.status !== 'accepted' && original.status !== 'test') {
    return 'credit_note_not_issued';
  }
  if (!original.recorded) return 'credit_note_not_recorded';
  if (original.hasNote) return 'credit_note_exists';
  if (reason === '02' && original.docType !== '01') return 'credit_reason_ruc';
  return null;
}

/**
 * Base e IGV del total, con la misma regla de todo Contabili (`tax/igv.ts`).
 * En el Nuevo RUS el precio no separa el IGV: todo es el importe.
 */
export function einvoiceAmounts(
  total: Cents,
  regime: TaxRegime,
): { base: Cents; igv: Cents; total: Cents } {
  if (regime === 'nrus') return { base: total, igv: 0, total };
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
