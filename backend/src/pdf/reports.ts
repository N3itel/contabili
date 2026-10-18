import { formatDate, periodLabel } from '../accounting/lima.js';
import { type Cents, formatSoles } from '../accounting/money.js';
import type { RegisterDto } from '../accounting/registers.service.js';
import type { TrialBalanceDto } from '../accounting/reports.service.js';
import type { FinanceSummary } from '../accounting/summary-rules.js';
import type { MonthlyTaxes } from '../tax/monthly-taxes.js';
import { BRAND } from '../web/brand.js';
import { ReportPdf } from './report-pdf.js';

/** Los reportes en PDF: el resumen del mes para el dueño y los libros para el contador. */

export interface PdfCompany {
  legalName: string;
  ruc: string;
}

const REGIME_LABEL: Readonly<Record<MonthlyTaxes['regime'], string>> = {
  nrus: 'Nuevo RUS',
  rer: 'Régimen Especial (RER)',
  rmt: 'Régimen MYPE Tributario',
  general: 'Régimen General',
};

/** En las tablas, el nombre corto del comprobante: entra en una línea. */
const SHORT_DOC: Readonly<Record<string, string>> = {
  '01': 'Factura',
  '03': 'Boleta',
  '02': 'Recibo honorarios',
  '12': 'Ticket',
  '00': 'Otro',
};

const soles = formatSoles;
const range = (from: string, to: string) => `Del ${formatDate(from)} al ${formatDate(to)}`;

/** Cómo le fue al negocio en el mes, en palabras simples: el reporte para el dueño. */
export function monthlyReportPdf(input: {
  company: PdfCompany;
  period: string;
  summary: FinanceSummary;
  taxes: MonthlyTaxes;
  sales: RegisterDto;
  purchases: RegisterDto;
}): Promise<Buffer> {
  const { summary, taxes } = input;
  const pdf = new ReportPdf({
    title: `Reporte de ${periodLabel(input.period)}`,
    subtitle: `${REGIME_LABEL[taxes.regime]} · Así le fue a tu negocio este mes, con lo que registraste en Contabili.`,
    company: input.company,
  });
  const result = summary.month.result;
  pdf.section('Tu plata').keyValues([
    { label: 'Caja (efectivo)', value: soles(summary.money.cash) },
    { label: 'Bancos y billeteras', value: soles(summary.money.bank) },
    { label: 'Plata disponible', value: soles(summary.money.total), strong: true },
  ]);
  pdf.section('Cómo te fue en el mes').keyValues([
    { label: 'Vendiste (sin IGV)', value: soles(summary.month.sales) },
    { label: 'Gastaste (sin IGV)', value: soles(summary.month.expenses) },
    {
      label: result >= 0 ? 'Vas ganando' : 'Vas perdiendo',
      value: soles(Math.abs(result)),
      strong: true,
      color: result >= 0 ? BRAND.green : BRAND.red,
    },
  ]);
  pdf.note('Es aproximado: no considera el costo de lo vendido ni la variación del inventario.');
  pdf.section('Lo que te deben y lo que debes').keyValues([
    { label: 'Te deben tus clientes', value: soles(summary.receivable) },
    { label: 'Debes a tus proveedores', value: soles(summary.payable) },
  ]);
  const taxRows: { label: string; value: string; strong?: boolean }[] = [];
  if (taxes.igv) {
    taxRows.push(
      { label: 'IGV de tus ventas', value: soles(taxes.igv.sales) },
      { label: 'IGV de tus compras con factura', value: `−${soles(taxes.igv.purchases)}` },
    );
    if (taxes.igv.previousCredit > 0) {
      taxRows.push({
        label: 'Saldo a favor del mes anterior',
        value: `−${soles(taxes.igv.previousCredit)}`,
      });
    }
    taxRows.push({ label: 'IGV a pagar', value: soles(taxes.igv.toPay) });
  }
  taxRows.push(
    {
      label:
        taxes.income.kind === 'nrus_quota'
          ? `Cuota del Nuevo RUS (categoría ${taxes.income.nrusCategory})`
          : `Renta: ${String(taxes.income.ratePercent).replace('.', ',')} % de tus ventas`,
      value: soles(taxes.income.amount),
    },
    { label: 'Total para SUNAT (en soles enteros)', value: soles(taxes.total), strong: true },
  );
  pdf.section('Impuestos del mes').keyValues(taxRows);
  if (taxes.igv && taxes.igv.nextCredit > 0) {
    pdf.note(`Te queda ${soles(taxes.igv.nextCredit)} de IGV a favor para el próximo mes.`);
  }
  for (const note of taxes.notes) pdf.note(note);
  pdf.section('Comprobantes del mes').table(
    [
      { header: 'Registro', width: 3 },
      { header: 'Comprobantes', width: 2, align: 'right' },
      { header: 'Base', width: 2, align: 'right' },
      { header: 'IGV', width: 2, align: 'right' },
      { header: 'Total', width: 2, align: 'right' },
    ],
    [input.sales, input.purchases].map((r) => [
      r.direction === 'sale' ? 'Ventas' : 'Compras',
      String(r.totals.count),
      soles(r.totals.base),
      soles(r.totals.igv),
      soles(r.totals.total),
    ]),
  );
  pdf.note(
    'Es un resumen con lo registrado en Contabili. No reemplaza la declaración a SUNAT: la presenta el contribuyente o su contador.',
  );
  return pdf.finish();
}

/** Registro de ventas o de compras, como lo pide un contador. */
export function registerPdf(company: PdfCompany, register: RegisterDto): Promise<Buffer> {
  const sales = register.direction === 'sale';
  const pdf = new ReportPdf({
    title: sales ? 'Registro de ventas' : 'Registro de compras',
    subtitle: `${range(register.from, register.to)} · ${register.totals.count} comprobantes válidos`,
    company,
  });
  pdf.table(
    [
      { header: 'Fecha', width: 2 },
      { header: 'Comprobante', width: 3 },
      { header: sales ? 'Cliente' : 'Proveedor', width: 4 },
      { header: 'Base', width: 2, align: 'right' },
      { header: 'IGV', width: 2, align: 'right' },
      { header: 'Total', width: 2, align: 'right' },
    ],
    register.rows.map((r) => [
      formatDate(r.issueDate),
      `${SHORT_DOC[r.docType]} ${r.series}-${r.number}${r.annulled ? ' (anulado)' : ''}`,
      [r.counterpartyName, r.counterpartyRuc ? `RUC ${r.counterpartyRuc}` : null]
        .filter(Boolean)
        .join('\n') || '—',
      soles(r.base),
      soles(r.igv),
      soles(r.total),
    ]),
    {
      totals: [
        '',
        'Totales',
        '',
        soles(register.totals.base),
        soles(register.totals.igv),
        soles(register.totals.total),
      ],
      muted: (i) => register.rows[i].annulled,
    },
  );
  if (register.rows.some((r) => r.annulled)) {
    pdf.note('Los comprobantes anulados (su asiento se extornó) figuran en gris y no suman.');
  }
  if (register.truncated) pdf.note('Hay más comprobantes: descarga un rango de fechas más corto.');
  return pdf.finish();
}

/** Balance de comprobación con sumas y saldos. */
export function trialBalancePdf(company: PdfCompany, report: TrialBalanceDto): Promise<Buffer> {
  const pdf = new ReportPdf({
    title: 'Balance de comprobación',
    subtitle: range(report.from, report.to),
    company,
  });
  const t = report.totals;
  pdf.table(
    [
      { header: 'Cuenta', width: 1.3 },
      { header: 'Nombre', width: 4 },
      { header: 'Debe', width: 2, align: 'right' },
      { header: 'Haber', width: 2, align: 'right' },
      { header: 'Saldo deudor', width: 2, align: 'right' },
      { header: 'Saldo acreedor', width: 2, align: 'right' },
    ],
    report.rows.map((r) => [
      r.code,
      r.name,
      soles(r.debit),
      soles(r.credit),
      soles(r.debitBalance),
      soles(r.creditBalance),
    ]),
    {
      totals: [
        '',
        'Totales',
        soles(t.debit),
        soles(t.credit),
        soles(t.debitBalance),
        soles(t.creditBalance),
      ],
    },
  );
  return pdf.finish();
}

export interface JournalPdfLine {
  number: number;
  fiscalYear: number;
  entryDate: string;
  description: string;
  accountCode: string;
  accountName: string;
  debit: Cents;
  credit: Cents;
}

/** Libro diario: cada asiento con sus líneas. */
export function journalPdf(
  company: PdfCompany,
  from: string,
  to: string,
  lines: readonly JournalPdfLine[],
  truncated: boolean,
): Promise<Buffer> {
  const pdf = new ReportPdf({ title: 'Libro diario', subtitle: range(from, to), company });
  const rows: string[][] = [];
  let previous = '';
  for (const l of lines) {
    const key = `${l.number}-${l.fiscalYear}`;
    rows.push([
      key === previous ? '' : key,
      key === previous ? '' : formatDate(l.entryDate),
      key === previous
        ? `${l.accountCode} ${l.accountName}`
        : `${l.description}\n${l.accountCode} ${l.accountName}`,
      l.debit > 0 ? soles(l.debit) : '',
      l.credit > 0 ? soles(l.credit) : '',
    ]);
    previous = key;
  }
  pdf.table(
    [
      { header: 'Asiento', width: 1.5 },
      { header: 'Fecha', width: 1.8 },
      { header: 'Glosa y cuenta', width: 6 },
      { header: 'Debe', width: 2, align: 'right' },
      { header: 'Haber', width: 2, align: 'right' },
    ],
    rows,
    {
      totals: [
        '',
        '',
        'Totales',
        soles(lines.reduce((sum, l) => sum + l.debit, 0)),
        soles(lines.reduce((sum, l) => sum + l.credit, 0)),
      ],
    },
  );
  if (truncated) pdf.note('Hay más asientos: descarga un rango de fechas más corto.');
  return pdf.finish();
}
