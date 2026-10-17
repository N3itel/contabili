import { randomBytes } from 'node:crypto';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

/** Lo que llega de la página de pago para cobrar una orden de licencia. */
export interface ChargeInput {
  orderId: string;
  amountCents: number;
  /** Correo que pidió el checkout de Culqi (obligatorio para el cargo). */
  email: string;
  /** Token de un solo uso de la tarjeta o de Yape (Culqi: tkn_…). */
  tokenId: string;
  /** Huella del dispositivo para el antifraude (Culqi 3DS). */
  deviceId?: string | null;
  /** Resultado de la verificación 3DS, para el segundo intento. */
  authentication3DS?: Record<string, string> | null;
  /** Lo que ve la persona en su estado de cuenta. */
  description: string;
}

export type ChargeOutcome =
  | { kind: 'paid'; chargeId: string }
  /** El banco pide verificar al titular (3DS): se reintenta con `authentication3DS`. */
  | { kind: 'needs_3ds' }
  | { kind: 'declined'; code: string; message: string }
  /** No hubo respuesta clara (red, error del proveedor): el cobro pudo hacerse o no. */
  | { kind: 'unknown' };

/** Un cargo tal como lo informa el proveedor al consultarlo. */
export interface VerifiedCharge {
  chargeId: string;
  amountCents: number;
  currency: string;
  paid: boolean;
  /** Lo devuelto del cargo (en CulqiPanel). Con devoluciones no se abona. */
  refundedCents: number;
  /** La orden que figura en los metadatos del cargo. */
  orderId: string | null;
}

/** Cobra licencias. La verdad sobre un cargo siempre se consulta al proveedor. */
export interface PaymentProvider {
  readonly name: 'culqi' | 'fake';
  /** Llave pública para el checkout (null en el modo de prueba). */
  readonly publicKey: string | null;
  charge(input: ChargeInput): Promise<ChargeOutcome>;
  getCharge(chargeId: string): Promise<VerifiedCharge | null>;
}

/** Mensaje para la persona: una línea, sin marcas, como mucho 200 caracteres. */
export function cleanMessage(message: unknown, fallback: string): string {
  if (typeof message !== 'string') return fallback;
  const text = message
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 200) : fallback;
}

const DECLINED_FALLBACK = 'No se pudo hacer el cobro. Prueba con otra tarjeta o con Yape.';

/** Identificadores de cargo de Culqi. */
export const CULQI_CHARGE_ID = /^chr_(live|test)_[A-Za-z0-9]{1,48}$/;

/**
 * Desarrollo y pruebas. Tokens de prueba: `fake_ok` paga, `fake_declined` se
 * rechaza, `fake_3ds` pide verificación (y paga al reintentar con ella) y
 * `fake_timeout` cobra pero no responde (como una caída de red).
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake' as const;
  readonly publicKey = null;
  readonly charges = new Map<string, VerifiedCharge>();

  async charge(input: ChargeInput): Promise<ChargeOutcome> {
    switch (input.tokenId) {
      case 'fake_ok':
        return { kind: 'paid', chargeId: this.record(input) };
      case 'fake_3ds':
        return input.authentication3DS
          ? { kind: 'paid', chargeId: this.record(input) }
          : { kind: 'needs_3ds' };
      case 'fake_timeout':
        this.record(input);
        return { kind: 'unknown' };
      default:
        return {
          kind: 'declined',
          code: 'card_declined',
          message: 'Tu tarjeta fue rechazada (modo de prueba).',
        };
    }
  }

  async getCharge(chargeId: string): Promise<VerifiedCharge | null> {
    return this.charges.get(chargeId) ?? null;
  }

  /** Último cargo de prueba de una orden (para simular el webhook). */
  chargeFor(orderId: string): VerifiedCharge | undefined {
    return [...this.charges.values()].findLast((c) => c.orderId === orderId);
  }

  private record(input: ChargeInput): string {
    const chargeId = `chr_test_${randomBytes(8).toString('hex')}`;
    this.charges.set(chargeId, {
      chargeId,
      amountCents: input.amountCents,
      currency: 'PEN',
      paid: true,
      refundedCents: 0,
      orderId: input.orderId,
    });
    return chargeId;
  }
}

export interface CulqiConfig {
  publicKey: string;
  secretKey: string;
}

const CULQI_API = 'https://api.culqi.com/v2';

/**
 * Producción: API de cargos de Culqi, sin SDK. La tarjeta o Yape se tokenizan
 * en el checkout de Culqi (la página de pago); aquí solo llega el token.
 * Nunca se registra el cuerpo de las respuestas (traen el correo y la tarjeta).
 */
export class CulqiPaymentProvider implements PaymentProvider {
  readonly name = 'culqi' as const;
  readonly publicKey: string;

  constructor(
    private readonly config: CulqiConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.publicKey = config.publicKey;
  }

  async charge(input: ChargeInput): Promise<ChargeOutcome> {
    const body: Record<string, unknown> = {
      amount: input.amountCents,
      currency_code: 'PEN',
      email: input.email,
      source_id: input.tokenId,
      capture: true,
      description: input.description,
      metadata: { order_id: input.orderId },
    };
    if (input.deviceId) body.antifraud_details = { device_finger_print_id: input.deviceId };
    if (input.authentication3DS) body.authentication_3DS = input.authentication3DS;

    let res: Response;
    try {
      res = await this.fetchFn(`${CULQI_API}/charges`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      return { kind: 'unknown' };
    }
    const json = await readJson(res);
    if (res.ok && json?.object === 'charge' && typeof json.id === 'string') {
      // Se cobró exactamente lo pedido, en soles; si no, que lo revise una persona.
      if (json.amount !== input.amountCents || currencyOf(json) !== 'PEN') {
        return { kind: 'unknown' };
      }
      return { kind: 'paid', chargeId: json.id };
    }
    if (res.ok && json?.action_code === 'REVIEW') return { kind: 'needs_3ds' };
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Culqi rechazó la llave secreta (${res.status})`);
    }
    if (res.status >= 500 || res.status === 429 || !json) return { kind: 'unknown' };
    return {
      kind: 'declined',
      code: String(json.decline_code ?? json.code ?? json.type ?? 'declined').slice(0, 40),
      message: cleanMessage(json.user_message, DECLINED_FALLBACK),
    };
  }

  async getCharge(chargeId: string): Promise<VerifiedCharge | null> {
    if (!CULQI_CHARGE_ID.test(chargeId)) return null;
    const res = await this.fetchFn(`${CULQI_API}/charges/${chargeId}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`Culqi respondió ${res.status} al consultar un cargo`);
    const json = await readJson(res);
    if (json?.object !== 'charge' || json.id !== chargeId) return null;
    const outcome = json.outcome as { type?: unknown } | undefined;
    const metadata = json.metadata as Record<string, unknown> | undefined;
    return {
      chargeId,
      amountCents: typeof json.amount === 'number' ? json.amount : -1,
      currency: currencyOf(json),
      paid: json.paid === true || outcome?.type === 'venta_exitosa',
      refundedCents: typeof json.amount_refunded === 'number' ? json.amount_refunded : 0,
      orderId: typeof metadata?.order_id === 'string' ? metadata.order_id : null,
    };
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.config.secretKey}`,
      'Content-Type': 'application/json',
    };
  }
}

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const json = (await res.json()) as unknown;
    return json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function currencyOf(json: Record<string, unknown>): string {
  return String(json.currency_code ?? json.currency ?? '');
}

/**
 * Del cuerpo de un webhook de Culqi, el id del cargo (si el evento es de un
 * cargo). `data` llega como objeto o como texto JSON según la versión.
 */
export function chargeIdFromWebhook(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const event = body as { type?: unknown; data?: unknown };
  if (typeof event.type !== 'string' || !event.type.startsWith('charge.')) return null;
  let data = event.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data) as unknown;
    } catch {
      return null;
    }
  }
  const id = (data as { id?: unknown } | null)?.id;
  return typeof id === 'string' && CULQI_CHARGE_ID.test(id) ? id : null;
}
