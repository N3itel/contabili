import { type Cents, percentOf } from '../accounting/money.js';

/**
 * Tasa general: 16 % de IGV más 2 % de Impuesto de Promoción Municipal. Las
 * tasas especiales (por ejemplo, restaurantes y hoteles de la Ley 31556) se
 * configurarán por empresa cuando lleguen los comprobantes.
 */
export const IGV_RATE_PERCENT = 18;

export interface IgvBreakdown {
  /** Valor de venta (base imponible). */
  base: Cents;
  igv: Cents;
  /** Precio de venta: base + IGV. */
  total: Cents;
}

/** Desde la base imponible: IGV redondeado al céntimo. */
export function igvFromBase(base: Cents, rate = IGV_RATE_PERCENT): IgvBreakdown {
  const igv = percentOf(base, rate);
  return { base, igv, total: base + igv };
}

/**
 * Desde el precio con IGV incluido: la base se redondea y el IGV es la
 * diferencia, así base + IGV siempre da el total exacto.
 */
export function igvFromTotal(total: Cents, rate = IGV_RATE_PERCENT): IgvBreakdown {
  const base = Math.round((total * 100) / (100 + rate));
  return { base, igv: total - base, total };
}
