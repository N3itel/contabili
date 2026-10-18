/** Prefijo de la API; el sitio público y /health quedan fuera. */
export const API_PREFIX = 'api/v1';

/**
 * Rutas fuera del prefijo: /health para el balanceador, la página de pago
 * (/pagar/<id>) y las páginas del sitio.
 */
export const PREFIX_EXCLUDE = [
  '/',
  'health',
  'precios',
  'descargas',
  'mi-plan',
  'pagar/:id',
  'terminos',
  'privacidad',
  'fonts/figtree.ttf',
];
