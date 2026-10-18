import type { Cents } from '../accounting/money.js';
import { type BillingCycle, PLANS, type PlanCode, priceFor } from './plans.js';

/**
 * Cuánto cuesta atender una empresa al mes, para que ningún precio quede en
 * pérdida. Supuestos conservadores (octubre de 2026, ver docs/precios.md);
 * al cambiar un precio o un proveedor, actualiza esto y la prueba lo revisa.
 */
export const COSTS = {
  /** El precio publicado incluye IGV: se lo queda SUNAT. */
  igvPercent: 18,
  /** Culqi: 3,44 % + US$ 0,20 por cargo, con mínimo de S/ 3,50 si el cargo es menor a S/ 87,72. */
  culqiPercent: 3.44,
  culqiFixedCents: 75,
  culqiMinimumCents: 350,
  /** Un SMS a Perú por Twilio (US$ 0,25 con cargos del operador). */
  smsCents: 95,
  /** Códigos por persona al mes: cada ingreso en un dispositivo y los reenvíos. */
  smsPerMemberPerMonth: 1,
  /** Avisos de vencimiento por ciclo (3 días antes y al vencer), a un dueño. */
  reminderSmsPerCycle: 2,
  /** Servidores, base de datos y respaldos repartidos por empresa. */
  infraPerCompanyCents: 200,
  /** Comprobante electrónico de cada pago (OSE/PSE). */
  receiptCents: 60,
} as const;

export interface UnitEconomics {
  /** Lo que queda por mes sin IGV. */
  netRevenueCents: Cents;
  costCents: Cents;
  marginCents: Cents;
  /** Margen sobre el ingreso sin IGV, en %. */
  marginPercent: number;
}

/** Comisión de Culqi de un cargo. */
export function culqiFee(amount: Cents): Cents {
  const fee = Math.round((amount * COSTS.culqiPercent) / 100) + COSTS.culqiFixedCents;
  return amount < 8772 ? Math.max(fee, COSTS.culqiMinimumCents) : fee;
}

/** Economía mensual de una empresa con el plan lleno (todas sus personas usando la app). */
export function unitEconomics(plan: PlanCode, cycle: BillingCycle): UnitEconomics {
  const months = cycle === 'monthly' ? 1 : 12;
  const price = priceFor(plan, cycle);
  const netRevenueCents = (price * 100) / (100 + COSTS.igvPercent) / months;
  const perCharge =
    (culqiFee(price) + COSTS.receiptCents + COSTS.reminderSmsPerCycle * COSTS.smsCents) / months;
  const costCents =
    perCharge +
    PLANS[plan].maxMembers * COSTS.smsPerMemberPerMonth * COSTS.smsCents +
    COSTS.infraPerCompanyCents;
  const marginCents = netRevenueCents - costCents;
  return {
    netRevenueCents: Math.round(netRevenueCents),
    costCents: Math.round(costCents),
    marginCents: Math.round(marginCents),
    marginPercent: Math.round((marginCents / netRevenueCents) * 100),
  };
}
