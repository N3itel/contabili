import { z } from 'zod';

/** Nombre y apellido: letras (con tildes y ñ), espacios, apóstrofo y guion. */
export const fullNameSchema = z
  .string()
  .trim()
  .min(3, 'Escribe tu nombre y apellido')
  .max(120)
  .regex(/^[\p{L}][\p{L}\p{M}' .-]*$/u, 'Solo letras, espacios, apóstrofo y guion');

export const emailSchema = z.email('Revisa el correo').max(254);
