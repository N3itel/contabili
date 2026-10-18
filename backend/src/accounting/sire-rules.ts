import type { RegisterDocType } from './document-rules.js';
import type { Cents } from './money.js';

/**
 * Archivos del SIRE para reemplazar la propuesta de SUNAT: el Registro de
 * Ventas e Ingresos (RVIE, anexo 3 de la R. S. 112-2021/SUNAT, 33 campos) y
 * el Registro de Compras (RCE, anexo 11 de la R. S. 040-2022/SUNAT, 37
 * campos). Campos separados por «|», montos con punto y dos decimales y, en
 * negativo, «-#.##». Lo que Contabili no lleva (exportación, ISC, IVAP,
 * ICBPER) va en 0.00.
 */

export type SireBook = 'sales' | 'purchases';

/** Libro en el nombre del archivo: 140400 ventas, 080400 compras. */
const BOOK_CODE: Readonly<Record<SireBook, string>> = { sales: '140400', purchases: '080400' };

/**
 * «LE{RUC}{AAAA}{MM}00{libro}02{O}{I}{M}2.TXT»: 02 reemplaza la propuesta,
 * O = 1 empresa operativa, I = 1 con información (0 sin), M = 1 soles y
 * 2 generado para el SIRE.
 */
export function sireFileName(
  book: SireBook,
  ruc: string,
  period: string,
  hasData: boolean,
): string {
  const [year, month] = period.split('-');
  return `LE${ruc}${year}${month}00${BOOK_CODE[book]}021${hasData ? 1 : 0}12.TXT`;
}

/** 11800 → «118.00»; -11800 → «-118.00». */
export function sireAmount(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** El texto libre no lleva «|», «/» ni «\» (ni saltos de línea). */
export function sireText(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/[|/\\\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 'AAAA-MM-DD' → 'DD/MM/AAAA'. */
export function sireDate(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

/** Un comprobante del registro, con lo que el SIRE necesita. */
export interface SireRow {
  issueDate: string;
  docType: RegisterDocType;
  series: string;
  number: number;
  /** Documento de la otra parte: 6 RUC, 1 DNI o ninguno. */
  partyDocType: '6' | '1' | null;
  partyDoc: string | null;
  partyName: string | null;
  /** Con signo: una nota de crédito va en negativo. */
  base: Cents;
  igv: Cents;
  total: Cents;
  /** Extornado a mano: se anota con importe cero. */
  annulled: boolean;
  modifies: { docType: RegisterDocType; series: string; number: number; issueDate: string } | null;
}

export interface SireCompany {
  ruc: string;
  legalName: string;
}

const line = (fields: readonly string[]) => `${fields.join('|')}|`;
const ZERO = '0.00';

/** Una fila del RVIE que reemplaza la propuesta (33 campos). */
export function rvieLine(company: SireCompany, period: string, row: SireRow): string {
  const amount = (cents: Cents) => sireAmount(row.annulled ? 0 : cents);
  const party = row.partyDocType && row.partyDoc;
  return line([
    company.ruc,
    sireText(company.legalName),
    period.replace('-', ''),
    '', // CAR: lo pone SUNAT.
    sireDate(row.issueDate),
    '', // Vencimiento: solo recibos de servicios públicos (14).
    row.docType,
    row.series,
    String(row.number),
    '', // Número final: Contabili no consolida boletas.
    party ? (row.partyDocType as string) : '',
    party ? (row.partyDoc as string) : '',
    party ? sireText(row.partyName) : '',
    ZERO, // Exportación.
    amount(row.base),
    ZERO, // Descuento de la base.
    amount(row.igv),
    ZERO, // Descuento del IGV.
    ZERO, // Exonerado.
    ZERO, // Inafecto.
    ZERO, // ISC.
    ZERO, // Base IVAP.
    ZERO, // IVAP.
    ZERO, // ICBPER.
    ZERO, // Otros tributos.
    amount(row.total),
    'PEN',
    '', // Tipo de cambio: solo en otra moneda.
    row.modifies ? sireDate(row.modifies.issueDate) : '',
    row.modifies?.docType ?? '',
    row.modifies?.series ?? '',
    row.modifies ? String(row.modifies.number) : '',
    '', // Contratos de colaboración.
  ]);
}

/**
 * Una fila del RCE que reemplaza la propuesta (37 campos). Con IGV, la
 * compra da crédito fiscal (destino gravado); sin IGV, va como adquisición
 * no gravada.
 */
export function rceLine(company: SireCompany, period: string, row: SireRow): string {
  const credit = row.igv !== 0;
  const party = row.partyDocType && row.partyDoc;
  return line([
    company.ruc,
    sireText(company.legalName),
    period.replace('-', ''),
    '', // CAR: lo pone SUNAT.
    sireDate(row.issueDate),
    '', // Vencimiento o pago: solo servicios públicos e importaciones.
    row.docType,
    row.series,
    '', // Año de la DAM.
    String(row.number),
    '', // Número final.
    party ? (row.partyDocType as string) : '',
    party ? (row.partyDoc as string) : '',
    party ? sireText(row.partyName) : '',
    credit ? sireAmount(row.base) : ZERO,
    credit ? sireAmount(row.igv) : ZERO,
    ZERO, // Base con destino mixto.
    ZERO, // IGV con destino mixto.
    ZERO, // Base con destino no gravado.
    ZERO, // IGV con destino no gravado.
    credit ? ZERO : sireAmount(row.total),
    ZERO, // ISC.
    ZERO, // ICBPER.
    ZERO, // Otros tributos.
    sireAmount(row.total),
    'PEN',
    '', // Tipo de cambio.
    row.modifies ? sireDate(row.modifies.issueDate) : '',
    row.modifies?.docType ?? '',
    row.modifies?.series ?? '',
    '', // Aduana.
    row.modifies ? String(row.modifies.number) : '',
    '', // Clasificación de bienes y servicios (más de 1 500 UIT).
    '', // Contratos de colaboración.
    '', // Porcentaje de participación.
    '', // Impuesto materia de beneficio (Ley 31053).
    '', // CAR del comprobante que se modifica.
  ]);
}

/**
 * Qué compras van al RCE: no los recibos por honorarios (van al libro de
 * retenciones) ni lo anulado.
 */
export function inPurchaseRegister(row: SireRow): boolean {
  return row.docType !== '02' && !row.annulled;
}

/** El archivo entero, con saltos de línea de Windows. */
export function sireFile(lines: readonly string[]): string {
  return lines.map((l) => `${l}\r\n`).join('');
}
