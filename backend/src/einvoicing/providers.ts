import type { Cents } from '../accounting/money.js';
import type {
  CreditReason,
  CustomerDocType,
  EinvoiceDocType,
  EinvoiceType,
} from './einvoice-rules.js';

/**
 * Proveedores de facturación electrónica. En beta: Nubefact (cada empresa
 * conecta su propia cuenta con su ruta y su token) y el modo de prueba, que
 * no manda nada a SUNAT. Nunca se registra el cuerpo de las respuestas.
 */

export type ProviderCode = 'test' | 'nubefact';

export interface EinvoiceDraft {
  type: EinvoiceDocType;
  series: string;
  number: number;
  /** 'AAAA-MM-DD', fecha de Lima. */
  issueDate: string;
  customer: { docType: CustomerDocType; number?: string; name?: string };
  description: string;
  kind: 'goods' | 'services';
  base: Cents;
  igv: Cents;
  total: Cents;
  /** Nota de crédito: el comprobante que anula y el motivo (catálogo 09). */
  note?: { type: EinvoiceType; series: string; number: number; reason: CreditReason };
}

export interface Credentials {
  endpoint: string;
  token: string;
}

/**
 * - `accepted`: SUNAT lo aceptó.
 * - `rejected`: SUNAT lo rechazó (el número ya se usó).
 * - `pending`: el proveedor lo tiene pero SUNAT no respondió, o no se sabe si
 *   llegó (se vuelve a consultar; el número no se reusa).
 * - `error`: el proveedor no lo creó (datos o cuenta): el número se libera.
 * - `test`: modo de prueba, no se envió.
 */
export type EmitStatus = 'accepted' | 'rejected' | 'pending' | 'error' | 'test';

export interface EmitResult {
  status: EmitStatus;
  message: string;
  pdfUrl?: string;
  xmlUrl?: string;
  cdrUrl?: string;
  hash?: string;
}

export interface EinvoiceProvider {
  emit(draft: EinvoiceDraft, credentials: Credentials | null): Promise<EmitResult>;
  /** Vuelve a preguntar por un comprobante pendiente. */
  check(draft: EinvoiceDraft, credentials: Credentials | null): Promise<EmitResult>;
}

/** Solo rutas de Nubefact por HTTPS: el servidor no llama a direcciones que alguien invente. */
export function isAllowedEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      (url.hostname === 'api.nubefact.com' ||
        url.hostname.endsWith('.nubefact.com') ||
        url.hostname === 'api.pse.pe')
    );
  } catch {
    return false;
  }
}

const decimal = (cents: Cents) => (cents / 100).toFixed(2);

/** Tipo de comprobante en Nubefact: 1 factura, 2 boleta, 3 nota de crédito. */
const NUBEFACT_TYPE: Readonly<Record<EinvoiceDocType, number>> = { '01': 1, '03': 2, '07': 3 };

/** El comprobante en el formato JSON de Nubefact («generar_comprobante»). */
export function nubefactPayload(d: EinvoiceDraft): Record<string, unknown> {
  const { docType, number, name } = d.customer;
  return {
    operacion: 'generar_comprobante',
    tipo_de_comprobante: NUBEFACT_TYPE[d.type],
    serie: d.series,
    numero: d.number,
    sunat_transaction: 1,
    cliente_tipo_de_documento: docType === 'ruc' ? 6 : docType === 'dni' ? 1 : '-',
    cliente_numero_de_documento: docType === 'none' ? '-' : number,
    cliente_denominacion: docType === 'none' ? 'CLIENTES VARIOS' : name,
    cliente_direccion: '',
    cliente_email: '',
    fecha_de_emision: d.issueDate,
    moneda: 1,
    porcentaje_de_igv: '18.00',
    total_descuento: '0.00',
    total_gravada: decimal(d.base),
    total_exonerada: '0.00',
    total_inafecta: '0.00',
    total_igv: decimal(d.igv),
    total: decimal(d.total),
    enviar_automaticamente_a_la_sunat: true,
    enviar_automaticamente_al_cliente: false,
    ...(d.note && {
      documento_que_se_modifica_tipo: NUBEFACT_TYPE[d.note.type],
      documento_que_se_modifica_serie: d.note.series,
      documento_que_se_modifica_numero: d.note.number,
      tipo_de_nota_de_credito: Number(d.note.reason),
    }),
    items: [
      {
        unidad_de_medida: d.kind === 'goods' ? 'NIU' : 'ZZ',
        codigo: '001',
        descripcion: d.description,
        cantidad: 1,
        valor_unitario: decimal(d.base),
        precio_unitario: decimal(d.total),
        descuento: '0.00',
        subtotal: decimal(d.base),
        tipo_de_igv: 1,
        igv: decimal(d.igv),
        total: decimal(d.total),
      },
    ],
  };
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** Lee la respuesta de Nubefact sin guardar el resto del cuerpo. */
export function parseNubefactResponse(body: unknown): EmitResult {
  const r = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (r.errors) {
    return {
      status: 'error',
      message: `Tu proveedor de facturación no lo aceptó: ${text(r.errors) ?? 'revisa los datos'}.`,
    };
  }
  const links = {
    pdfUrl: text(r.enlace_del_pdf),
    xmlUrl: text(r.enlace_del_xml),
    cdrUrl: text(r.enlace_del_cdr),
    hash: text(r.codigo_hash),
  };
  const sunat = text(r.sunat_description) ?? text(r.sunat_note);
  if (r.aceptada_por_sunat === true) {
    return { status: 'accepted', message: sunat ?? 'SUNAT lo aceptó.', ...links };
  }
  const code = text(String(r.sunat_responsecode ?? ''));
  if (code && code !== '0') {
    return { status: 'rejected', message: sunat ?? 'SUNAT lo rechazó.', ...links };
  }
  return { status: 'pending', message: 'Esperando la respuesta de SUNAT.', ...links };
}

export class NubefactProvider implements EinvoiceProvider {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  emit(draft: EinvoiceDraft, credentials: Credentials | null): Promise<EmitResult> {
    return this.call(nubefactPayload(draft), credentials);
  }

  check(draft: EinvoiceDraft, credentials: Credentials | null): Promise<EmitResult> {
    return this.call(
      {
        operacion: 'consultar_comprobante',
        tipo_de_comprobante: NUBEFACT_TYPE[draft.type],
        serie: draft.series,
        numero: draft.number,
      },
      credentials,
    );
  }

  private async call(
    payload: Record<string, unknown>,
    credentials: Credentials | null,
  ): Promise<EmitResult> {
    if (!credentials || !isAllowedEndpoint(credentials.endpoint)) {
      return { status: 'error', message: 'Falta conectar tu cuenta de Nubefact (ruta y token).' };
    }
    let response: Response;
    try {
      response = await this.fetchImpl(credentials.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Token token=${credentials.token}`,
        },
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      // Pudo haber llegado: no se reusa el número; se vuelve a consultar.
      return {
        status: 'pending',
        message: 'No supimos si llegó a tu proveedor. Vuelve a consultar en un momento.',
      };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        status: 'error',
        message: 'Nubefact no aceptó tu token. Revísalo en la configuración.',
      };
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok && !(body && typeof body === 'object' && 'errors' in body)) {
      return response.status >= 500
        ? {
            status: 'pending',
            message: 'Tu proveedor no respondió bien. Vuelve a consultar en un momento.',
          }
        : {
            status: 'error',
            message: 'Tu proveedor de facturación no lo aceptó. Revisa los datos.',
          };
    }
    return parseNubefactResponse(body);
  }
}

/** Modo de prueba: no sale nada; sirve para ver cómo queda antes de conectar un proveedor. */
export class TestProvider implements EinvoiceProvider {
  async emit(): Promise<EmitResult> {
    return { status: 'test', message: 'Comprobante de prueba: no se envió a SUNAT.' };
  }

  async check(): Promise<EmitResult> {
    return this.emit();
  }
}
