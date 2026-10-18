import {
  type EinvoiceDraft,
  isAllowedEndpoint,
  NubefactProvider,
  nubefactPayload,
  parseNubefactResponse,
} from './providers.js';

const draft: EinvoiceDraft = {
  type: '03',
  series: 'B001',
  number: 45,
  issueDate: '2026-10-17',
  customer: { docType: 'none' },
  description: 'Venta de abarrotes',
  kind: 'goods',
  base: 10000,
  igv: 1800,
  total: 11800,
};
const credentials = { endpoint: 'https://api.nubefact.com/api/v1/abc-123', token: 'secreto' };

describe('proveedores de facturación', () => {
  it('arma el JSON de Nubefact', () => {
    const body = nubefactPayload(draft);
    expect(body).toMatchObject({
      operacion: 'generar_comprobante',
      tipo_de_comprobante: 2,
      serie: 'B001',
      numero: 45,
      cliente_tipo_de_documento: '-',
      cliente_denominacion: 'CLIENTES VARIOS',
      fecha_de_emision: '2026-10-17',
      moneda: 1,
      total_gravada: '100.00',
      total_igv: '18.00',
      total: '118.00',
      enviar_automaticamente_a_la_sunat: true,
    });
    expect(body.items).toEqual([
      expect.objectContaining({
        unidad_de_medida: 'NIU',
        valor_unitario: '100.00',
        precio_unitario: '118.00',
        tipo_de_igv: 1,
      }),
    ]);
    const factura = nubefactPayload({
      ...draft,
      type: '01',
      series: 'F001',
      kind: 'services',
      customer: { docType: 'ruc', number: '20131312955', name: 'Comercial Andina SAC' },
    });
    expect(factura).toMatchObject({
      tipo_de_comprobante: 1,
      cliente_tipo_de_documento: 6,
      cliente_numero_de_documento: '20131312955',
      cliente_denominacion: 'Comercial Andina SAC',
    });
    expect((factura.items as { unidad_de_medida: string }[])[0].unidad_de_medida).toBe('ZZ');
    expect(factura).not.toHaveProperty('tipo_de_nota_de_credito');
  });

  it('arma la nota de crédito con el comprobante que anula', () => {
    const note = nubefactPayload({
      ...draft,
      type: '07',
      series: 'BC01',
      number: 3,
      note: { type: '03', series: 'B001', number: 45, reason: '06' },
    });
    expect(note).toMatchObject({
      tipo_de_comprobante: 3,
      serie: 'BC01',
      numero: 3,
      documento_que_se_modifica_tipo: 2,
      documento_que_se_modifica_serie: 'B001',
      documento_que_se_modifica_numero: 45,
      tipo_de_nota_de_credito: 6,
      total: '118.00',
    });
  });

  it('lee aceptado, rechazado, pendiente y error', () => {
    expect(
      parseNubefactResponse({
        aceptada_por_sunat: true,
        sunat_description: 'La Boleta numero B001-45, ha sido aceptada',
        enlace_del_pdf: 'https://www.nubefact.com/cpe/x.pdf',
        codigo_hash: 'abc',
      }),
    ).toEqual({
      status: 'accepted',
      message: 'La Boleta numero B001-45, ha sido aceptada',
      pdfUrl: 'https://www.nubefact.com/cpe/x.pdf',
      xmlUrl: undefined,
      cdrUrl: undefined,
      hash: 'abc',
    });
    expect(
      parseNubefactResponse({
        aceptada_por_sunat: false,
        sunat_responsecode: '2017',
        sunat_description: 'RUC no válido',
      }).status,
    ).toBe('rejected');
    expect(parseNubefactResponse({ aceptada_por_sunat: false }).status).toBe('pending');
    expect(parseNubefactResponse({ errors: 'El número ya existe', codigo: 23 })).toEqual({
      status: 'error',
      message: 'Tu proveedor de facturación no lo aceptó: El número ya existe.',
    });
  });

  it('solo llama a rutas de Nubefact por HTTPS', () => {
    expect(isAllowedEndpoint('https://api.nubefact.com/api/v1/abc')).toBe(true);
    expect(isAllowedEndpoint('https://api.pse.pe/api/v1/abc')).toBe(true);
    expect(isAllowedEndpoint('http://api.nubefact.com/api/v1/abc')).toBe(false);
    expect(isAllowedEndpoint('https://nubefact.com.evil.pe/api')).toBe(false);
    expect(isAllowedEndpoint('https://user:pw@api.nubefact.com/api')).toBe(false);
    expect(isAllowedEndpoint('https://169.254.169.254/latest')).toBe(false);
    expect(isAllowedEndpoint('no es una url')).toBe(false);
  });

  it('manda el token en la cabecera y no pierde un comprobante si se corta la conexión', async () => {
    let seen: RequestInit | undefined;
    const ok = new NubefactProvider(async (_url, init) => {
      seen = init;
      return new Response(JSON.stringify({ aceptada_por_sunat: true }), { status: 200 });
    });
    expect((await ok.emit(draft, credentials)).status).toBe('accepted');
    const sent = seen as RequestInit;
    expect((sent.headers as Record<string, string>).Authorization).toBe('Token token=secreto');
    expect(JSON.parse(sent.body as string).operacion).toBe('generar_comprobante');

    const down = new NubefactProvider(async () => {
      throw new Error('ECONNRESET');
    });
    expect((await down.emit(draft, credentials)).status).toBe('pending');
    const unauthorized = new NubefactProvider(async () => new Response('', { status: 401 }));
    expect((await unauthorized.emit(draft, credentials)).status).toBe('error');
    const invalid = new NubefactProvider(
      async () => new Response(JSON.stringify({ errors: 'Serie inválida' }), { status: 400 }),
    );
    expect(await invalid.emit(draft, credentials)).toMatchObject({ status: 'error' });
    expect((await ok.emit(draft, null)).status).toBe('error');
  });
});
