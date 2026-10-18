import {
  amountInWords,
  einvoiceAmounts,
  type EinvoiceInput,
  einvoiceNumberLabel,
  einvoiceProblem,
  integerInWords,
  isValidEinvoiceSeries,
} from './einvoice-rules.js';

const boleta = (extra: Partial<EinvoiceInput> = {}): EinvoiceInput => ({
  type: '03',
  customer: { docType: 'none' },
  description: 'Venta de abarrotes',
  total: 11800,
  ...extra,
});

describe('facturación electrónica: reglas', () => {
  it('boleta chica sin documento; de más de S/ 700, con DNI', () => {
    expect(einvoiceProblem(boleta(), 'rmt')).toBeNull();
    expect(einvoiceProblem(boleta({ total: 70000 }), 'rmt')).toBeNull();
    expect(einvoiceProblem(boleta({ total: 70001 }), 'rmt')).toBe('boleta_needs_id');
    expect(
      einvoiceProblem(
        boleta({
          total: 90000,
          customer: { docType: 'dni', number: '45678912', name: 'Juana Mamani' },
        }),
        'rmt',
      ),
    ).toBeNull();
    expect(
      einvoiceProblem(
        boleta({ customer: { docType: 'dni', number: '4567891', name: 'Juana' } }),
        'rmt',
      ),
    ).toBe('invalid_dni');
    expect(
      einvoiceProblem(boleta({ customer: { docType: 'dni', number: '45678912' } }), 'rmt'),
    ).toBe('customer_name_required');
  });

  it('factura con RUC válido', () => {
    const factura = boleta({
      type: '01',
      customer: { docType: 'ruc', number: '20131312955', name: 'Comercial Andina SAC' },
    });
    expect(einvoiceProblem(factura, 'rmt')).toBeNull();
    expect(
      einvoiceProblem(
        { ...factura, customer: { docType: 'dni', number: '45678912', name: 'X Y' } },
        'rmt',
      ),
    ).toBe('factura_needs_ruc');
    expect(
      einvoiceProblem(
        { ...factura, customer: { docType: 'ruc', number: '20131312954', name: 'X Y' } },
        'rmt',
      ),
    ).toBe('invalid_ruc');
  });

  it('no en el Nuevo RUS (por ahora) y con descripción', () => {
    expect(einvoiceProblem(boleta(), 'nrus')).toBe('einvoice_nrus');
    expect(einvoiceProblem(boleta({ description: ' ab ' }), 'rmt')).toBe('invalid_description');
  });

  it('series electrónicas y número de 8 dígitos', () => {
    expect(isValidEinvoiceSeries('01', 'F001')).toBe(true);
    expect(isValidEinvoiceSeries('01', 'B001')).toBe(false);
    expect(isValidEinvoiceSeries('03', 'B0A1')).toBe(true);
    expect(isValidEinvoiceSeries('03', 'B0001')).toBe(false);
    expect(einvoiceNumberLabel('B001', 45)).toBe('B001-00000045');
  });

  it('base e IGV con la regla de siempre', () => {
    expect(einvoiceAmounts(11800)).toEqual({ base: 10000, igv: 1800, total: 11800 });
  });

  it('el monto en letras', () => {
    expect(integerInWords(0)).toBe('cero');
    expect(integerInWords(1)).toBe('uno');
    expect(integerInWords(16)).toBe('dieciséis');
    expect(integerInWords(21)).toBe('veintiuno');
    expect(integerInWords(45)).toBe('cuarenta y cinco');
    expect(integerInWords(100)).toBe('cien');
    expect(integerInWords(118)).toBe('ciento dieciocho');
    expect(integerInWords(1000)).toBe('mil');
    expect(integerInWords(1180)).toBe('mil ciento ochenta');
    expect(integerInWords(21000)).toBe('veintiún mil');
    expect(integerInWords(31000)).toBe('treinta y un mil');
    expect(integerInWords(501000)).toBe('quinientos un mil');
    expect(integerInWords(1000000)).toBe('un millón');
    expect(integerInWords(2500300)).toBe('dos millones quinientos mil trescientos');
    expect(amountInWords(11800)).toBe('SON: CIENTO DIECIOCHO CON 00/100 SOLES');
    expect(amountInWords(5)).toBe('SON: CERO CON 05/100 SOLES');
  });
});
