/**
 * La marca de Contabili: una C que abraza un visto bueno («todo cuadra»),
 * blanca sobre verde. Colores de la paleta, para el sitio y las apps.
 */
export const BRAND = {
  green: '#1E8A5F',
  ink: '#12261E',
  ink2: '#3D5249',
  mint: '#E6F4EC',
  paper: '#FBFAF6',
} as const;

const GLYPH = (color: string) =>
  `<path d="M68 31 A26 26 0 1 0 68 69" fill="none" stroke="${color}" stroke-width="11" stroke-linecap="round"/>` +
  `<path d="M41 50 L49.5 58.5 L64 43" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`;

/** La marca como SVG en línea, decorativa (el fondo verde lo pone el CSS). */
export const markSvg = (color = '#FFFFFF') =>
  `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">${GLYPH(color)}</svg>`;

/** Ícono de la pestaña: el cuadro verde con la marca, como data URI. */
export const FAVICON = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>Contabili</title><rect width="100" height="100" rx="22" fill="${BRAND.green}"/>${GLYPH('#FFFFFF')}</svg>`,
)}`;
