import { createHash } from 'node:crypto';
import { BRAND, CHAKANA_TEXTURE, FAVICON, markSvg, TOCAPU_BAND } from './brand.js';

/**
 * Páginas públicas que sirve el backend fuera del prefijo de la API. Son
 * fijas: estilos y scripts propios van por hash en la CSP, sin cookies ni
 * recursos de terceros (la letra Figtree se sirve desde /fonts). Estilo
 * incaico moderno: paleta andina, chakana y franjas tocapu. Letra grande y
 * botones anchos: tienen que poder usarse sin experiencia y desde el celular.
 */
export const STYLE = `
  @font-face { font-family: Figtree; src: url(/fonts/figtree.ttf) format("truetype");
    font-weight: 300 900; font-display: swap; }
  :root { color-scheme: light; --ink:${BRAND.ink}; --ink2:${BRAND.ink2}; --paper:${BRAND.paper};
    --terracotta:${BRAND.terracotta}; --terracotta-dark:${BRAND.terracottaDark};
    --terracotta-soft:${BRAND.terracottaSoft}; --gold:${BRAND.gold}; --gold-soft:${BRAND.goldSoft};
    --green:${BRAND.green}; --green-soft:${BRAND.greenSoft}; --line:rgba(30,34,53,.12); --red:${BRAND.red}; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: Figtree, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: var(--paper); color: var(--ink); line-height: 1.55; font-size: 17px; }
  .tocapu { height: 12px; background: url("${TOCAPU_BAND}") repeat-x; }
  main { max-width: 1000px; margin: 0 auto; padding: 16px 16px 48px; }
  .narrow { max-width: 560px; margin: 0 auto; }
  nav.top { display:flex; align-items:center; gap: 10px 18px; flex-wrap: wrap; margin: 6px 0 8px; }
  nav.top .brand { display:flex; align-items:center; gap:10px; text-decoration:none; color:var(--ink);
    font-weight: 800; font-size: 20px; margin-right: auto; letter-spacing: -0.2px; }
  nav.top a { color: var(--ink); font-weight: 600; text-decoration: none; }
  nav.top a:hover { color: var(--terracotta); }
  .logo { width:40px; height:40px; flex: none; display:block; }
  .logo svg { width:100%; height:100%; display:block; }
  .beta { font-size: 12px; font-weight: 800; letter-spacing: .6px; text-transform: uppercase;
    color: var(--ink); background: var(--gold); border-radius: 6px; padding: 2px 7px; }
  .hero { position: relative; margin: 18px -16px 0; padding: 28px 16px 34px;
    background: var(--gold-soft) url("${CHAKANA_TEXTURE}"); border-radius: 0 0 28px 28px; }
  h1 { font-size: clamp(32px, 6vw, 52px); line-height: 1.08; margin: 10px 0 12px; letter-spacing: -1px;
    font-weight: 850; }
  h1 em { font-style: normal; color: var(--terracotta); }
  h2 { font-size: 25px; margin: 38px 0 10px; letter-spacing: -0.3px; }
  h2::after { content: ""; display: block; width: 48px; height: 6px; margin-top: 8px;
    background: url("${TOCAPU_BAND}") repeat-x; background-size: auto 6px; border-radius: 2px; }
  h3 { font-size: 19px; margin: 0 0 6px; }
  p, li { font-size: 17px; }
  a { color: var(--terracotta); }
  .lead { font-size: 20px; color: var(--ink2); max-width: 660px; }
  .muted { color: var(--ink2); font-size: 15px; margin: 0; }
  .grid { display:grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
  .grid.pairs { grid-template-columns: repeat(2, 1fr); }
  .card { background:#fff; border:1px solid var(--line); border-radius:20px; padding:20px;
    box-shadow: 0 1px 0 rgba(30,34,53,.04); }
  .card.featured { border: 2px solid var(--terracotta); box-shadow: 0 10px 30px -18px rgba(180,68,44,.6); }
  .card > :first-child { margin-top: 0; }
  .card .icon { width: 44px; height: 44px; border-radius: 12px; display:grid; place-items:center;
    background: var(--terracotta-soft); color: var(--terracotta); font-weight: 900; font-size: 20px; margin-bottom: 10px; }
  .price { font-size: 40px; font-weight: 850; margin: 6px 0 0; letter-spacing: -0.8px; }
  .price small { font-size: 16px; font-weight: 600; color: var(--ink2); }
  .tag { display:inline-block; background: var(--terracotta); color: #fff; font-weight: 800;
    font-size: 13px; padding: 3px 10px; border-radius: 99px; letter-spacing: .3px; }
  ul.checks { list-style: none; padding: 0; }
  ul.checks li { padding-left: 30px; position: relative; margin: 8px 0; }
  ul.checks li::before { content: ""; position: absolute; left: 4px; top: 7px; width: 14px; height: 14px;
    background: var(--gold); clip-path: polygon(35% 0, 65% 0, 65% 35%, 100% 35%, 100% 65%, 65% 65%, 65% 100%, 35% 100%, 35% 65%, 0 65%, 0 35%, 35% 35%); }
  .btn { display:block; width:100%; border:0; border-radius:14px; padding:16px; font-size:18px; font-weight:800;
    background: var(--terracotta); color:#fff; cursor:pointer; margin-top: 12px; text-align:center;
    text-decoration:none; font-family: inherit; }
  .btn:hover { background: var(--terracotta-dark); }
  .btn:disabled { opacity:.5; cursor:default; }
  .btn.ghost { background:#fff; color:var(--ink); border:1px solid var(--line); }
  .btn.ghost:hover { border-color: var(--terracotta); color: var(--terracotta); }
  .actions { display:flex; gap: 12px; flex-wrap: wrap; max-width: 600px; }
  .actions .btn { width:auto; flex: 1 1 220px; }
  label { display:block; font-weight:700; margin: 14px 0 6px; }
  input[type=tel], input[type=text], select { width:100%; font-size:19px; padding:14px; border-radius:14px;
    border:1px solid var(--line); background:#fff; color: var(--ink); font-family: inherit; }
  input:focus { outline: 3px solid var(--gold-soft); border-color: var(--gold); }
  .check { display:flex; gap:10px; align-items:flex-start; font-weight: 400; }
  .check input { width: 22px; height: 22px; margin-top: 3px; flex: none; accent-color: var(--terracotta); }
  .choice { display:flex; gap:12px; align-items:center; border:1px solid var(--line); border-radius:14px;
    padding: 14px; margin: 8px 0; background:#fff; font-weight: 600; cursor: pointer; }
  .choice:has(input:checked) { border: 2px solid var(--terracotta); background: var(--terracotta-soft); }
  .choice input { width: 22px; height: 22px; accent-color: var(--terracotta); flex: none; margin: 0; }
  .msg { margin: 12px 0 0; min-height: 1em; }
  .msg.error { color: var(--red); }
  .msg.done { color: var(--green); font-weight: 700; }
  .hidden { display:none; }
  .spaced { margin-top: 12px; }
  .plan-name { margin-top: 8px; }
  .steps { counter-reset: step; list-style: none; padding: 0; }
  .steps li { counter-increment: step; padding-left: 52px; position: relative; margin: 16px 0; }
  .steps li::before { content: counter(step); position:absolute; left:0; top: -3px; width:36px; height:36px;
    background: var(--terracotta); color: #fff; font-weight: 900; display:grid; place-items:center;
    clip-path: polygon(30% 0, 70% 0, 70% 30%, 100% 30%, 100% 70%, 70% 70%, 70% 100%, 30% 100%, 30% 70%, 0 70%, 0 30%, 30% 30%); }
  footer { margin-top: 48px; padding-top: 18px; border-top: 1px solid var(--line); font-size: 15px;
    color: var(--ink2); display:flex; flex-wrap:wrap; gap: 8px 18px; }
  footer a { color: var(--ink2); }
  @media (max-width: 620px) { .grid.pairs { grid-template-columns: 1fr; } }
  @media (max-width: 420px) {
    nav.top { gap: 8px 12px; }
    nav.top .brand { font-size: 18px; gap: 8px; }
    nav.top a { font-size: 15px; }
    nav.top .beta { display: none; }
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
    <a class="brand" href="/"><span class="logo" aria-hidden="true">${markSvg()}</span>Contabili <span class="beta">Beta</span></a>
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
<meta name="theme-color" content="${BRAND.terracotta}">
<link rel="icon" href="${FAVICON}">
${robots}${description}<title>${escapeHtml(opts.title)} · Contabili</title>
<style>${STYLE}</style>
</head>
<body>
<div class="tocapu" aria-hidden="true"></div>
<main>
${NAV}
${opts.body}
  <footer>
    <span>© Contabili · Beta abierta</span>
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
    "font-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ]
    .filter(Boolean)
    .join('; ');
  return { html, csp };
}
