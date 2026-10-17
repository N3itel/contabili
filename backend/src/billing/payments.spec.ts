import {
  CulqiPaymentProvider,
  FakePaymentProvider,
  chargeIdFromWebhook,
  cleanMessage,
} from './payments.js';

const input = {
  orderId: '6d1f9a3e-1b2c-4d5e-8f90-123456789abc',
  amountCents: 2000,
  email: 'jorge@example.com',
  tokenId: 'tkn_test_abc',
  description: 'Licencia Contabili: Negocio, 1 mes',
};

function culqi(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  const provider = new CulqiPaymentProvider(
    { publicKey: 'pk_test_1', secretKey: 'sk_test_2' },
    fetchFn,
  );
  return { provider, calls };
}

describe('Culqi', () => {
  it('cobra en soles con el token, la llave secreta y la orden en los metadatos', async () => {
    const { provider, calls } = culqi(201, {
      object: 'charge',
      id: 'chr_test_123',
      amount: 2000,
      currency_code: 'PEN',
    });
    expect(await provider.charge({ ...input, deviceId: 'dev-1' })).toEqual({
      kind: 'paid',
      chargeId: 'chr_test_123',
    });
    expect(calls[0].url).toBe('https://api.culqi.com/v2/charges');
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer sk_test_2' });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      amount: 2000,
      currency_code: 'PEN',
      email: 'jorge@example.com',
      source_id: 'tkn_test_abc',
      capture: true,
      description: 'Licencia Contabili: Negocio, 1 mes',
      metadata: { order_id: input.orderId },
      antifraud_details: { device_finger_print_id: 'dev-1' },
    });
  });

  it('si el monto cobrado no coincide, no lo da por pagado', async () => {
    const { provider } = culqi(201, {
      object: 'charge',
      id: 'chr_test_1',
      amount: 1,
      currency_code: 'PEN',
    });
    expect(await provider.charge(input)).toEqual({ kind: 'unknown' });
  });

  it('pide 3DS cuando Culqi responde REVIEW y lo envía al reintentar', async () => {
    const { provider, calls } = culqi(200, { action_code: 'REVIEW', user_message: '...' });
    expect(await provider.charge(input)).toEqual({ kind: 'needs_3ds' });
    await provider.charge({ ...input, authentication3DS: { eci: '05', cavv: 'abc' } });
    expect(JSON.parse(String(calls[1].init.body)).authentication_3DS).toEqual({
      eci: '05',
      cavv: 'abc',
    });
  });

  it('un rechazo trae el mensaje para la persona, limpio', async () => {
    const { provider } = culqi(402, {
      object: 'error',
      type: 'card_error',
      code: 'card_declined',
      decline_code: 'insufficient_funds',
      user_message: 'Tu tarjeta no tiene fondos <b>suficientes</b>.\n',
    });
    expect(await provider.charge(input)).toEqual({
      kind: 'declined',
      code: 'insufficient_funds',
      message: 'Tu tarjeta no tiene fondos suficientes .',
    });
  });

  it('sin respuesta clara el cobro queda por confirmar; una llave mala es un error', async () => {
    expect(await culqi(502, 'Bad gateway').provider.charge(input)).toEqual({ kind: 'unknown' });
    const failing = new CulqiPaymentProvider(
      { publicKey: 'pk_test_1', secretKey: 'sk_test_2' },
      (async () => {
        throw new Error('ECONNRESET');
      }) as unknown as typeof fetch,
    );
    expect(await failing.charge(input)).toEqual({ kind: 'unknown' });
    await expect(culqi(401, { object: 'error' }).provider.charge(input)).rejects.toThrow(
      /llave secreta/,
    );
  });

  it('consulta un cargo y lee la orden de sus metadatos', async () => {
    const { provider, calls } = culqi(200, {
      object: 'charge',
      id: 'chr_live_9',
      amount: 5000,
      currency_code: 'PEN',
      outcome: { type: 'venta_exitosa' },
      metadata: { order_id: input.orderId },
    });
    expect(await provider.getCharge('chr_live_9')).toEqual({
      chargeId: 'chr_live_9',
      amountCents: 5000,
      currency: 'PEN',
      paid: true,
      refundedCents: 0,
      orderId: input.orderId,
    });
    expect(calls[0].url).toBe('https://api.culqi.com/v2/charges/chr_live_9');
    // Un id con otra forma ni siquiera se consulta.
    expect(await provider.getCharge('chr_live_9/../../refunds')).toBeNull();
    expect(calls).toHaveLength(1);
  });
});

describe('webhook de Culqi', () => {
  it('extrae el cargo de eventos de cargos, con data como objeto o como texto', () => {
    expect(
      chargeIdFromWebhook({ type: 'charge.creation.succeeded', data: { id: 'chr_live_1' } }),
    ).toBe('chr_live_1');
    expect(
      chargeIdFromWebhook({
        type: 'charge.creation.succeeded',
        data: JSON.stringify({ id: 'chr_test_2', object: 'charge' }),
      }),
    ).toBe('chr_test_2');
    expect(chargeIdFromWebhook({ type: 'order.status.changed', data: { id: 'ord_1' } })).toBeNull();
    expect(
      chargeIdFromWebhook({ type: 'charge.creation.succeeded', data: { id: 'x' } }),
    ).toBeNull();
    expect(chargeIdFromWebhook({ type: 'charge.creation.succeeded', data: '{' })).toBeNull();
    expect(chargeIdFromWebhook(null)).toBeNull();
  });
});

describe('modo de prueba', () => {
  it('paga, rechaza, pide 3DS o se queda sin respuesta según el token', async () => {
    const fake = new FakePaymentProvider();
    const paid = await fake.charge({ ...input, tokenId: 'fake_ok' });
    expect(paid.kind).toBe('paid');
    expect((await fake.charge({ ...input, tokenId: 'fake_declined' })).kind).toBe('declined');
    expect((await fake.charge({ ...input, tokenId: 'fake_3ds' })).kind).toBe('needs_3ds');
    expect(
      (await fake.charge({ ...input, tokenId: 'fake_3ds', authentication3DS: { eci: '05' } })).kind,
    ).toBe('paid');
    expect((await fake.charge({ ...input, tokenId: 'fake_timeout' })).kind).toBe('unknown');
    expect(fake.chargeFor(input.orderId)).toMatchObject({ paid: true, amountCents: 2000 });
  });
});

it('limpia los mensajes del proveedor', () => {
  expect(cleanMessage(undefined, 'x')).toBe('x');
  expect(cleanMessage('  ', 'x')).toBe('x');
  expect(cleanMessage('a'.repeat(300), 'x')).toHaveLength(200);
});
