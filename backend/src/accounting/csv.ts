/**
 * CSV para Excel: UTF-8 con BOM (así Excel respeta tildes y eñes), comas y
 * comillas dobles. Un texto escrito por alguien que empieza con = + - @ se
 * antepone con un apóstrofo, para que Excel no lo ejecute como fórmula.
 */
export const CSV_BOM = '﻿';

export function csvText(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Monto en céntimos como número decimal con punto: 11800 → 118.00. */
export function csvAmount(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function csvRow(cells: readonly string[]): string {
  return `${cells.join(',')}\r\n`;
}
