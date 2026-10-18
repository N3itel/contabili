import { formatDate, limaDate } from '../accounting/lima.js';
import { type BillingCycle, PLANS, type PlanCode } from './plans.js';

/**
 * Comprobante de cada pago de licencia: una factura de quien vende
 * Contabili al RUC de la empresa (toda empresa en Contabili tiene RUC).
 */

/** Intentos en que el proveedor no lo creó; después espera a que alguien lo revise. */
export const MAX_RECEIPT_ATTEMPTS = 10;

/** Lo que dice el comprobante: plan, ciclo y el periodo que pagó. */
export function receiptDescription(
  plan: PlanCode,
  cycle: BillingCycle,
  periodStart: Date,
  periodEnd: Date,
): string {
  return `Licencia de Contabili, plan ${PLANS[plan].name} por ${cycle === 'monthly' ? '1 mes' : '1 año'}: del ${formatDate(limaDate(periodStart))} al ${formatDate(limaDate(periodEnd))}`;
}
