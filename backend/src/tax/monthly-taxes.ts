import type { Cents } from '../accounting/money.js';

/**
 * Lo que una empresa le paga a SUNAT cada mes, estimado a partir de lo
 * registrado: IGV (ventas menos compras con factura, con el saldo a favor que
 * viene de meses anteriores) y el impuesto a la renta mensual según el régimen.
 * Es una guía para el dueño: la declaración la presenta el contribuyente.
 */
export type Regime = 'nrus' | 'rer' | 'rmt' | 'general';

/** UIT por año (D.S. 301-2025-EF para 2026). Al empezar un año, agrega la nueva. */
export const UIT_BY_YEAR: Readonly<Record<number, Cents>> = {
  2025: 535000,
  2026: 550000,
};

/** Nuevo RUS: categorías por ingresos del mes y su cuota fija. */
export const NRUS_CATEGORIES = [
  { category: 1, maxMonthlyIncome: 500000, quota: 2000 },
  { category: 2, maxMonthlyIncome: 800000, quota: 5000 },
] as const;

/** RMT: 1 % mientras los ingresos del año no pasen de 300 UIT; luego 1,5 %. */
export const RMT_LOW_RATE = 1;
export const RMT_THRESHOLD_UIT = 300;
/** RER: 1,5 % de los ingresos netos del mes. General: 1,5 % o el coeficiente si es mayor. */
export const STANDARD_RATE = 1.5;

/** Lo que pasó en un mes, sacado de los libros. */
export interface MonthFlows {
  /** 'AAAA-MM'. */
  period: string;
  /** Ventas sin IGV (cuenta 70, haber menos debe). */
  netSales: Cents;
  /** IGV de las ventas (haber de la 40111). */
  igvSales: Cents;
  /** IGV de las compras con factura (debe de la 40111, sin contar los pagos a SUNAT). */
  igvPurchases: Cents;
}

export interface MonthlyTaxes {
  period: string;
  regime: Regime;
  igv: null | {
    sales: Cents;
    purchases: Cents;
    /** Saldo a favor que venía de meses anteriores. */
    previousCredit: Cents;
    toPay: Cents;
    /** Saldo a favor que pasa al mes siguiente. */
    nextCredit: Cents;
  };
  income: {
    kind: 'nrus_quota' | 'monthly_payment';
    base: Cents;
    /** Tasa en %, o null en el Nuevo RUS (cuota fija). */
    ratePercent: number | null;
    nrusCategory: 1 | 2 | null;
    amount: Cents;
  };
  /** IGV + renta, redondeado a soles enteros como en la declaración. */
  total: Cents;
  notes: string[];
}

/** Redondeo a soles enteros (la declaración no lleva céntimos). */
export const roundToSoles = (cents: Cents): Cents => Math.round(cents / 100) * 100;

export function uitFor(year: number): { uit: Cents; known: boolean } {
  const known = UIT_BY_YEAR[year];
  if (known) return { uit: known, known: true };
  const latest = Math.max(...Object.keys(UIT_BY_YEAR).map(Number));
  return { uit: UIT_BY_YEAR[latest], known: false };
}

/**
 * Impuestos del último mes de `months` (ordenados del más antiguo al más
 * nuevo): el saldo a favor de IGV se arrastra mes a mes desde el primero.
 */
export function monthlyTaxes(regime: Regime, months: readonly MonthFlows[]): MonthlyTaxes {
  const current = months.at(-1);
  if (!current) throw new Error('Se necesita al menos un mes');
  const notes: string[] = [];

  let igv: MonthlyTaxes['igv'] = null;
  if (regime !== 'nrus') {
    let credit = 0;
    let previousCredit = 0;
    let toPay = 0;
    for (const m of months) {
      previousCredit = credit;
      const net = m.igvSales - m.igvPurchases - credit;
      toPay = Math.max(0, net);
      credit = Math.max(0, -net);
    }
    igv = {
      sales: current.igvSales,
      purchases: current.igvPurchases,
      previousCredit,
      toPay: roundToSoles(toPay),
      nextCredit: credit,
    };
  }

  const year = Number(current.period.slice(0, 4));
  const base = Math.max(0, current.netSales);
  let income: MonthlyTaxes['income'];
  if (regime === 'nrus') {
    const category = NRUS_CATEGORIES.find((c) => base <= c.maxMonthlyIncome);
    if (!category) {
      notes.push(
        'Este mes vendiste más de S/ 8,000: el Nuevo RUS ya no te corresponde. Habla con tu contador para cambiar de régimen.',
      );
    }
    const chosen = category ?? NRUS_CATEGORIES[NRUS_CATEGORIES.length - 1];
    income = {
      kind: 'nrus_quota',
      base,
      ratePercent: null,
      nrusCategory: chosen.category,
      amount: chosen.quota,
    };
  } else {
    let rate = STANDARD_RATE;
    if (regime === 'rmt') {
      const { uit, known } = uitFor(year);
      const yearIncome = months
        .filter((m) => m.period.startsWith(`${year}-`))
        .reduce((sum, m) => sum + Math.max(0, m.netSales), 0);
      if (!known) notes.push(`Todavía no registramos la UIT de ${year}; usamos la más reciente.`);
      if (yearIncome <= RMT_THRESHOLD_UIT * uit) {
        rate = RMT_LOW_RATE;
      } else {
        notes.push(
          'Tus ingresos del año pasaron las 300 UIT: el pago a cuenta sube a 1.5 % (o al coeficiente, si es mayor).',
        );
      }
    }
    if (regime === 'general') {
      notes.push(
        'En el Régimen General el pago a cuenta es 1.5 % o el coeficiente del año anterior, el que sea mayor.',
      );
    }
    income = {
      kind: 'monthly_payment',
      base,
      ratePercent: rate,
      nrusCategory: null,
      amount: roundToSoles(Math.round((base * rate * 10) / 1000)),
    };
  }

  notes.push(
    'Es un estimado con lo que registraste en Contabili. La fecha de pago depende del último dígito de tu RUC (cronograma de SUNAT).',
  );
  return {
    period: current.period,
    regime,
    igv,
    income,
    total: (igv?.toPay ?? 0) + income.amount,
    notes,
  };
}
