/**
 * La marca de Contabili, de estilo incaico moderno: una chakana (cruz andina
 * escalonada) de terracota con el Inti al centro y un visto bueno («todo
 * cuadra»). Paleta andina para el sitio y las apps (la misma en
 * `app/lib/ui/theme.dart`).
 */
export const BRAND = {
  /** Terracota de adobe: acciones principales y la marca. */
  terracotta: '#B4442C',
  terracottaDark: '#8E3220',
  terracottaSoft: '#F6E3DA',
  /** Oro del Inti: acentos y detalles. */
  gold: '#D99A1E',
  goldSoft: '#FBEFD3',
  /** Añil de los tejidos: textos y fondos oscuros. */
  ink: '#1E2235',
  ink2: '#4A4E63',
  /** Verde de los andenes: plata que entra, todo bien. */
  green: '#2F7A52',
  greenSoft: '#E3F1E8',
  /** Crema de alpaca: el fondo. */
  paper: '#FAF6EE',
  red: '#A3201D',
} as const;

/** Contorno de la chakana en un cuadro de 100 × 100 (brazos de 30, un escalón). */
export const CHAKANA_POINTS =
  '35,5 65,5 65,20 80,20 80,35 95,35 95,65 80,65 80,80 65,80 65,95 35,95 35,80 20,80 20,65 5,65 5,35 20,35 20,20 35,20';

const GLYPH =
  `<polygon points="${CHAKANA_POINTS}" fill="${BRAND.terracotta}"/>` +
  `<circle cx="50" cy="50" r="16" fill="${BRAND.gold}"/>` +
  `<path d="M42.5 50.5 L48 56 L58 45" fill="none" stroke="${BRAND.ink}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`;

/** La marca como SVG en línea, decorativa. */
export const markSvg = () =>
  `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">${GLYPH}</svg>`;

/** Ícono de la pestaña: la chakana sobre crema, como data URI. */
export const FAVICON = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>Contabili</title><rect width="100" height="100" rx="22" fill="${BRAND.paper}"/>${GLYPH}</svg>`,
)}`;

/**
 * Franja tocapu: pirámides escalonadas de oro sobre terracota, con un punto
 * añil, como en los tejidos y los andenes. Se repite cada 32 × 12.
 */
export const TOCAPU_BAND = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="12" viewBox="0 0 32 12"><rect width="32" height="12" fill="${BRAND.terracotta}"/><path d="M2 12V9h3V6h3V3h4v3h3v3h3v3z" fill="${BRAND.gold}"/><rect x="9" y="7" width="2" height="2" fill="${BRAND.ink}"/><path d="M18 0v3h3v3h3v3h4V6h3V3h1V0z" fill="${BRAND.ink}" opacity=".9"/></svg>`,
)}`;

/** Fondo sutil para secciones destacadas: chakanas pequeñas, casi transparentes. */
export const CHAKANA_TEXTURE = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 100 100"><polygon points="${CHAKANA_POINTS}" fill="${BRAND.gold}" opacity=".10" transform="translate(30 30) scale(.4)"/></svg>`,
)}`;
