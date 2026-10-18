import type { Cents } from '../accounting/money.js';

/**
 * Planes de Contabili. La licencia es por empresa: se paga por mes o por año
 * (el año cuesta 10 meses) y vale en la app y en el programa de escritorio.
 * Los precios incluyen IGV (así se muestran al público).
 *
 * Precios fijados el 17/10/2026 frente a la competencia y a lo que cuesta
 * atender cada empresa (docs/precios.md); `unit-economics.spec.ts` revisa
 * que ninguno quede en pérdida.
 */
export type PlanCode = 'emprendedor' | 'negocio';
export type BillingCycle = 'monthly' | 'annual';

export interface Plan {
  code: PlanCode;
  name: string;
  /** Para quién es, en una línea. */
  tagline: string;
  /** Personas que pueden trabajar en la empresa (dueño incluido). */
  maxMembers: number;
  monthlyCents: Cents;
  annualCents: Cents;
  features: readonly string[];
}

const COMMON = [
  'Registra ventas, gastos, cobros y pagos sin saber de contabilidad',
  'Impuestos del mes: IGV y renta según tu régimen',
  'Clientes y proveedores: quién te debe y a quién le debes',
  'Resumen del mes y gráfico de tus ventas y gastos',
  'Libro diario, mayor y balance, descargables en Excel',
  'En el celular y en la computadora (Windows, Mac y Linux)',
];

export const PLANS: Readonly<Record<PlanCode, Plan>> = {
  emprendedor: {
    code: 'emprendedor',
    name: 'Emprendedor',
    tagline: 'Para quien lleva su negocio solo o con una persona más.',
    maxMembers: 2,
    monthlyCents: 2500,
    annualCents: 25000,
    features: [...COMMON, 'Hasta 2 personas'],
  },
  negocio: {
    code: 'negocio',
    name: 'Negocio',
    tagline: 'Para negocios con equipo o con contador externo.',
    maxMembers: 6,
    monthlyCents: 4900,
    annualCents: 49000,
    features: [...COMMON, 'Hasta 6 personas, con roles (dueño, contador, consulta)'],
  },
};

export const PLAN_CODES = Object.keys(PLANS) as PlanCode[];

/** Cada empresa nueva prueba el plan más completo, gratis y sin tarjeta. */
export const TRIAL_DAYS = 30;
export const TRIAL_PLAN: PlanCode = 'negocio';

export function priceFor(plan: PlanCode, cycle: BillingCycle): Cents {
  return cycle === 'monthly' ? PLANS[plan].monthlyCents : PLANS[plan].annualCents;
}

/** Suma meses sin pasarse de fin de mes (31 de enero + 1 mes = 28 o 29 de febrero). */
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

export interface LicenseRow {
  plan: PlanCode;
  trialEndsAt: Date;
  paidThrough: Date | null;
}

export interface LicenseState {
  /** `trial`: prueba gratis; `active`: pagada; `expired`: solo lectura. */
  status: 'trial' | 'active' | 'expired';
  plan: PlanCode;
  /** Hasta cuándo vale (fin de la prueba o del periodo pagado). */
  endsAt: Date;
  /** Días enteros que faltan (0 si ya venció). */
  daysLeft: number;
}

export function licenseState(row: LicenseRow, now: Date): LicenseState {
  const paid = row.paidThrough && row.paidThrough > now ? row.paidThrough : null;
  const endsAt =
    paid ?? (row.trialEndsAt > now ? row.trialEndsAt : (row.paidThrough ?? row.trialEndsAt));
  const status = paid ? 'active' : row.trialEndsAt > now ? 'trial' : 'expired';
  const daysLeft = Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / 86_400_000));
  return { status, plan: row.plan, endsAt, daysLeft };
}

/**
 * Hasta cuándo vale la licencia tras un pago: el periodo empieza cuando
 * termina lo que ya tenía (prueba o pago), o ahora si ya venció.
 */
export function extendLicense(
  row: LicenseRow,
  cycle: BillingCycle,
  now: Date,
): { periodStart: Date; periodEnd: Date } {
  const candidates = [now, row.trialEndsAt, row.paidThrough].filter((d): d is Date => d !== null);
  const periodStart = new Date(Math.max(...candidates.map((d) => d.getTime())));
  return { periodStart, periodEnd: addMonths(periodStart, cycle === 'monthly' ? 1 : 12) };
}

export type OrderProblem = 'plan_change_while_paid' | 'plan_too_small';

/**
 * Se puede cambiar de plan en la prueba o al vencer; con un periodo pagado
 * corriendo, se renueva el mismo plan. Bajar de plan exige caber en él.
 */
export function orderProblem(input: {
  license: LicenseRow;
  plan: PlanCode;
  members: number;
  now: Date;
}): OrderProblem | null {
  const { license, plan, members, now } = input;
  if (license.paidThrough && license.paidThrough > now && license.plan !== plan) {
    return 'plan_change_while_paid';
  }
  if (members > PLANS[plan].maxMembers) return 'plan_too_small';
  return null;
}
