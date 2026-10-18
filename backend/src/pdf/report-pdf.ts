import { readFileSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import { formatDate, limaDate } from '../accounting/lima.js';
import { BRAND, CHAKANA_POINTS } from '../web/brand.js';

/**
 * Reportes en PDF con la marca: chakana, franja tocapu y las letras de la
 * app (Saira para títulos y montos, Lexend para el texto; las genera
 * `tools/letras.py`). Tamaño A4, para imprimir o mandar al contador.
 */

const font = (name: string) => readFileSync(new URL(`./fonts/${name}.ttf`, import.meta.url));
const FONTS = {
  display: font('Saira-Bold'),
  displayHeavy: font('Saira-ExtraBold'),
  text: font('Lexend-Regular'),
  textBold: font('Lexend-SemiBold'),
};

const MARGIN = 48;
const CHAKANA = CHAKANA_POINTS.split(' ').map((p) => p.split(',').map(Number) as [number, number]);

export type Align = 'left' | 'right' | 'center';

export interface Column {
  header: string;
  /** Proporción del ancho de la página. */
  width: number;
  align?: Align;
}

export interface ReportHeader {
  title: string;
  subtitle: string;
  company: { legalName: string; ruc: string };
  /** Por defecto, ahora. */
  generatedAt?: Date;
}

export class ReportPdf {
  private readonly doc: PDFKit.PDFDocument;
  private readonly chunks: Buffer[] = [];
  private readonly done: Promise<Buffer>;
  private readonly generatedAt: Date;

  constructor(private readonly header: ReportHeader) {
    this.generatedAt = header.generatedAt ?? new Date();
    this.doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN + 18, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: {
        Title: `${header.title} · ${header.company.legalName}`,
        Author: 'Contabili',
        Creator: 'Contabili',
      },
    });
    for (const [name, data] of Object.entries(FONTS)) this.doc.registerFont(name, data);
    this.doc.on('data', (chunk: Buffer) => this.chunks.push(chunk));
    this.done = new Promise((resolve) =>
      this.doc.on('end', () => resolve(Buffer.concat(this.chunks))),
    );
    this.drawHeader();
  }

  private get width(): number {
    return this.doc.page.width - MARGIN * 2;
  }

  private get bottom(): number {
    return this.doc.page.height - this.doc.page.margins.bottom;
  }

  /** Chakana con el Inti y el visto bueno, en un cuadro de `size` puntos. */
  private drawMark(x: number, y: number, size: number): void {
    const k = size / 100;
    const doc = this.doc;
    doc.polygon(...CHAKANA.map(([px, py]) => [x + px * k, y + py * k] as [number, number]));
    doc.fill(BRAND.terracotta);
    doc.circle(x + 50 * k, y + 50 * k, 16 * k).fill(BRAND.gold);
    doc
      .moveTo(x + 42.5 * k, y + 50.5 * k)
      .lineTo(x + 48 * k, y + 56 * k)
      .lineTo(x + 58 * k, y + 45 * k)
      .lineWidth(4.5 * k)
      .lineCap('round')
      .lineJoin('round')
      .stroke(BRAND.ink);
  }

  /** Franja tocapu: pirámides escalonadas de oro sobre terracota. */
  private drawTocapu(x: number, y: number, width: number, height: number): void {
    const doc = this.doc;
    const k = height / 12;
    doc.save();
    doc.rect(x, y, width, height).clip();
    doc.rect(x, y, width, height).fill(BRAND.terracotta);
    for (let ux = x; ux < x + width; ux += 32 * k) {
      const p = (dx: number, dy: number): [number, number] => [ux + dx * k, y + dy * k];
      doc
        .polygon(
          p(2, 12),
          p(2, 9),
          p(5, 9),
          p(5, 6),
          p(8, 6),
          p(8, 3),
          p(12, 3),
          p(12, 6),
          p(15, 6),
          p(15, 9),
          p(18, 9),
          p(18, 12),
        )
        .fill(BRAND.gold);
      doc.rect(ux + 9 * k, y + 7 * k, 2 * k, 2 * k).fill(BRAND.ink);
      doc
        .polygon(
          p(18, 0),
          p(18, 3),
          p(21, 3),
          p(21, 6),
          p(24, 6),
          p(24, 9),
          p(28, 9),
          p(28, 6),
          p(31, 6),
          p(31, 3),
          p(32, 3),
          p(32, 0),
        )
        .fill(BRAND.ink);
    }
    doc.restore();
  }

  private drawHeader(): void {
    const doc = this.doc;
    const top = MARGIN;
    this.drawMark(MARGIN, top, 30);
    doc
      .font('displayHeavy')
      .fontSize(18)
      .fillColor(BRAND.ink)
      .text('Contabili', MARGIN + 38, top + 4);
    const tagX = MARGIN + 38 + doc.widthOfString('Contabili') + 8;
    doc.roundedRect(tagX, top + 9, 32, 13, 3).fill(BRAND.gold);
    doc
      .font('textBold')
      .fontSize(7)
      .fillColor(BRAND.ink)
      .text('BETA', tagX, top + 12, { width: 32, align: 'center' });
    doc
      .font('textBold')
      .fontSize(10)
      .fillColor(BRAND.ink)
      .text(this.header.company.legalName, MARGIN, top + 2, { width: this.width, align: 'right' });
    doc
      .font('text')
      .fontSize(9)
      .fillColor(BRAND.ink2)
      .text(`RUC ${this.header.company.ruc}`, MARGIN, top + 16, {
        width: this.width,
        align: 'right',
      });
    this.drawTocapu(MARGIN, top + 40, this.width, 8);
    doc
      .font('display')
      .fontSize(22)
      .fillColor(BRAND.ink)
      .text(this.header.title, MARGIN, top + 60, { width: this.width });
    doc
      .font('text')
      .fontSize(10.5)
      .fillColor(BRAND.ink2)
      .text(this.header.subtitle, { width: this.width });
    doc.moveDown(1.2);
  }

  /** Salta de página si no entra `height`. */
  private ensure(height: number): void {
    if (this.doc.y + height > this.bottom) {
      this.doc.addPage();
      this.doc.y = MARGIN;
    }
  }

  /** Título de sección con los peldaños de oro. */
  section(title: string): this {
    const doc = this.doc;
    this.ensure(60);
    doc.moveDown(0.6);
    const y = doc.y;
    const u = 3.4;
    doc.rect(MARGIN, y + 2 * u + 3, 3 * u, u).fill(BRAND.gold);
    doc.rect(MARGIN + u, y + u + 3, 2 * u, u).fill(BRAND.gold);
    doc.rect(MARGIN + 2 * u, y + 3, u, u).fill(BRAND.gold);
    doc
      .font('display')
      .fontSize(14)
      .fillColor(BRAND.ink)
      .text(title, MARGIN + 18, y, { width: this.width - 18 });
    doc.moveDown(0.4);
    return this;
  }

  /** Pares «concepto — monto», con la fila destacada en negrita. */
  keyValues(
    rows: readonly { label: string; value: string; strong?: boolean; color?: string }[],
  ): this {
    const doc = this.doc;
    for (const row of rows) {
      this.ensure(22);
      const y = doc.y;
      doc
        .font(row.strong ? 'textBold' : 'text')
        .fontSize(10.5)
        .fillColor(BRAND.ink2)
        .text(row.label, MARGIN, y + 4, { width: this.width * 0.65 });
      const labelBottom = doc.y;
      doc
        .font(row.strong ? 'displayHeavy' : 'display')
        .fontSize(row.strong ? 13 : 11.5)
        .fillColor(row.color ?? BRAND.ink)
        .text(row.value, MARGIN, y + (row.strong ? 2 : 3), { width: this.width, align: 'right' });
      doc.y = Math.max(labelBottom, doc.y) + 4;
      doc
        .moveTo(MARGIN, doc.y)
        .lineTo(MARGIN + this.width, doc.y)
        .lineWidth(0.5)
        .stroke('#E6DCCB');
    }
    doc.moveDown(0.5);
    return this;
  }

  /** Tabla con encabezado (se repite en cada página), filas alternadas y totales. */
  table(
    columns: readonly Column[],
    rows: readonly (readonly string[])[],
    options: { totals?: readonly string[]; muted?: (index: number) => boolean } = {},
  ): this {
    const doc = this.doc;
    const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);
    const widths = columns.map((c) => (c.width / totalWidth) * this.width);
    const pad = 4;
    const drawRow = (cells: readonly string[], style: 'header' | 'row' | 'total', index = 0) => {
      doc.font(style === 'row' ? 'text' : 'textBold').fontSize(style === 'header' ? 8.5 : 9);
      const height =
        Math.max(
          ...cells.map((cell, i) => doc.heightOfString(cell, { width: widths[i] - pad * 2 })),
        ) +
        pad * 2;
      if (style !== 'header') this.ensure(height + (style === 'row' ? 0 : 4));
      if (doc.y + height > this.bottom) this.ensure(height);
      const y = doc.y;
      if (style === 'header') doc.rect(MARGIN, y, this.width, height).fill(BRAND.ink);
      else if (style === 'total') doc.rect(MARGIN, y, this.width, height).fill(BRAND.goldSoft);
      else if (index % 2 === 1) doc.rect(MARGIN, y, this.width, height).fill(BRAND.paper);
      let x = MARGIN;
      cells.forEach((cell, i) => {
        doc
          .fillColor(
            style === 'header' ? '#FFFFFF' : options.muted?.(index) ? '#8A8D9C' : BRAND.ink,
          )
          .text(cell, x + pad, y + pad, {
            width: widths[i] - pad * 2,
            align: columns[i].align ?? 'left',
          });
        x += widths[i];
      });
      doc.y = y + height;
    };
    this.ensure(60);
    drawRow(
      columns.map((c) => c.header),
      'header',
    );
    rows.forEach((row, index) => {
      if (doc.y + 24 > this.bottom) {
        doc.addPage();
        doc.y = MARGIN;
        drawRow(
          columns.map((c) => c.header),
          'header',
        );
      }
      drawRow(row, 'row', index);
    });
    if (options.totals) drawRow(options.totals, 'total');
    doc.moveDown(0.8);
    return this;
  }

  /** Texto corto en gris: aclaraciones. */
  note(text: string): this {
    this.ensure(30);
    this.doc
      .font('text')
      .fontSize(9)
      .fillColor(BRAND.ink2)
      .text(text, MARGIN, this.doc.y, { width: this.width });
    this.doc.moveDown(0.6);
    return this;
  }

  /** Cierra el documento: pie con fecha y páginas en cada hoja. */
  async finish(): Promise<Buffer> {
    const doc = this.doc;
    const range = doc.bufferedPageRange();
    const stamp = `Contabili (beta) · Generado el ${formatDate(limaDate(this.generatedAt))}`;
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const y = doc.page.height - MARGIN + 4;
      // Sin margen inferior mientras se escribe el pie, para que no abra otra página.
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .moveTo(MARGIN, y - 6)
        .lineTo(MARGIN + this.width, y - 6)
        .lineWidth(0.5)
        .stroke('#E6DCCB');
      doc
        .font('text')
        .fontSize(8)
        .fillColor(BRAND.ink2)
        .text(stamp, MARGIN, y, { width: this.width, lineBreak: false });
      doc.text(`Página ${i - range.start + 1} de ${range.count}`, MARGIN, y, {
        width: this.width,
        align: 'right',
        lineBreak: false,
      });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
    return this.done;
  }
}
