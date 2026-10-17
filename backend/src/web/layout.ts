import { createHash } from 'node:crypto';
import { BRAND, FAVICON, markSvg } from './brand.js';

/**
 * Páginas públicas que sirve el backend fuera del prefijo de la API. Son
 * fijas: estilos y scripts propios van por hash en la CSP, sin cookies ni
 * recursos de terceros. Letra grande y botones anchos: tienen que poder
 * usarse sin experiencia y desde el celular.
 */
export const STYLE = `
  :root { color-scheme: light; --ink:${BRAND.ink}; --ink2:${BRAND.ink2}; --paper:${BRAND.paper};
    --green:${BRAND.green}; --mint:${BRAND.mint}; --line:rgba(18,38,30,.12); --red:#B42318; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: var(--paper); color: var(--ink); line-height: 1.55; font-size: 17px; }
  main { max-width: 960px; margin: 0 auto; padding: 20px 16px 48px; }
  .narrow { max-width: 560px; margin: 0 auto; }
  nav.top { display:flex; align-items:center; gap: 10px 18px; flex-wrap: wrap; margin-bottom: 8px; }
  nav.top .brand { display:flex; align-items:center; gap:10px; text-decoration:none; color:var(--ink);
    font-weight: 800; font-size: 19px; margin-right: auto; }
  nav.top a { color: var(--ink); font-weight: 600; }
  .logo { width:38px; height:38px; border-radius:9px; background:var(--green); display:grid;
    place-items:center; flex: none; }
  .logo svg { width:78%; height:78%; }
  h1 { font-size: clamp(30px, 6vw, 46px); line-height: 1.12; margin: 28px 0 10px; letter-spacing: -0.5px; }
  h2 { font-size: 23px; margin: 34px 0 8px; }
  h3 { font-size: 19px; margin: 0 0 6px; }
  p, li { font-size: 17px; }
  a { color: var(--green); }
  .lead { font-size: 20px; color: var(--ink2); max-width: 640px; }
  .muted { color: var(--ink2); font-size: 15px; margin: 0; }
  .grid { display:grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
  .grid.pairs { grid-template-columns: repeat(2, 1fr); }
  .card { background:#fff; border:1px solid var(--line); border-radius:20px; padding:20px; }
  .card.featured { border: 2px solid var(--green); }
  .card > :first-child { margin-top: 0; }
  .price { font-size: 38px; font-weight: 800; margin: 6px 0 0; letter-spacing: -0.5px; }
  .price small { font-size: 16px; font-weight: 600; color: var(--ink2); }
  .tag { display:inline-block; background: var(--mint); color: var(--green); font-weight: 700;
    font-size: 14px; padding: 3px 10px; border-radius: 99px; }
  ul.checks { list-style: none; padding: 0; }
  ul.checks li { padding-left: 28px; position: relative; margin: 8px 0; }
  ul.checks li::before { content: "✓"; position: absolute; left: 4px; color: var(--green); font-weight: 800; }
  .btn { display:block; width:100%; border:0; border-radius:16px; padding:16px; font-size:18px; font-weight:700;
    background: var(--green); color:#fff; cursor:pointer; margin-top: 12px; text-align:center; text-decoration:none; }
  .btn:disabled { opacity:.5; cursor:default; }
  .btn.ghost { background:#fff; color:var(--ink); border:1px solid var(--line); }
  .actions { display:flex; gap: 12px; flex-wrap: wrap; max-width: 560px; }
  .actions .btn { width:auto; flex: 1 1 220px; }
  label { display:block; font-weight:600; margin: 14px 0 6px; }
  input[type=tel], input[type=text], select { width:100%; font-size:19px; padding:14px; border-radius:14px;
    border:1px solid var(--line); background:#fff; color: var(--ink); font-family: inherit; }
  .check { display:flex; gap:10px; align-items:flex-start; font-weight: 400; }
  .check input { width: 22px; height: 22px; margin-top: 3px; flex: none; accent-color: var(--green); }
  .choice { display:flex; gap:12px; align-items:center; border:1px solid var(--line); border-radius:14px;
    padding: 14px; margin: 8px 0; background:#fff; font-weight: 600; cursor: pointer; }
  .choice input { width: 22px; height: 22px; accent-color: var(--green); flex: none; margin: 0; }
  .msg { margin: 12px 0 0; min-height: 1em; }
  .msg.error { color: var(--red); }
  .msg.done { color: var(--green); font-weight: 700; }
  .hidden { display:none; }
  .spaced { margin-top: 12px; }
  .plan-name { margin-top: 8px; }
  .steps { counter-reset: step; list-style: none; padding: 0; }
  .steps li { counter-increment: step; padding-left: 46px; position: relative; margin: 14px 0; }
  .steps li::before { content: counter(step); position:absolute; left:0; top: -2px; width:32px; height:32px;
    border-radius: 50%; background: var(--mint); color: var(--green); font-weight: 800; display:grid; place-items:center; }
  footer { margin-top: 48px; font-size: 15px; color: var(--ink2); display:flex; flex-wrap:wrap; gap: 8px 18px; }
  footer a { color: var(--ink2); }
  @media (max-width: 620px) { .grid.pairs { grid-template-columns: 1fr; } }
  @media (max-width: 420px) {
    nav.top { gap: 8px 12px; }
    nav.top .brand { font-size: 17px; gap: 8px; }
    nav.top a { font-size: 15px; }
    .logo { width: 34px; height: 34px; }
  }
`;

export const sha256 = (text: string) =>
  `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

export interface WebPage {
  html: string;
  csp: string;
}

const escapeMap: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Para textos que vienen de la configuración (razón social, correo). */
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => escapeMap[c]);

const NAV = `
  <nav class="top" aria-label="Principal">
    <a class="brand" href="/"><span class="logo" aria-hidden="true">${markSvg()}</span>Contabili</a>
    <a href="/precios">Precios</a>
    <a href="/descargas">Descargar</a>
    <a href="/mi-plan">Mi plan</a>
  </nav>`;

export function renderPage(opts: {
  title: string;
  description?: string;
  body: string;
  script?: string;
  /** El sitio se puede indexar; Mi plan no. */
  indexable?: boolean;
}): WebPage {
  const robots = opts.indexable ? '' : '<meta name="robots" content="noindex, nofollow">\n';
  const description = opts.description
    ? `<meta name="description" content="${escapeHtml(opts.description)}">\n`
    : '';
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="${FAVICON}">
${robots}${description}<title>${escapeHtml(opts.title)} · Contabili</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${NAV}
${opts.body}
  <footer>
    <span>© Contabili</span>
    <a href="/precios">Precios</a>
    <a href="/descargas">Descargar</a>
    <a href="/terminos">Términos y condiciones</a>
    <a href="/privacidad">Privacidad</a>
  </footer>
</main>
${opts.script ? `<script>${opts.script}</script>\n` : ''}</body>
</html>`;
  const csp = [
    "default-src 'none'",
    `style-src ${sha256(STYLE)}`,
    opts.script ? `script-src ${sha256(opts.script)}` : null,
    opts.script ? "connect-src 'self'" : null,
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ]
    .filter(Boolean)
    .join('; ');
  return { html, csp };
}
