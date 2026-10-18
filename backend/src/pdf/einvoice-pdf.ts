import { formatDate } from '../accounting/lima.js';
import { formatSoles } from '../accounting/money.js';
import {
  amountInWords,
  type CustomerDocType,
  type EinvoiceDocType,
  EINVOICE_TYPES,
  einvoiceNumberLabel,
  type EinvoiceType,
} from '../einvoicing/einvoice-rules.js';
import type { PdfCompany } from './reports.js';
import { ReportPdf } from './report-pdf.js';

export interface EinvoicePdfInput {
  company: PdfCompany;
  type: EinvoiceDocType;
  /** Nota de crédito: la boleta o factura que anula y el motivo. */
  note?: { type: EinvoiceType; label: string; issueDate: string; reason: string };
  series: string;
  number: number;
  issueDate: string;
  customer: { docType: CustomerDocType; number: string | null; name: string | null };
  description: string;
  base: number;
  igv: number;
  total: number;
  /** Modo de prueba: lleva la marca de agua y la aclaración. */
  test: boolean;
  hash: string | null;
}

/** Representación impresa de la boleta, factura o nota de crédito electrónica. */
export function einvoicePdf(input: EinvoicePdfInput): Promise<Buffer> {
  const label = einvoiceNumberLabel(input.series, input.number);
  const pdf = new ReportPdf({
    title: `${EINVOICE_TYPES[input.type]} ${label}`,
    subtitle: `Fecha de emisión: ${formatDate(input.issueDate)} · Moneda: soles`,
    company: input.company,
  });
  if (input.test) pdf.watermark('PRUEBA · SIN VALOR TRIBUTARIO');
  const { docType, number, name } = input.customer;
  pdf.section('Cliente').keyValues([
    {
      label: docType === 'ruc' ? 'RUC' : docType === 'dni' ? 'DNI' : 'Documento',
      value: docType === 'none' ? '—' : (number ?? '—'),
    },
    {
      label: docType === 'ruc' ? 'Razón social' : 'Nombre',
      value: docType === 'none' ? 'Clientes varios' : (name ?? '—'),
    },
  ]);
  if (input.note) {
    pdf.section('Documento que modifica').keyValues([
      {
        label: 'Comprobante',
        value: `${EINVOICE_TYPES[input.note.type]} ${input.note.label}`,
      },
      { label: 'Fecha de emisión', value: formatDate(input.note.issueDate) },
      { label: 'Motivo', value: input.note.reason },
    ]);
  }
  pdf.section('Detalle').table(
    [
      { header: 'Cant.', width: 1, align: 'center' },
      { header: 'Descripción', width: 6 },
      { header: 'Valor unitario', width: 2.2, align: 'right' },
      { header: 'Importe', width: 2.2, align: 'right' },
    ],
    [['1', input.description, formatSoles(input.base), formatSoles(input.total)]],
  );
  pdf.keyValues([
    { label: 'Operación gravada', value: formatSoles(input.base) },
    { label: 'IGV (18 %)', value: formatSoles(input.igv) },
    { label: 'Importe total', value: formatSoles(input.total), strong: true },
  ]);
  pdf.note(amountInWords(input.total));
  pdf.note(
    input.test
      ? 'Comprobante de prueba generado en Contabili (beta): no se envió a SUNAT y no tiene valor tributario.'
      : `Representación impresa de la ${EINVOICE_TYPES[input.type].toLowerCase()}.${input.hash ? ` Código hash: ${input.hash}.` : ''}`,
  );
  return pdf.finish();
}
