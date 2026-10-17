import { MemorySmsSender, TwilioSmsSender } from './sms.js';

describe('SMS en memoria', () => {
  it('devuelve el último código enviado a cada número', async () => {
    const sms = new MemorySmsSender();
    await sms.send('+51900000001', 'Contabili: tu código es 111111.');
    await sms.send('+51900000002', 'Contabili: tu código es 222222.');
    await sms.send('+51900000001', 'Contabili: tu código es 333333.');
    expect(sms.lastCodeFor('+51900000001')).toBe('333333');
    expect(sms.lastCodeFor('+51900000003')).toBeUndefined();
  });
});

describe('SMS por Twilio', () => {
  const config = { accountSid: 'AC123', authToken: 'secreto', from: '+15550001111' };

  it('envía el formulario con autenticación básica', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 201 }));
    await new TwilioSmsSender(config, fetchFn as unknown as typeof fetch).send(
      '+51987654321',
      'hola',
    );

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('AC123:secreto').toString('base64')}`,
    );
    const body = init.body as URLSearchParams;
    expect(body.get('To')).toBe('+51987654321');
    expect(body.get('From')).toBe('+15550001111');
    expect(body.get('Body')).toBe('hola');
  });

  it('usa el Messaging Service cuando el remitente empieza con MG', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 201 }));
    await new TwilioSmsSender(
      { ...config, from: 'MG999' },
      fetchFn as unknown as typeof fetch,
    ).send('+51987654321', 'hola');
    const body = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1]
      .body as URLSearchParams;
    expect(body.get('MessagingServiceSid')).toBe('MG999');
    expect(body.get('From')).toBeNull();
  });

  it('falla sin exponer el número en el error', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 21211, message: 'Invalid To +51987654321' }), {
          status: 400,
        }),
    );
    const send = new TwilioSmsSender(config, fetchFn as unknown as typeof fetch).send(
      '+51987654321',
      'hola',
    );
    await expect(send).rejects.toThrow('Twilio respondió 400 (código 21211)');
    await expect(send).rejects.not.toThrow(/987654321/);
  });
});
