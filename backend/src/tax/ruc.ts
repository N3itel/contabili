/**
 * RUC de SUNAT: 11 dígitos. Los dos primeros dicen el tipo de contribuyente
 * y el último es un dígito verificador (módulo 11).
 */
export type RucKind = 'natural' | 'legal' | 'other';

const PREFIXES: Readonly<Record<string, RucKind>> = {
  // Persona natural con negocio (10 + DNI + verificador).
  '10': 'natural',
  // Personas naturales sin DNI (extranjeros, carné de extranjería y otros).
  '15': 'natural',
  '17': 'natural',
  // Sociedades, EIRL, asociaciones y demás personas jurídicas.
  '20': 'legal',
  // Entidades especiales.
  '16': 'other',
};

const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

/** Dígito verificador de los 10 primeros dígitos de un RUC. */
export function rucCheckDigit(first10: string): number {
  const sum = WEIGHTS.reduce((acc, w, i) => acc + w * Number(first10[i]), 0);
  const r = 11 - (sum % 11);
  return r === 10 ? 0 : r === 11 ? 1 : r;
}

/** Tipo de contribuyente si el RUC es válido; `null` si no lo es. */
export function parseRuc(ruc: string): RucKind | null {
  if (!/^\d{11}$/.test(ruc)) return null;
  const kind = PREFIXES[ruc.slice(0, 2)];
  if (!kind) return null;
  return rucCheckDigit(ruc.slice(0, 10)) === Number(ruc[10]) ? kind : null;
}

export function isValidRuc(ruc: string): boolean {
  return parseRuc(ruc) !== null;
}
