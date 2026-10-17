import { Logger } from '@nestjs/common';
import { maskPhone } from './phone.js';

export const SMS_SENDER = Symbol('SMS_SENDER');

/** Envía un SMS. Las implementaciones nunca registran el número completo. */
export interface SmsSender {
  send(to: string, text: string): Promise<void>;
}

/** Desarrollo: escribe el mensaje en el log para poder copiar el código. */
export class ConsoleSmsSender implements SmsSender {
  private readonly logger = new Logger('SMS');

  async send(to: string, text: string): Promise<void> {
    this.logger.log(`Para ${maskPhone(to)}: ${text}`);
  }
}

/** Pruebas: guarda los mensajes en memoria. */
export class MemorySmsSender implements SmsSender {
  readonly messages: { to: string; text: string }[] = [];

  async send(to: string, text: string): Promise<void> {
    this.messages.push({ to, text });
  }

  /** Último código de 6 dígitos enviado a ese número. */
  lastCodeFor(phone: string): string | undefined {
    const last = this.messages.findLast((m) => m.to === phone);
    return last?.text.match(/\b(\d{6})\b/)?.[1];
  }
}

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** Número remitente (+1…) o Messaging Service SID (MG…). */
  from: string;
}

/** Producción: API de mensajes de Twilio, sin SDK. */
export class TwilioSmsSender implements SmsSender {
  constructor(
    private readonly config: TwilioConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(to: string, text: string): Promise<void> {
    const { accountSid, authToken, from } = this.config;
    const body = new URLSearchParams({ To: to, Body: text });
    body.set(from.startsWith('MG') ? 'MessagingServiceSid' : 'From', from);

    const res = await this.fetchFn(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) {
      // El cuerpo de Twilio trae el número; solo se registra el código de error.
      let code: unknown;
      try {
        code = ((await res.json()) as { code?: unknown }).code;
      } catch {
        code = undefined;
      }
      throw new Error(`Twilio respondió ${res.status} (código ${String(code ?? 'desconocido')})`);
    }
  }
}
