/**
 * Todos los montos se manejan en céntimos de sol (enteros) para evitar
 * errores de redondeo con decimales. S/ 15,50 = 1550.
 */
export type Cents = number;

/** Un monto válido: entero y sin signo. Los cargos y abonos van en columnas aparte. */
export function isValidAmount(amount: Cents): boolean {
  return Number.isSafeInteger(amount) && amount >= 0;
}

/**
 * Porcentaje de un monto, redondeado al céntimo (mitad hacia arriba). Se
 * multiplica antes de dividir para no arrastrar decimales binarios
 * (1550 × 18 / 100, no 1550 × 0,18).
 */
export function percentOf(amount: Cents, percent: number): Cents {
  return Math.round((amount * percent) / 100);
}

const solesFormat = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });

/** Formato para mostrar al usuario: 1550 → "S/ 15.50". */
export function formatSoles(amount: Cents): string {
  return solesFormat.format(amount / 100);
}
