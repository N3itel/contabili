/**
 * Teléfonos en formato E.164. Las cuentas de Contabili usan celulares peruanos
 * (+51 y 9 dígitos que empiezan en 9).
 */

const PERU_MOBILE = /^\+519\d{8}$/;

/** Quita espacios, guiones, puntos y paréntesis. */
function compact(input: string): string {
  return input.replace(/[\s\-().]/g, '');
}

/**
 * Normaliza un celular peruano: acepta «987 654 321», «+51 987-654-321» o
 * «0051987654321». Devuelve `null` si no es un celular peruano válido.
 */
export function normalizePeruMobile(input: string): string | null {
  let value = compact(input);
  if (value.startsWith('00')) value = `+${value.slice(2)}`;
  if (/^9\d{8}$/.test(value)) value = `+51${value}`;
  if (/^519\d{8}$/.test(value)) value = `+${value}`;
  return PERU_MOBILE.test(value) ? value : null;
}

/** Para mostrar o registrar sin exponer el número: +51 9•• ••• 321. */
export function maskPhone(phone: string): string {
  if (phone.length < 7) return '•••';
  const rest = phone.slice(3);
  return `${phone.slice(0, 3)} ${rest.slice(0, 1)}•• ••• ${rest.slice(-3)}`;
}
