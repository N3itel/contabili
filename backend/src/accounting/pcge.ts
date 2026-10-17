/**
 * Plan Contable General Empresarial (PCGE, versión 2019): las cuentas con que
 * nace cada empresa. Cada una puede abrir subcuentas propias desde la app.
 */
export type AccountNature = 'debit' | 'credit';

export interface PcgeAccount {
  code: string;
  name: string;
  nature: AccountNature;
}

/**
 * Elementos 1–3 (activo), 6 (gastos) y 9 (costos y gastos por función) son
 * deudores; 4 (pasivo), 5 (patrimonio) y 7 (ingresos), acreedores. Las
 * excepciones (como la 39, que resta del activo) van marcadas a mano.
 */
export function natureForCode(code: string): AccountNature {
  return ['4', '5', '7'].includes(code[0]) ? 'credit' : 'debit';
}

const d = (code: string, name: string): PcgeAccount => ({ code, name, nature: 'debit' });
const c = (code: string, name: string): PcgeAccount => ({ code, name, nature: 'credit' });

export const PCGE_ACCOUNTS: readonly PcgeAccount[] = [
  d('10', 'Efectivo y equivalentes de efectivo'),
  d('101', 'Caja'),
  d('1011', 'Caja'),
  d('104', 'Cuentas corrientes en instituciones financieras'),
  d('1041', 'Cuentas corrientes operativas'),
  d('12', 'Cuentas por cobrar comerciales – terceros'),
  d('121', 'Facturas, boletas y otros comprobantes por cobrar'),
  d('1212', 'Emitidas en cartera'),
  d('16', 'Cuentas por cobrar diversas – terceros'),
  d('20', 'Mercaderías'),
  d('33', 'Propiedad, planta y equipo'),
  c('39', 'Depreciación, amortización y agotamiento acumulados'),
  c('40', 'Tributos, contraprestaciones y aportes al sistema de pensiones y de salud por pagar'),
  c('401', 'Gobierno central'),
  c('4011', 'Impuesto general a las ventas'),
  c('40111', 'IGV – Cuenta propia'),
  c('4017', 'Impuesto a la renta'),
  c('41', 'Remuneraciones y participaciones por pagar'),
  c('42', 'Cuentas por pagar comerciales – terceros'),
  c('421', 'Facturas, boletas y otros comprobantes por pagar'),
  c('4212', 'Emitidas'),
  c('45', 'Obligaciones financieras'),
  c('50', 'Capital'),
  c('59', 'Resultados acumulados'),
  d('60', 'Compras'),
  d('601', 'Mercaderías'),
  d('62', 'Gastos de personal, directores y gerentes'),
  d('63', 'Gastos de servicios prestados por terceros'),
  d('64', 'Gastos por tributos'),
  d('65', 'Otros gastos de gestión'),
  d('67', 'Gastos financieros'),
  d('68', 'Valuación y deterioro de activos y provisiones'),
  d('69', 'Costo de ventas'),
  c('70', 'Ventas'),
  c('701', 'Mercaderías'),
  c('7011', 'Mercaderías manufacturadas'),
  c('704', 'Prestación de servicios'),
  c('75', 'Otros ingresos de gestión'),
  c('77', 'Ingresos financieros'),
  c('79', 'Cargas imputables a cuentas de costos y gastos'),
  d('94', 'Gastos administrativos'),
  d('95', 'Gastos de ventas'),
];

/** Cuenta madre: el código sin su último dígito ('40111' → '4011'); las de 2 dígitos no tienen. */
export function parentCode(code: string): string | null {
  return code.length > 2 ? code.slice(0, -1) : null;
}

/** Código PCGE: de 2 a 8 dígitos, sin empezar en 0. */
export function isValidAccountCode(code: string): boolean {
  return /^[1-9]\d{1,7}$/.test(code);
}
