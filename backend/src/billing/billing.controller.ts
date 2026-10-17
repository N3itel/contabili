import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { type AuthContext, CurrentAuth, Public } from '../auth/auth.guard.js';
import { uuidParam, ZodPipe } from '../common/http.js';
import { BillingService } from './billing.service.js';
import { CHECKOUT_PAGE_CSP, CHECKOUT_PAGE_HTML } from './checkout-page.js';

const orderBody = z.object({
  plan: z.enum(['emprendedor', 'negocio']),
  cycle: z.enum(['monthly', 'annual']),
});

/** Código de la página de pago: HMAC-SHA256 en base64url (43 caracteres). */
const checkoutToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

const sessionBody = z.object({ token: checkoutToken }).strict();

const chargeBody = z
  .object({
    token: checkoutToken,
    /** Token de Culqi (tarjeta o Yape) o de prueba. */
    tokenId: z.string().regex(/^[a-z]{2,6}_[A-Za-z0-9_]{2,100}$/),
    email: z.email().max(120),
    deviceId: z.string().max(120).nullish(),
    authentication3DS: z
      .object({
        eci: z.string().max(10).optional(),
        xid: z.string().max(200).optional(),
        cavv: z.string().max(200).optional(),
        protocolVersion: z.string().max(20).optional(),
        directoryServerTransactionId: z.string().max(200).optional(),
      })
      .strict()
      .nullish(),
  })
  .strict();

/** Del webhook de Culqi solo se lee el tipo de evento y el id del cargo (que luego se consulta). */
const webhookBody = z.looseObject({
  type: z.string().max(100).optional(),
  data: z
    .union([z.string().max(100_000), z.looseObject({ id: z.string().max(100).optional() })])
    .optional(),
});

/** El plan de una empresa, desde la app o desde Mi plan. */
@Controller('companies/:companyId/billing')
export class BillingController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @Get()
  status(@CurrentAuth() auth: AuthContext, @Param('companyId', uuidParam()) companyId: string) {
    return this.billing.status(companyId, auth.userId);
  }

  @Post('orders')
  createOrder(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Body(new ZodPipe(orderBody)) body: z.infer<typeof orderBody>,
  ) {
    return this.billing.createOrder(companyId, auth.userId, body.plan, body.cycle);
  }

  @Get('orders/:orderId')
  getOrder(
    @CurrentAuth() auth: AuthContext,
    @Param('companyId', uuidParam()) companyId: string,
    @Param('orderId', uuidParam()) orderId: string,
  ) {
    return this.billing.getOrder(companyId, auth.userId, orderId);
  }
}

/** Cobro de la página de pago. Públicas: las protege el código de la orden (HMAC). */
@Public()
@Controller('payments')
export class PaymentsController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @Post('orders/:id/session')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  session(
    @Param('id', uuidParam()) id: string,
    @Body(new ZodPipe(sessionBody)) body: z.infer<typeof sessionBody>,
  ) {
    return this.billing.session(id, body.token);
  }

  @Post('orders/:id/charge')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  charge(
    @Param('id', uuidParam()) id: string,
    @Body(new ZodPipe(chargeBody)) body: z.infer<typeof chargeBody>,
  ) {
    const { token, authentication3DS, ...input } = body;
    return this.billing.charge(id, token, {
      ...input,
      authentication3DS: authentication3DS
        ? (Object.fromEntries(
            Object.entries(authentication3DS).filter(([, v]) => v !== undefined),
          ) as Record<string, string>)
        : null,
    });
  }

  /** Webhook de Culqi: el secreto va en la dirección configurada en CulqiPanel. */
  @Post('culqi/webhook/:secret')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Param('secret') secret: string,
    @Body(new ZodPipe(webhookBody)) body: z.infer<typeof webhookBody>,
  ) {
    await this.billing.webhook(secret, body);
    return { received: true };
  }
}

/** La página fija del pago (fuera del prefijo /api/v1). */
@Public()
@Controller('pagar')
export class CheckoutPageController {
  @Get(':id')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Content-Security-Policy', CHECKOUT_PAGE_CSP)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  @Header('X-Content-Type-Options', 'nosniff')
  page() {
    return CHECKOUT_PAGE_HTML;
  }
}
