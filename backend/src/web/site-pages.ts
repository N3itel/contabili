import { PLAN_CODES, PLANS, TRIAL_DAYS } from '../billing/plans.js';
import { escapeHtml, renderPage, type WebPage } from './layout.js';

/** Precio para el público, sin céntimos si son cero: 2900 → «S/ 29». */
export function publicPrice(cents: number): string {
  const soles = cents / 100;
  return `S/ ${Number.isInteger(soles) ? soles : soles.toFixed(2)}`;
}

export const HOME_PAGE: WebPage = renderPage({
  title: 'Contabilidad fácil para tu negocio',
  description:
    'Anota tus ventas y gastos como en un cuaderno y Contabili hace la contabilidad por ti: IGV, impuestos del mes y el resumen de tu negocio.',
  indexable: true,
  body: `
  <section class="hero">
    <span class="beta">Beta abierta</span>
    <h1>Tu contabilidad, tan fácil como <em>anotar una venta</em></h1>
    <p class="lead">Dile a Contabili qué pasó en tu negocio —«vendí», «gasté», «cobré», «pagué»— y él arma los asientos, separa el IGV, calcula tus impuestos del mes y te dice cómo vas. Sin saber de debe ni haber.</p>
    <div class="actions">
      <a class="btn" href="/descargas">Pruébalo gratis ${TRIAL_DAYS} días</a>
      <a class="btn ghost" href="/precios">Ver precios</a>
    </div>
    <p class="muted spaced">Sin tarjeta para probar. En el celular y en la computadora.</p>
  </section>

  <h2>Así de simple</h2>
  <ol class="steps">
    <li><strong>Descarga e ingresa con tu celular.</strong> Te llega un código por SMS; no hay contraseñas que recordar.</li>
    <li><strong>Anota lo que pasó, con tus palabras.</strong> «Vendí S/ 118 al contado», «pagué la luz con factura». El IGV se calcula solo según tu régimen.</li>
    <li><strong>Mira cómo va tu negocio.</strong> Cuánta plata tienes, quién te debe, a quién le debes, cuánto pagarás a SUNAT este mes y si ganaste o perdiste.</li>
  </ol>

  <h2>Hecho para negocios del Perú</h2>
  <div class="grid pairs">
    <section class="card"><div class="icon" aria-hidden="true">%</div><h3>Tus impuestos del mes</h3><p>IGV con tu saldo a favor y pago a cuenta de renta según tu régimen: Nuevo RUS, RER, MYPE Tributario o General.</p></section>
    <section class="card"><div class="icon" aria-hidden="true">≡</div><h3>Libros en orden</h3><p>Plan Contable General Empresarial, libro diario, mayor y balance de comprobación, listos para tu contador en Excel.</p></section>
    <section class="card"><div class="icon" aria-hidden="true">☺</div><h3>Quién te debe</h3><p>Anota a tus clientes y proveedores: Contabili te dice cuánto te debe cada uno y cuánto debes tú.</p></section>
    <section class="card"><div class="icon" aria-hidden="true">✓</div><h3>Tus datos son tuyos</h3><p>Si tu plan vence, sigues viendo todo lo que registraste. Nunca borramos tu información por falta de pago.</p></section>
  </div>

  <h2>¿Listo para ordenar tus cuentas?</h2>
  <div class="actions">
    <a class="btn" href="/descargas">Descargar Contabili</a>
  </div>`,
});

const FAQ = `
  <h2>Preguntas frecuentes</h2>
  <section class="card">
    <h3>¿Cómo pago?</h3>
    <p>Con Yape o con tarjeta de crédito o débito, desde la app o en <a href="/mi-plan">Mi plan</a>. El pago lo procesa Culqi: no vemos ni guardamos los datos de tu tarjeta.</p>
    <h3>¿Se renueva solo?</h3>
    <p>No. Pagas un mes o un año y te avisamos antes de que venza. No guardamos tu tarjeta ni hacemos cobros automáticos.</p>
    <h3>¿Qué pasa si se vence mi plan?</h3>
    <p>Tu empresa queda en solo lectura: puedes ver todo lo que registraste, pero no anotar cosas nuevas hasta renovar.</p>
    <h3>¿La licencia sirve en el celular y en la computadora?</h3>
    <p>Sí. La licencia es por empresa: entras con tu celular en cualquiera de tus dispositivos.</p>
    <h3>¿Tengo dos negocios?</h3>
    <p>Cada empresa (cada RUC) lleva su propio plan, y cada una empieza con ${TRIAL_DAYS} días gratis.</p>
  </section>`;

export const PRICING_PAGE: WebPage = renderPage({
  title: 'Precios',
  description: `Planes de Contabili por empresa, con ${TRIAL_DAYS} días gratis. Paga con Yape o tarjeta.`,
  indexable: true,
  body: `
  <section class="hero">
    <h1>Precios simples, <em>por empresa</em></h1>
    <p class="lead">Empieza con ${TRIAL_DAYS} días gratis del plan completo, sin tarjeta. Después eliges el plan que te queda. Precios con IGV incluido.</p>
  </section>
  <div class="spaced"></div>
  <div class="grid">
    ${PLAN_CODES.map((code) => {
      const plan = PLANS[code];
      const featured = code === 'negocio';
      return `<section class="card${featured ? ' featured' : ''}">
      ${featured ? '<span class="tag">El más elegido</span>' : ''}
      <h2 class="plan-name">${escapeHtml(plan.name)}</h2>
      <p class="muted">${escapeHtml(plan.tagline)}</p>
      <p class="price">${publicPrice(plan.monthlyCents)} <small>al mes</small></p>
      <p class="muted">o ${publicPrice(plan.annualCents)} al año (2 meses gratis)</p>
      <ul class="checks">${plan.features.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
      <a class="btn${featured ? '' : ' ghost'}" href="/descargas">Probar gratis</a>
    </section>`;
    }).join('\n    ')}
  </div>
  <p class="muted spaced">¿Ya usas Contabili? Paga tu plan en <a href="/mi-plan">Mi plan</a>.</p>
  ${FAQ}`,
});

export interface DownloadLinks {
  version: string | null;
  windows: string | null;
  macos: string | null;
  linux: string | null;
  android: string | null;
  ios: string | null;
}

/** Solo se muestran las descargas publicadas: nada de botones que no llevan a ningún lado. */
export function downloadsPage(links: DownloadLinks): WebPage {
  const button = (href: string | null, label: string, note: string) =>
    href
      ? `<section class="card"><h3>${label}</h3><p class="muted">${note}</p><a class="btn" href="${escapeHtml(href)}" rel="noopener">Descargar para ${label}</a></section>`
      : '';
  const desktop = [
    button(links.windows, 'Windows', 'Windows 10 u 11.'),
    button(links.macos, 'Mac', 'macOS 12 o más reciente.'),
    button(links.linux, 'Linux', 'Ubuntu, Debian y similares.'),
  ].join('');
  const mobile = [
    button(links.android, 'Android', 'Desde Google Play.'),
    button(links.ios, 'iPhone', 'Desde App Store.'),
  ].join('');
  const none = !desktop && !mobile;
  return renderPage({
    title: 'Descargar',
    description: 'Descarga Contabili para tu computadora o tu celular.',
    indexable: true,
    body: `
  <section class="hero">
    <span class="beta">Beta abierta</span>
    <h1>Descarga <em>Contabili</em></h1>
    <p class="lead">Instálalo donde te quede más cómodo. Entras con tu celular y ves lo mismo en todos tus dispositivos.</p>
  </section>
  ${
    none
      ? `<section class="card spaced"><p>Contabili está en beta: estamos preparando las versiones para descargar. Vuelve pronto a esta página.</p></section>`
      : ''
  }
  ${desktop ? `<h2>Para tu computadora${links.version ? ` <small class="muted">versión ${escapeHtml(links.version)}</small>` : ''}</h2><div class="grid">${desktop}</div>` : ''}
  ${mobile ? `<h2>Para tu celular</h2><div class="grid">${mobile}</div>` : ''}
  <h2>¿Cómo empiezo?</h2>
  <ol class="steps">
    <li>Instala Contabili y ábrelo.</li>
    <li>Escribe tu celular y el código que te llega por SMS.</li>
    <li>Crea tu empresa con tu RUC. Tienes ${TRIAL_DAYS} días gratis para probar todo.</li>
  </ol>`,
  });
}
