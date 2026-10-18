import {
  inPurchaseRegister,
  rceLine,
  rvieLine,
  sireAmount,
  sireDate,
  sireFile,
  sireFileName,
  type SireRow,
  sireText,
} from './sire-rules.js';

const company = { ruc: '20131312955', legalName: 'Bodega Doña Rosa E.I.R.L.' };

const boleta: SireRow = {
  issueDate: '2026-10-05',
  docType: '03',
  series: 'B001',
  number: 45,
  partyDocType: null,
  partyDoc: null,
  partyName: null,
  base: 10000,
  igv: 1800,
  total: 11800,
  annulled: false,
  modifies: null,
};

describe('SIRE: archivos para reemplazar la propuesta', () => {
  it('nombra los archivos como pide SUNAT', () => {
    expect(sireFileName('sales', '20131312955', '2026-10', true)).toBe(
      'LE2013131295520261000140400021112.TXT',
    );
    expect(sireFileName('purchases', '20131312955', '2026-10', false)).toBe(
      'LE2013131295520261000080400021012.TXT',
    );
  });

  it('montos, fechas y textos', () => {
    expect(sireAmount(11800)).toBe('118.00');
    expect(sireAmount(5)).toBe('0.05');
    expect(sireAmount(-11800)).toBe('-118.00');
    expect(sireAmount(0)).toBe('0.00');
    expect(sireDate('2026-10-05')).toBe('05/10/2026');
    expect(sireText(' Ferretería | Sol / Luna \\ SAC\n')).toBe('Ferretería Sol Luna SAC');
  });

  it('una boleta y su nota de crédito en el RVIE (33 campos)', () => {
    const fields = rvieLine(company, '2026-10', boleta).split('|');
    // 33 campos y el palote final.
    expect(fields).toHaveLength(34);
    expect(fields.at(-1)).toBe('');
    expect(fields.slice(0, 13)).toEqual([
      '20131312955',
      'Bodega Doña Rosa E.I.R.L.',
      '202610',
      '',
      '05/10/2026',
      '',
      '03',
      'B001',
      '45',
      '',
      '',
      '',
      '',
    ]);
    expect(fields[14]).toBe('100.00');
    expect(fields[16]).toBe('18.00');
    expect(fields[23]).toBe('0.00'); // ICBPER
    expect(fields[25]).toBe('118.00');
    expect(fields[26]).toBe('PEN');

    const note = rvieLine(company, '2026-10', {
      ...boleta,
      docType: '07',
      series: 'BC01',
      number: 1,
      partyDocType: '1',
      partyDoc: '45678912',
      partyName: 'Juana Mamani',
      base: -10000,
      igv: -1800,
      total: -11800,
      modifies: { docType: '03', series: 'B001', number: 45, issueDate: '2026-10-05' },
    }).split('|');
    expect(fields.length).toBe(note.length);
    expect(note.slice(10, 13)).toEqual(['1', '45678912', 'Juana Mamani']);
    expect([note[14], note[16], note[25]]).toEqual(['-100.00', '-18.00', '-118.00']);
    expect(note.slice(28, 32)).toEqual(['05/10/2026', '03', 'B001', '45']);
  });

  it('lo extornado a mano se anota con importe cero', () => {
    const fields = rvieLine(company, '2026-10', { ...boleta, annulled: true }).split('|');
    expect([fields[14], fields[16], fields[25]]).toEqual(['0.00', '0.00', '0.00']);
  });

  it('compras en el RCE (37 campos): con IGV da crédito; sin IGV, no gravada', () => {
    const factura: SireRow = {
      ...boleta,
      docType: '01',
      series: 'F001',
      number: 9,
      partyDocType: '6',
      partyDoc: '20100070970',
      partyName: 'Distribuidora Andina SAC',
    };
    const fields = rceLine(company, '2026-10', factura).split('|');
    expect(fields).toHaveLength(38);
    expect(fields.slice(6, 14)).toEqual([
      '01',
      'F001',
      '',
      '9',
      '',
      '6',
      '20100070970',
      'Distribuidora Andina SAC',
    ]);
    expect([fields[14], fields[15], fields[20], fields[24], fields[25]]).toEqual([
      '100.00',
      '18.00',
      '0.00',
      '118.00',
      'PEN',
    ]);
    const ticket = rceLine(company, '2026-10', {
      ...boleta,
      docType: '12',
      base: 5900,
      igv: 0,
      total: 5900,
    }).split('|');
    expect([ticket[14], ticket[15], ticket[20], ticket[24]]).toEqual([
      '0.00',
      '0.00',
      '59.00',
      '59.00',
    ]);
    // Los recibos por honorarios y lo anulado no van.
    expect(inPurchaseRegister(factura)).toBe(true);
    expect(inPurchaseRegister({ ...factura, docType: '02' })).toBe(false);
    expect(inPurchaseRegister({ ...factura, annulled: true })).toBe(false);
  });

  it('cada fila termina en un salto de línea de Windows', () => {
    expect(sireFile(['a|', 'b|'])).toBe('a|\r\nb|\r\n');
    expect(sireFile([])).toBe('');
  });
});
