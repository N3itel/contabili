import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, inArray, lt, lte, max, sql } from 'drizzle-orm';
import type { Tx } from '../accounting/journal.service.js';
import { limaDate } from '../accounting/lima.js';
import { apiError } from '../common/http.js';
import type { Env } from '../config/env.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { companies, licenseOrders, licenseReceipts } from '../db/schema/index.js';
import { einvoiceAmounts, einvoiceNumberLabel } from '../einvoicing/einvoice-rules.js';
import type {
  Credentials,
  EinvoiceDraft,
  EinvoiceProvider,
  EmitResult,
  ProviderCode,
} from '../einvoicing/providers.js';
import type { BillingCycle, PlanCode } from './plans.js';
import { MAX_RECEIPT_ATTEMPTS, receiptDescription } from './receipt-rules.js';

export const RECEIPT_PROVIDER = Symbol('RECEIPT_PROVIDER');

type ReceiptRow = typeof licenseReceipts.$inferSelect;
type OrderRow = typeof licenseOrders.$inferSelect;

/** Lo que ve la empresa de cada comprobante en Mi plan. */
export interface ReceiptView {
  id: string;
  /** «F001-00000012», o null mientras espera turno. */
  label: string | null;
  status: ReceiptRow['status'];
}

/** Comprobantes por pasada del barrido (los demás quedan para la siguiente). */
const SWEEP_BATCH = 20;

/**
 * Comprobantes de los pagos de licencia. Se encolan en la transacción que
 * marca la orden pagada y se emiten aparte: el número correlativo se reserva
 * bajo un bloqueo al mandarlo y, si el proveedor no lo creó, se libera y se
 * reintenta en el barrido. Nunca se registra el cuerpo de las respuestas.
 */
@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger('Comprobantes');
  private readonly providerCode: ProviderCode;
  private readonly credentials: Credentials | null;
  private readonly series: string;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(RECEIPT_PROVIDER) private readonly provider: EinvoiceProvider,
    @Inject(ConfigService) config: ConfigService<Env, true>,
  ) {
    this.providerCode = config.get('RECEIPTS_PROVIDER', { infer: true });
    const endpoint = config.get('RECEIPTS_NUBEFACT_URL', { infer: true });
    const token = config.get('RECEIPTS_NUBEFACT_TOKEN', { infer: true });
    this.credentials = endpoint && token ? { endpoint, token } : null;
    this.series = config.get('RECEIPTS_SERIES', { infer: true });
  }

  /** Encola el comprobante de una orden recién pagada, dentro de esa transacción. */
  async queue(tx: Tx, order: OrderRow): Promise<void> {
    const [company] = await tx
      .select({ ruc: companies.ruc, legalName: companies.legalName })
      .from(companies)
      .where(eq(companies.id, order.companyId));
    // Los precios de Contabili incluyen IGV.
    const amounts = einvoiceAmounts(order.amountCents, 'general');
    await tx
      .insert(licenseReceipts)
      .values({
        orderId: order.id,
        companyId: order.companyId,
        provider: this.providerCode,
        customerRuc: company.ruc,
        customerName: company.legalName,
        description: receiptDescription(
          order.plan as PlanCode,
          order.cycle as BillingCycle,
          order.periodStart as Date,
          order.periodEnd as Date,
        ),
        baseCents: amounts.base,
        igvCents: amounts.igv,
        totalCents: amounts.total,
      })
      .onConflictDoNothing();
  }

  /** Emite el comprobante de una orden, si está en cola (justo después del pago). */
  async issueFor(orderId: string, now = new Date()): Promise<void> {
    const [row] = await this.db
      .select({ id: licenseReceipts.id })
      .from(licenseReceipts)
      .where(and(eq(licenseReceipts.orderId, orderId), eq(licenseReceipts.status, 'queued')));
    if (row) await this.issue(row.id, now);
  }

  /** Emite lo que quedó en cola y consulta lo pendiente. Devuelve cuántos revisó. */
  async sweep(now = new Date()): Promise<number> {
    const queued = await this.db
      .select({ id: licenseReceipts.id })
      .from(licenseReceipts)
      .where(
        and(
          eq(licenseReceipts.status, 'queued'),
          lt(licenseReceipts.attempts, MAX_RECEIPT_ATTEMPTS),
        ),
      )
      .orderBy(asc(licenseReceipts.createdAt))
      .limit(SWEEP_BATCH);
    for (const { id } of queued) await this.issue(id, now);
    // Lo enviado sin respuesta, pasado un minuto.
    const pending = await this.db
      .select()
      .from(licenseReceipts)
      .where(
        and(
          eq(licenseReceipts.status, 'pending'),
          lte(licenseReceipts.updatedAt, new Date(now.getTime() - 60_000)),
        ),
      )
      .orderBy(asc(licenseReceipts.updatedAt))
      .limit(SWEEP_BATCH);
    for (const row of pending) {
      const result = await this.provider.check(this.draft(row), this.credentials);
      if (result.status !== 'error') await this.apply(row, result);
      else await this.touch(row.id);
    }
    return queued.length + pending.length;
  }

  /** Los comprobantes de las órdenes de una empresa, por orden. */
  async forOrders(companyId: string, orderIds: string[]): Promise<Map<string, ReceiptView>> {
    if (orderIds.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(licenseReceipts)
      .where(
        and(eq(licenseReceipts.companyId, companyId), inArray(licenseReceipts.orderId, orderIds)),
      );
    return new Map(rows.map((r) => [r.orderId, this.view(r)]));
  }

  /** El comprobante de la empresa, listo para ver (con su PDF o el de prueba). */
  async ready(companyId: string, receiptId: string): Promise<ReceiptRow> {
    const [row] = await this.db
      .select()
      .from(licenseReceipts)
      .where(and(eq(licenseReceipts.id, receiptId), eq(licenseReceipts.companyId, companyId)));
    if (!row) {
      throw apiError(HttpStatus.NOT_FOUND, 'receipt_not_found', 'No encontramos ese comprobante.');
    }
    if (row.status !== 'accepted' && row.status !== 'test') {
      throw apiError(
        HttpStatus.CONFLICT,
        'receipt_not_ready',
        'Tu comprobante todavía se está emitiendo. Vuelve a intentarlo en unos minutos.',
      );
    }
    return row;
  }

  // ─── Interno ─────────────────────────────────────────────────────────────

  private view(row: ReceiptRow): ReceiptView {
    return {
      id: row.id,
      label: row.series && row.number ? einvoiceNumberLabel(row.series, row.number) : null,
      status: row.status,
    };
  }

  /** Reserva el número (bajo bloqueo), lo manda y guarda lo que respondió. */
  private async issue(id: string, now: Date): Promise<void> {
    const claimed = await this.db.transaction(async (tx) => {
      // Un solo correlativo para todas las instancias.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('license_receipts'))`);
      const [last] = await tx
        .select({ number: max(licenseReceipts.number) })
        .from(licenseReceipts)
        .where(eq(licenseReceipts.series, this.series));
      const [row] = await tx
        .update(licenseReceipts)
        .set({
          status: 'pending',
          provider: this.providerCode,
          series: this.series,
          number: (last?.number ?? 0) + 1,
          issueDate: limaDate(now),
        })
        .where(and(eq(licenseReceipts.id, id), eq(licenseReceipts.status, 'queued')))
        .returning();
      return row;
    });
    if (!claimed) return;
    const result = await this.provider.emit(this.draft(claimed), this.credentials);
    if (result.status === 'error') {
      // El proveedor no lo creó: el número queda libre y se reintenta.
      await this.db
        .update(licenseReceipts)
        .set({
          status: 'queued',
          series: null,
          number: null,
          issueDate: null,
          attempts: sql`${licenseReceipts.attempts} + 1`,
          statusMessage: result.message.slice(0, 500),
        })
        .where(eq(licenseReceipts.id, claimed.id));
      this.logger.warn(`El proveedor no creó un comprobante de licencia (${claimed.id})`);
      return;
    }
    await this.apply(claimed, result);
  }

  private async apply(row: ReceiptRow, result: EmitResult): Promise<void> {
    await this.db
      .update(licenseReceipts)
      .set({
        status: result.status as ReceiptRow['status'],
        statusMessage: result.message.slice(0, 500),
        pdfUrl: result.pdfUrl ?? row.pdfUrl,
        hash: result.hash ?? row.hash,
      })
      .where(eq(licenseReceipts.id, row.id));
    if (result.status === 'rejected') {
      this.logger.warn(`SUNAT rechazó un comprobante de licencia (${row.id})`);
    }
  }

  /** Para no consultar lo mismo en cada pasada. */
  private async touch(id: string): Promise<void> {
    await this.db
      .update(licenseReceipts)
      .set({ updatedAt: new Date() })
      .where(eq(licenseReceipts.id, id));
  }

  private draft(row: ReceiptRow): EinvoiceDraft {
    return {
      type: '01',
      series: row.series as string,
      number: row.number as number,
      issueDate: row.issueDate as string,
      customer: { docType: 'ruc', number: row.customerRuc, name: row.customerName },
      description: row.description,
      kind: 'services',
      base: row.baseCents,
      igv: row.igvCents,
      total: row.totalCents,
    };
  }
}
