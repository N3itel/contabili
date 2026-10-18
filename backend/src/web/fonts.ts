import { readFileSync } from 'node:fs';

/**
 * Las letras del sitio, servidas por nosotros (sin recursos de terceros):
 * Saira para títulos y montos, Lexend para el texto. Licencia OFL; las
 * genera `tools/letras.py`, las mismas de la app.
 */
export const FONT_FILES: Readonly<Record<string, Buffer>> = {
  'saira.woff2': readFileSync(new URL('./assets/saira.woff2', import.meta.url)),
  'lexend.woff2': readFileSync(new URL('./assets/lexend.woff2', import.meta.url)),
};

export const FONT_FACES = `
  @font-face { font-family: Saira; src: url(/fonts/saira.woff2) format("woff2");
    font-weight: 500 900; font-display: swap; }
  @font-face { font-family: Lexend; src: url(/fonts/lexend.woff2) format("woff2");
    font-weight: 300 700; font-display: swap; }`;

export const TEXT_FONT = 'Lexend, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const DISPLAY_FONT = 'Saira, Lexend, system-ui, sans-serif';
