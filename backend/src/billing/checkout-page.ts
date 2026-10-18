import { createHash } from 'node:crypto';
import { BRAND, FAVICON, markSvg } from '../web/brand.js';
import { DISPLAY_FONT, FONT_FACES, TEXT_FONT } from '../web/fonts.js';

/**
 * Página de pago de una licencia (contabili.pe/pagar/<id>#t=<código>). Es
 * fija: la orden se lee de la dirección y el código va en el fragmento (#),
 * que el navegador nunca envía al servidor ni a terceros. El monto llega del
 * backend; la tarjeta o Yape se ingresan en el checkout de Culqi, así que
 * Contabili no ve los datos de la tarjeta. Sin cookies.
 */
const STYLE = `${FONT_FACES}
  :root { color-scheme: light; --ink:${BRAND.ink}; --ink2:${BRAND.ink2}; --paper:${BRAND.paper};
    --brand:${BRAND.terracotta}; --line:rgba(30,34,53,.12); --red:${BRAND.red}; --green:${BRAND.green}; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: ${TEXT_FONT};
    background: var(--paper); color: var(--ink); }
  main { max-width: 460px; margin: 0 auto; padding: 20px 16px 32px; display: grid; gap: 14px; }
  header { display:flex; align-items:center; gap:10px; }
  .logo { width:40px; height:40px; display:block; flex: none; }
  .logo svg { width:100%; height:100%; display:block; }
  .muted { color: var(--ink2); font-size: 15px; margin: 0; }
  .card { background:#fff; border:1px solid var(--line); border-radius:20px; padding:18px; }
  .amount { font-family: ${DISPLAY_FONT}; font-size: 42px; font-weight: 800; margin: 4px 0 8px;
    font-variant-numeric: tabular-nums; }
  .help { font-size:14px; line-height:1.45; color:var(--ink2); margin:0; }
  .btn { width:100%; border:0; border-radius:16px; padding:16px; font-size:17px; font-weight:700;
    background: var(--brand); color:#fff; cursor:pointer; }
  .btn:disabled { opacity:.5; cursor:default; }
  .btn.ghost { background:#fff; color:var(--ink); border:1px solid var(--line); margin-top:8px; }
  .msg { margin:0; font-size:16px; line-height:1.45; min-height:1em; }
  .msg.error { color: var(--red); }
  .msg.done { color: var(--green); font-weight:700; }
  .hidden { display:none; }
`;

const SCRIPT = `
(() => {
  const id = location.pathname.split('/').filter(Boolean).pop() || '';
  const token = new URLSearchParams(location.hash.slice(1)).get('t') || '';
  const api = '/api/v1/payments/orders/' + encodeURIComponent(id);
  const date = (iso) => new Date(iso).toLocaleDateString('es-PE', { timeZone: 'America/Lima' });
  const $ = (x) => document.getElementById(x);
  const soles = (c) => 'S/ ' + (c / 100).toFixed(2);
  let session = null;
  let checkout = null;
  let busy = false;

  function show(state, text) {
    const final = state === 'done' || state === 'closed';
    $('msg').textContent = text || '';
    $('msg').className = 'msg ' + state;
    $('pay').disabled = state === 'busy';
    $('pay').classList.toggle('hidden', final);
    $('fake').classList.toggle('hidden', final || !session || session.provider !== 'fake');
  }

  async function post(path, body) {
    const res = await fetch(api + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ token: token }, body)),
      credentials: 'omit',
      cache: 'no-store',
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || 'No pudimos conectar. Intenta de nuevo.');
    return json;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('No se pudo abrir el pago. Revisa tu conexión.'));
      document.head.appendChild(s);
    });
  }

  async function charge(tokenId, email, auth3ds) {
    busy = true;
    show('busy', 'Procesando el pago…');
    try {
      const r = await post('/charge', { tokenId: tokenId, email: email, authentication3DS: auth3ds || undefined });
      if (r.status === 'paid') {
        show('done', 'Listo: pagaste ' + soles(r.amountCents) + '. Tu plan vale hasta el ' + date(r.paidThrough) + '. Ya puedes volver a Contabili.');
      } else if (r.status === 'needs_3ds') {
        verify(tokenId, email);
      } else if (r.status === 'declined') {
        show('error', r.message + (r.attemptsLeft === 1 ? ' Te queda 1 intento.' : ' Te quedan ' + r.attemptsLeft + ' intentos.'));
      } else {
        show('closed', r.message);
      }
    } catch (e) {
      show('error', e.message);
    } finally {
      busy = false;
    }
  }

  // El banco pide verificar al titular (3DS): el segundo intento lleva el resultado.
  async function verify(tokenId, email) {
    show('busy', 'Tu banco pide verificar que eres tú…');
    if (session.provider === 'fake') return charge(tokenId, email, { eci: '05', protocolVersion: '2.1.0' });
    try {
      if (!window.Culqi3DS) await loadScript('https://3ds.culqi.com');
      const c3ds = window.Culqi3DS;
      if (!c3ds) throw new Error('3DS');
      c3ds.publicKey = session.publicKey;
      c3ds.settings = {
        charge: { totalAmount: session.amountCents, returnUrl: location.href.split('#')[0], currency: 'PEN' },
        card: { email: email },
      };
      c3ds.options = { showModal: true, showLoading: true, showIcon: true };
      const onMessage = (event) => {
        const data = event.data || {};
        if (data.parameters3DS) {
          window.removeEventListener('message', onMessage);
          charge(tokenId, email, data.parameters3DS);
        } else if (data.error) {
          window.removeEventListener('message', onMessage);
          show('error', 'No se pudo verificar tu tarjeta. Prueba con otra o con Yape.');
        }
      };
      window.addEventListener('message', onMessage);
      c3ds.initAuthentication(tokenId);
    } catch (e) {
      show('error', 'Tu banco pide una verificación que no pudimos abrir. Prueba con Yape o con otra tarjeta.');
    }
  }

  async function openCulqi() {
    if (!checkout) {
      await loadScript('https://js.culqi.com/checkout-js');
      checkout = new window.CulqiCheckout(session.publicKey, {
        settings: { title: 'Contabili', currency: 'PEN', amount: session.amountCents },
        client: {},
        options: {
          lang: 'es',
          installments: false,
          modal: true,
          paymentMethods: { tarjeta: true, yape: true, billetera: false, bancaMovil: false, agente: false, cuotealo: false },
          paymentMethodsSort: ['yape', 'tarjeta'],
        },
        appearance: { menuType: 'sidebar', buttonCardPayText: 'Pagar ' + soles(session.amountCents) },
      });
      checkout.culqi = () => {
        if (checkout.token) {
          const t = checkout.token;
          checkout.close();
          charge(t.id, t.email);
        } else if (checkout.error) {
          show('error', checkout.error.user_message || 'No se pudo procesar el pago.');
        }
      };
    }
    checkout.open();
  }

  function pay(fakeToken) {
    if (busy || !session) return;
    if (session.provider === 'fake') return charge(fakeToken || 'fake_ok', 'prueba@contabili.pe');
    openCulqi().catch((e) => show('error', e.message));
  }

  async function start() {
    if (!id || !token) return show('closed', 'Este enlace de pago no es válido.');
    try {
      session = await post('/session', {});
    } catch (e) {
      return show('closed', 'Este enlace de pago no es válido o ya venció. Vuelve a Mi plan para pagar.');
    }
    $('amount').textContent = soles(session.amountCents);
    $('plan').textContent = 'Plan ' + session.planName + ' · ' + session.cycleLabel;
    $('who').textContent = session.companyName;
    if (session.status === 'paid') return show('done', 'Esta orden ya está pagada' + (session.paidThrough ? ': tu plan vale hasta el ' + date(session.paidThrough) : '') + '.');
    if (session.status === 'charging') return show('closed', 'Estamos confirmando el pago con tu banco. Revisa tu plan en unos minutos.');
    if (session.status !== 'pending') return show('closed', session.message || 'Esta orden venció o se cerró. Vuelve a Mi plan para pagar.');
    show('ready', '');
    if (session.provider === 'fake') $('pay').textContent = 'Pagar (modo de prueba)';
    $('pay').addEventListener('click', () => pay('fake_ok'));
    $('fake-declined').addEventListener('click', () => pay('fake_declined'));
    $('fake-3ds').addEventListener('click', () => pay('fake_3ds'));
  }

  start();
})();
`;

export const CHECKOUT_PAGE_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="${FAVICON}">
<title>Pagar · Contabili</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <header>
    <div class="logo" aria-hidden="true">${markSvg()}</div>
    <div><strong>Contabili</strong><p class="muted" id="who">Pago de tu plan</p></div>
  </header>
  <section class="card">
    <p class="muted" id="plan">Tu plan</p>
    <p class="amount" id="amount">—</p>
    <p class="help">Incluye IGV. Tu plan se activa apenas se confirme el pago y vale en el celular y en la computadora. El pago lo procesa Culqi: Contabili no ve ni guarda los datos de tu tarjeta.</p>
  </section>
  <p id="msg" class="msg" role="status" aria-live="polite"></p>
  <button id="pay" class="btn" type="button">Pagar con Yape o tarjeta</button>
  <div id="fake" class="hidden">
    <p class="help">Modo de prueba: no se cobra nada.</p>
    <button id="fake-declined" class="btn ghost" type="button">Simular rechazo</button>
    <button id="fake-3ds" class="btn ghost" type="button">Simular verificación del banco</button>
  </div>
</main>
<script>${SCRIPT}</script>
</body>
</html>`;

const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

/**
 * El script propio va por hash. El checkout y la verificación 3DS de Culqi
 * cargan scripts, marcos y estilos propios (y los del banco en 3DS), por eso
 * se permiten de cualquier origen https; la página no muestra nada que venga
 * de la persona, así que no hay dónde inyectar. Ajustar al probar con Culqi.
 */
export const CHECKOUT_PAGE_CSP = [
  "default-src 'none'",
  `script-src ${sha256(SCRIPT)} https:`,
  "style-src 'unsafe-inline' https:",
  "connect-src 'self' https:",
  'frame-src https:',
  "img-src 'self' data: https:",
  "font-src 'self' https: data:",
  "base-uri 'none'",
  "form-action 'self' https:",
  "frame-ancestors 'none'",
].join('; ');
