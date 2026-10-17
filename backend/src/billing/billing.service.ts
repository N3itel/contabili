import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, count, desc, eq, gt, lte, ne, sql } from 'drizzle-orm';
import { formatDate, limaDate } from '../accounting/lima.js';
import { deriveKey } from '../auth/tokens.js';
import { audit } from '../common/audit.js';
import { apiError } from '../common/http.js';
import { CompanyAccess, memberRoom } from '../companies/company-access.js';
import type { Env } from '../config/env.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { companies, companyLicenses, licenseOrders } from '../db/schema/index.js';
import {
  type ChargeInput,
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type VerifiedCharge,
  chargeIdFromWebhook,
} from './payments.js';
import {
  type BillingCycle,
  extendLicense,
  type LicenseRow,
  licenseState,
  orderProblem,
  PLAN_CODES,
  PLANS,
  type PlanCode,
  priceFor,
} from './plans.js';

type OrderRow = typeof licenseOrders.$inferSelect;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Una orden sin pagar vence a los 30 minutos. */
export const ORDER_TTL_MINUTES = 30;
/** Intentos de cobro por orden (frena las pruebas de tarjetas robadas). */
export const MAX_ORDER_ATTEMPTS = 4;
/** Órdenes por empresa en 24 horas. */
export const MAX_ORDERS_PER_DAY = 10;

/** Lo que responde la página de pago al cobrar. */
export type ChargeResult =
  | { status: 'paid'; amountCents: number; paidThrough: string }
  | { status: 'needs_3ds' }
  | { status: 'declined'; message: string; attemptsLeft: number }
  | { status: 'failed'; message: string }
  | { status: 'charging'; message: string };

const orderNotFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'order_not_found', 'No encontramos esa orden de pago.');

const PENDING_MESSAGE =
  'Estamos confirmando el pago con tu banco. Revisa tu plan en la app en unos minutos.';

const cycleLabel = (cycle: BillingCycle) => (cycle === 'monthly' ? '1 mes' : '1 año');

function toLicenseRow(row: typeof companyLicenses.$inferSelect): LicenseRow {
  return { plan: row.plan as PlanCode, trialEndsAt: row.trialEndsAt, paidThrough: row.paidThrough };
}

/**
 * Licencias por empresa. El monto lo fija el servidor según el plan; la
 * página de pago (con el checkout de Culqi) solo entrega el token de la
 * tarjeta o de Yape. La licencia se extiende cuando el proveedor confirma el
 * cargo: en la respuesta del cobro o por el webhook (consultando el cargo a
 * Culqi, nunca creyendo el cuerpo). Una orden se abona una sola vez.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger('Licencias');
  private readonly checkoutKey: Buffer;
  private readonly publicUrl: string;
  private readonly webhookSecret: string | null;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(CompanyAccess) private readonly access: CompanyAccess,
    @Inject(ConfigService) config: ConfigService<Env, true>,
  ) {
    this.checkoutKey = deriveKey(config.get('AUTH_JWT_SECRET', { infer: true }), 'order-checkout');
    this.publicUrl = config.get('PUBLIC_WEB_URL', { infer: true });
    this.webhookSecret = config.get('CULQI_WEBHOOK_SECRET', { infer: true }) ?? null;
  }

  // ─── En la app ───────────────────────────────────────────────────────────

  /** Estado del plan de la empresa, los planes disponibles y los últimos pagos. */
  async status(companyId: string, actorId: string, now = new Date()) {
    await this.access.require(companyId, actorId, 'viewer');
    const license = await this.license(this.db, companyId);
    const state = licenseState(license, now);
    const room = await memberRoom(this.db, companyId, state.plan);
    const orders = await this.db
      .select()
      .from(licenseOrders)
      .where(eq(licenseOrders.companyId, companyId))
      .orderBy(desc(licenseOrders.createdAt))
      .limit(10);
    return {
      license: {
        ...state,
        endsAt: state.endsAt.toISOString(),
        planName: PLANS[state.plan].name,
        members: room.members,
        maxMembers: room.max,
      },
      plans: PLAN_CODES.map((code) => PLANS[code]),
      orders: orders.map((o) => this.view(o, now)),
    };
  }

  /** Crea una orden de pago (solo el dueño) y devuelve la dirección de la página de pago. */
  async createOrder(
    companyId: string,
    actorId: string,
    plan: PlanCode,
    cycle: BillingCycle,
    now = new Date(),
  ) {
    await this.access.require(companyId, actorId, 'owner');
    const row = await this.db.transaction(async (tx) => {
      // Una orden a la vez por empresa: los topes se cuentan sin carreras.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`order:${companyId}`}))`);
      const license = await this.license(tx, companyId);
      const { members } = await memberRoom(tx, companyId, plan);
      const problem = orderProblem({ license, plan, members, now });
      if (problem === 'plan_change_while_paid') {
        throw apiError(
          HttpStatus.CONFLICT,
          problem,
          `Tu plan ${PLANS[license.plan].name} está pagado hasta el ${formatDate(limaDate(license.paidThrough!))}. Podrás cambiar de plan cuando termine; mientras tanto puedes renovar el mismo.`,
        );
      }
      if (problem === 'plan_too_small') {
        throw apiError(
          HttpStatus.CONFLICT,
          problem,
          `El plan ${PLANS[plan].name} permite hasta ${PLANS[plan].maxMembers} personas y la empresa tiene ${members}.`,
        );
      }
      const [{ charging }] = await tx
        .select({ charging: count() })
        .from(licenseOrders)
        .where(and(eq(licenseOrders.companyId, companyId), eq(licenseOrders.status, 'charging')));
      if (charging > 0) {
        throw apiError(
          HttpStatus.CONFLICT,
          'order_in_progress',
          'Hay un pago confirmándose con el banco. Espera unos minutos antes de pagar de nuevo.',
        );
      }
      const [{ today }] = await tx
        .select({ today: count() })
        .from(licenseOrders)
        .where(
          and(
            eq(licenseOrders.companyId, companyId),
            gt(licenseOrders.createdAt, new Date(now.getTime() - 86_400_000)),
          ),
        );
      if (today >= MAX_ORDERS_PER_DAY) {
        throw apiError(
          HttpStatus.TOO_MANY_REQUESTS,
          'orders_daily_limit',
          'Hubo muchos intentos de pago hoy. Inténtalo mañana o escríbenos a soporte.',
        );
      }
      // La orden nueva reemplaza a las que quedaron sin pagar.
      await tx
        .update(licenseOrders)
        .set({ status: 'expired' })
        .where(and(eq(licenseOrders.companyId, companyId), eq(licenseOrders.status, 'pending')));
      const [created] = await tx
        .insert(licenseOrders)
        .values({
          companyId,
          plan,
          cycle,
          amountCents: priceFor(plan, cycle),
          provider: this.provider.name,
          expiresAt: new Date(now.getTime() + ORDER_TTL_MINUTES * 60_000),
          createdBy: actorId,
          createdAt: now,
        })
        .returning();
      await audit(tx, {
        actorId,
        action: 'order.created',
        entity: 'company',
        entityId: companyId,
        data: { orderId: created.id, plan, cycle, amountCents: created.amountCents },
      });
      return created;
    });
    return this.view(row, now);
  }

  async getOrder(companyId: string, actorId: string, orderId: string, now = new Date()) {
    await this.access.require(companyId, actorId, 'viewer');
    const [row] = await this.db
      .select()
      .from(licenseOrders)
      .where(and(eq(licenseOrders.id, orderId), eq(licenseOrders.companyId, companyId)));
    if (!row) throw orderNotFound();
    return this.view(row, now);
  }

  // ─── Página de pago (pública, con el código de la orden) ────────────────

  async session(orderId: string, token: string, now = new Date()) {
    const row = await this.byToken(orderId, token);
    const [company] = await this.db
      .select({ legalName: companies.legalName })
      .from(companies)
      .where(eq(companies.id, row.companyId));
    return {
      provider: this.provider.name,
      publicKey: this.provider.publicKey,
      amountCents: row.amountCents,
      planName: PLANS[row.plan as PlanCode].name,
      cycle: row.cycle,
      cycleLabel: cycleLabel(row.cycle as BillingCycle),
      companyName: company?.legalName ?? '',
      status: this.effectiveStatus(row, now),
      expiresAt: row.expiresAt.toISOString(),
      attemptsLeft: Math.max(0, MAX_ORDER_ATTEMPTS - row.attempts),
      paidThrough: row.periodEnd?.toISOString() ?? null,
      message: row.failureMessage,
    };
  }

  /** Cobra la orden con el token del checkout. Un solo cobro en curso a la vez. */
  async charge(
    orderId: string,
    token: string,
    input: Omit<ChargeInput, 'orderId' | 'amountCents' | 'description'>,
    now = new Date(),
  ): Promise<ChargeResult> {
    await this.byToken(orderId, token);
    const [claimed] = await this.db
      .update(licenseOrders)
      .set({
        status: 'charging',
        chargingSince: now,
        attempts: sql`${licenseOrders.attempts} + 1`,
      })
      .where(
        and(
          eq(licenseOrders.id, orderId),
          eq(licenseOrders.status, 'pending'),
          gt(licenseOrders.expiresAt, now),
          sql`${licenseOrders.attempts} < ${MAX_ORDER_ATTEMPTS}`,
        ),
      )
      .returning();
    if (!claimed) return this.notChargeable(orderId, now);

    let outcome;
    try {
      outcome = await this.provider.charge({
        ...input,
        orderId,
        amountCents: claimed.amountCents,
        description: `Licencia Contabili: ${PLANS[claimed.plan as PlanCode].name}, ${cycleLabel(claimed.cycle as BillingCycle)}`,
      });
    } catch (error) {
      // Error de configuración (llave): el cobro no se hizo, pero que lo vea una persona.
      this.logger.error(`No se pudo cobrar una licencia: ${(error as Error).message}`);
      return { status: 'charging', message: PENDING_MESSAGE };
    }

    switch (outcome.kind) {
      case 'paid': {
        const paid = await this.settle(claimed, outcome.chargeId, now);
        return {
          status: 'paid',
          amountCents: claimed.amountCents,
          paidThrough: (paid ?? now).toISOString(),
        };
      }
      case 'needs_3ds':
        // La verificación del banco es parte del mismo intento: no gasta otro.
        await this.release(orderId, {}, true);
        return { status: 'needs_3ds' };
      case 'declined': {
        const last = claimed.attempts >= MAX_ORDER_ATTEMPTS;
        await this.release(orderId, {
          status: last ? 'failed' : 'pending',
          failureCode: outcome.code,
          failureMessage: outcome.message,
        });
        return last
          ? { status: 'failed', message: outcome.message }
          : {
              status: 'declined',
              message: outcome.message,
              attemptsLeft: MAX_ORDER_ATTEMPTS - claimed.attempts,
            };
      }
      default:
        // Queda «cobrando»: lo confirma el webhook.
        return { status: 'charging', message: PENDING_MESSAGE };
    }
  }

  /**
   * Aviso de Culqi. No se cree el cuerpo: se consulta el cargo a Culqi y solo
   * se abona si está pagado, en soles, por el monto exacto de esa orden.
   */
  async webhook(secret: string, body: unknown, now = new Date()): Promise<void> {
    if (!this.webhookSecret || !safeEqual(secret, this.webhookSecret)) {
      throw apiError(HttpStatus.NOT_FOUND, 'not_found', 'No existe.');
    }
    const chargeId = chargeIdFromWebhook(body);
    if (!chargeId) return;
    const charge = await this.provider.getCharge(chargeId);
    if (!charge?.orderId || !/^[0-9a-f-]{36}$/.test(charge.orderId)) return;
    const [row] = await this.db
      .select()
      .from(licenseOrders)
      .where(eq(licenseOrders.id, charge.orderId));
    if (!row || !chargeCovers(charge, row)) {
      if (charge.paid) this.logger.warn(`Cargo de Culqi sin orden que abonar (${chargeId})`);
      return;
    }
    // Se cobró: la licencia se extiende aunque la orden hubiera vencido o fallado.
    await this.settle(row, chargeId, now);
  }

  /** Vence las órdenes que nadie pagó a tiempo. */
  async sweep(now = new Date()): Promise<number> {
    const expired = await this.db
      .update(licenseOrders)
      .set({ status: 'expired' })
      .where(and(eq(licenseOrders.status, 'pending'), lte(licenseOrders.expiresAt, now)))
      .returning({ id: licenseOrders.id });
    return expired.length;
  }

  // ─── Interno ─────────────────────────────────────────────────────────────

  /**
   * Marca la orden pagada y extiende la licencia en la misma transacción.
   * Devuelve hasta cuándo vale, o null si la orden ya estaba pagada.
   */
  private async settle(row: OrderRow, chargeId: string, now: Date): Promise<Date | null> {
    return this.db.transaction(async (tx) => {
      const [license] = await tx
        .select()
        .from(companyLicenses)
        .where(eq(companyLicenses.companyId, row.companyId))
        .for('update');
      const { periodStart, periodEnd } = extendLicense(
        toLicenseRow(license),
        row.cycle as BillingCycle,
        now,
      );
      const [paid] = await tx
        .update(licenseOrders)
        .set({
          status: 'paid',
          providerChargeId: chargeId,
          paidAt: now,
          periodStart,
          periodEnd,
          failureCode: null,
          failureMessage: null,
        })
        .where(and(eq(licenseOrders.id, row.id), ne(licenseOrders.status, 'paid')))
        .returning({ id: licenseOrders.id });
      if (!paid) return null;
      await tx
        .update(companyLicenses)
        .set({ plan: row.plan, paidThrough: periodEnd })
        .where(eq(companyLicenses.companyId, row.companyId));
      await audit(tx, {
        actorId: row.createdBy,
        action: 'license.paid',
        entity: 'company',
        entityId: row.companyId,
        data: {
          orderId: row.id,
          plan: row.plan,
          cycle: row.cycle,
          periodEnd: periodEnd.toISOString(),
        },
      });
      return periodEnd;
    });
  }

  private async release(
    orderId: string,
    patch: Partial<Pick<OrderRow, 'status' | 'failureCode' | 'failureMessage'>>,
    refundAttempt = false,
  ): Promise<void> {
    await this.db
      .update(licenseOrders)
      .set({
        status: 'pending',
        ...patch,
        ...(refundAttempt ? { attempts: sql`greatest(${licenseOrders.attempts} - 1, 0)` } : {}),
      })
      .where(and(eq(licenseOrders.id, orderId), eq(licenseOrders.status, 'charging')));
  }

  private async notChargeable(orderId: string, now: Date): Promise<ChargeResult> {
    const [row] = await this.db.select().from(licenseOrders).where(eq(licenseOrders.id, orderId));
    if (!row) throw orderNotFound();
    switch (this.effectiveStatus(row, now)) {
      case 'paid':
        return {
          status: 'paid',
          amountCents: row.amountCents,
          paidThrough: (row.periodEnd ?? now).toISOString(),
        };
      case 'charging':
        return { status: 'charging', message: PENDING_MESSAGE };
      case 'expired':
        return { status: 'failed', message: 'Esta orden venció. Crea otra desde Mi plan.' };
      default:
        return {
          status: 'failed',
          message:
            row.failureMessage ?? 'Esta orden ya no se puede pagar. Crea otra desde Mi plan.',
        };
    }
  }

  private async license(db: Pick<Database, 'select'> | Tx, companyId: string): Promise<LicenseRow> {
    const [row] = await db
      .select()
      .from(companyLicenses)
      .where(eq(companyLicenses.companyId, companyId));
    if (!row) throw new Error(`La empresa ${companyId} no tiene licencia`);
    return toLicenseRow(row);
  }

  private async byToken(orderId: string, token: string): Promise<OrderRow> {
    if (!safeEqual(token, this.tokenFor(orderId))) throw orderNotFound();
    const [row] = await this.db.select().from(licenseOrders).where(eq(licenseOrders.id, orderId));
    if (!row) throw orderNotFound();
    return row;
  }

  /** Código de la página de pago: HMAC de la orden (va en el fragmento, nunca en la URL pedida). */
  private tokenFor(orderId: string): string {
    return createHmac('sha256', this.checkoutKey).update(orderId).digest('base64url');
  }

  private effectiveStatus(row: OrderRow, now: Date): OrderRow['status'] {
    return row.status === 'pending' && row.expiresAt <= now ? 'expired' : row.status;
  }

  private view(row: OrderRow, now: Date) {
    const status = this.effectiveStatus(row, now);
    return {
      id: row.id,
      plan: row.plan,
      cycle: row.cycle,
      amountCents: row.amountCents,
      status,
      expiresAt: row.expiresAt.toISOString(),
      paidAt: row.paidAt?.toISOString() ?? null,
      periodEnd: row.periodEnd?.toISOString() ?? null,
      failureMessage: row.failureMessage,
      checkoutUrl:
        status === 'pending'
          ? `${this.publicUrl}/pagar/${row.id}#t=${this.tokenFor(row.id)}`
          : null,
    };
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** El cargo pagó exactamente esta orden: en soles, sin devoluciones y con sus metadatos. */
function chargeCovers(charge: VerifiedCharge | null, row: OrderRow): boolean {
  return (
    charge !== null &&
    charge.paid &&
    charge.currency === 'PEN' &&
    charge.refundedCents === 0 &&
    charge.amountCents === row.amountCents &&
    charge.orderId === row.id
  );
}
