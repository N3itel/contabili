/**
 * /mi-plan: pagar el plan de una empresa desde el navegador. Se ingresa con el
 * código por SMS como en la app (o se crea la cuenta); la sesión vive solo en
 * la memoria de la página y se cierra al salir. El pago sigue en /pagar.
 */
import { renderPage, type WebPage } from './layout.js';

const SCRIPT = `
(() => {
  const api = '/api/v1';
  const $ = (x) => document.getElementById(x);
  const steps = ['phone', 'code', 'register', 'companies', 'plan'];
  let phone = '';
  let tokens = null;
  let registrationToken = null;
  let company = null;
  const soles = (c) => 'S/ ' + (c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2));
  const date = (iso) => new Date(iso).toLocaleDateString('es-PE', { timeZone: 'America/Lima' });

  function show(step, text, kind) {
    for (const s of steps) $('step-' + s).classList.toggle('hidden', s !== step);
    $('logout').classList.toggle('hidden', !tokens);
    $('msg').textContent = text || '';
    $('msg').className = 'msg ' + (kind || '');
  }

  async function call(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (tokens) headers.Authorization = 'Bearer ' + tokens.accessToken;
    const res = await fetch(api + path, {
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store',
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401 && tokens) {
      tokens = null;
      show('phone', 'Tu sesión terminó. Ingresa de nuevo.', 'error');
      throw new Error('');
    }
    if (!res.ok) throw new Error(json.message || 'No pudimos conectar. Intenta de nuevo.');
    return json;
  }

  async function guard(button, step, fn) {
    $(button).disabled = true;
    try {
      await fn();
    } catch (e) {
      if (e.message) show(step, e.message, 'error');
    } finally {
      $(button).disabled = false;
    }
  }

  function signedIn(res) {
    tokens = { accessToken: res.accessToken, refreshToken: res.refreshToken };
    return loadCompanies();
  }

  async function sendCode() {
    phone = $('phone').value.trim();
    await call('POST', '/auth/code', { phone: phone });
    show('code', 'Te enviamos un código por SMS.');
    $('code').focus();
  }

  async function verify() {
    const res = await call('POST', '/auth/verify', {
      phone: phone,
      code: $('code').value.trim(),
      deviceName: 'Navegador (Mi plan)',
    });
    if (res.status === 'registration_required') {
      registrationToken = res.registrationToken;
      show('register', 'Todavía no tienes cuenta: créala en un paso.');
      $('name').focus();
      return;
    }
    await signedIn(res);
  }

  async function register() {
    const res = await call('POST', '/auth/register', {
      registrationToken: registrationToken,
      fullName: $('name').value.trim(),
      acceptTerms: $('terms').checked,
    });
    await signedIn(res);
  }

  async function loadCompanies() {
    const list = await call('GET', '/companies');
    const box = $('company-list');
    box.textContent = '';
    if (list.length === 0) {
      $('no-companies').classList.remove('hidden');
      show('companies', '');
      return;
    }
    $('no-companies').classList.add('hidden');
    if (list.length === 1) return openCompany(list[0]);
    for (const c of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ghost';
      b.textContent = c.legalName + ' · RUC ' + c.ruc;
      b.addEventListener('click', () => openCompany(c).catch((e) => show('companies', e.message, 'error')));
      box.appendChild(b);
    }
    show('companies', '');
  }

  function statusText(l) {
    if (l.status === 'trial') {
      return 'Estás en la prueba gratis del plan ' + l.planName + ': te quedan ' + l.daysLeft + ' días (hasta el ' + date(l.endsAt) + ').';
    }
    if (l.status === 'active') return 'Tu plan ' + l.planName + ' está pagado hasta el ' + date(l.endsAt) + '.';
    return 'Tu plan venció el ' + date(l.endsAt) + '. Tu empresa está en solo lectura hasta que renueves.';
  }

  async function openCompany(c) {
    company = c;
    const billing = await call('GET', '/companies/' + c.id + '/billing');
    $('company-name').textContent = c.legalName;
    $('license').textContent = statusText(billing.license);
    const box = $('options');
    box.textContent = '';
    let first = true;
    for (const plan of billing.plans) {
      for (const cycle of ['monthly', 'annual']) {
        const label = document.createElement('label');
        label.className = 'choice';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'option';
        input.value = plan.code + ':' + cycle;
        input.checked = first;
        first = false;
        const text = document.createElement('span');
        text.textContent = plan.name + ' · ' + (cycle === 'monthly'
          ? soles(plan.monthlyCents) + ' al mes'
          : soles(plan.annualCents) + ' al año (2 meses gratis)');
        label.appendChild(input);
        label.appendChild(text);
        box.appendChild(label);
      }
    }
    const owner = c.role === 'owner';
    $('pay').classList.toggle('hidden', !owner);
    $('not-owner').classList.toggle('hidden', owner);
    show('plan', '');
  }

  async function pay() {
    const picked = document.querySelector('input[name=option]:checked');
    if (!picked || !company) return;
    const [plan, cycle] = picked.value.split(':');
    const order = await call('POST', '/companies/' + company.id + '/billing/orders', { plan: plan, cycle: cycle });
    // La sesión de esta página termina: el pago sigue con el código de la orden.
    leave();
    location.href = order.checkoutUrl;
  }

  function leave() {
    if (!tokens) return;
    const refreshToken = tokens.refreshToken;
    tokens = null;
    fetch(api + '/auth/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refreshToken }),
      credentials: 'omit',
      keepalive: true,
    }).catch(() => undefined);
  }

  $('send').addEventListener('click', () => guard('send', 'phone', sendCode));
  $('phone').addEventListener('keydown', (e) => { if (e.key === 'Enter') guard('send', 'phone', sendCode); });
  $('verify').addEventListener('click', () => guard('verify', 'code', verify));
  $('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') guard('verify', 'code', verify); });
  $('other').addEventListener('click', () => show('phone', ''));
  $('create').addEventListener('click', () => guard('create', 'register', register));
  $('pay').addEventListener('click', () => guard('pay', 'plan', pay));
  $('back').addEventListener('click', () => guard('back', 'plan', loadCompanies));
  $('logout').addEventListener('click', () => { leave(); show('phone', 'Cerraste la sesión.'); });
  window.addEventListener('pagehide', leave);
  show('phone', '');
})();
`;

const BODY = `
  <div class="narrow">
  <h1>Mi plan</h1>
  <p class="muted">Paga o renueva el plan de tu empresa con Yape o tarjeta. También puedes hacerlo desde la app.</p>

  <section id="step-phone" class="card">
    <label for="phone">Tu celular</label>
    <input id="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="987 654 321">
    <button id="send" class="btn" type="button">Enviar código por SMS</button>
  </section>

  <section id="step-code" class="card hidden">
    <label for="code">Código de 6 dígitos</label>
    <input id="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6">
    <button id="verify" class="btn" type="button">Ingresar</button>
    <button id="other" class="btn ghost" type="button">Usar otro número</button>
  </section>

  <section id="step-register" class="card hidden">
    <label for="name">Tu nombre y apellido</label>
    <input id="name" type="text" autocomplete="name">
    <label class="check"><input id="terms" type="checkbox"> Acepto los <a href="/terminos" target="_blank" rel="noopener">términos y condiciones</a> y la <a href="/privacidad" target="_blank" rel="noopener">política de privacidad</a>.</label>
    <button id="create" class="btn" type="button">Crear mi cuenta</button>
  </section>

  <section id="step-companies" class="card hidden">
    <h2 class="plan-name">Elige la empresa</h2>
    <div id="company-list"></div>
    <div id="no-companies" class="hidden">
      <p>Todavía no tienes empresas. Descarga Contabili, crea tu empresa con tu RUC y empieza tus días gratis.</p>
      <a class="btn" href="/descargas">Descargar Contabili</a>
    </div>
  </section>

  <section id="step-plan" class="card hidden">
    <h2 class="plan-name" id="company-name"></h2>
    <p id="license"></p>
    <div id="options"></div>
    <p class="muted">Precios con IGV. No es una suscripción: pagas una vez y no guardamos tu tarjeta.</p>
    <button id="pay" class="btn" type="button">Ir a pagar</button>
    <p id="not-owner" class="msg hidden">Solo quien es dueño de la empresa puede pagar el plan.</p>
    <button id="back" class="btn ghost" type="button">Ver mis empresas</button>
  </section>

  <p id="msg" class="msg" role="status" aria-live="polite"></p>
  <button id="logout" class="btn ghost hidden" type="button">Salir</button>
  </div>`;

export const MY_PLAN_PAGE: WebPage = renderPage({
  title: 'Mi plan',
  body: BODY,
  script: SCRIPT,
});
