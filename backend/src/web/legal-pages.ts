import { TRIAL_DAYS } from '../billing/plans.js';
import { TERMS_VERSION } from '../users/consent.js';
import { escapeHtml, renderPage, type WebPage } from './layout.js';

/**
 * Términos y privacidad. BORRADORES PARA REVISIÓN LEGAL: al cambiar el texto,
 * sube TERMS_VERSION (users/consent.ts) para que las apps pidan aceptarlo.
 */
export interface Seller {
  legalName: string;
  ruc: string | null;
  supportEmail: string;
}

const sellerLine = (s: Seller) =>
  `${escapeHtml(s.legalName)}${s.ruc ? `, RUC ${escapeHtml(s.ruc)}` : ''}`;

export function termsPage(seller: Seller): WebPage {
  const email = escapeHtml(seller.supportEmail);
  return renderPage({
    title: 'Términos y condiciones',
    indexable: true,
    body: `
  <div class="narrow">
  <h1>Términos y condiciones</h1>
  <p class="muted">Versión ${TERMS_VERSION}. Borrador sujeto a revisión legal.</p>

  <h2>1. Quiénes somos</h2>
  <p>Contabili es un servicio de ${sellerLine(seller)} para llevar la contabilidad y las finanzas de negocios en el Perú, desde la app y el programa de escritorio.</p>

  <h2>2. Tu cuenta</h2>
  <p>Entras con tu celular y un código por SMS. Eres responsable de lo que se registre desde tu cuenta y de no compartir tus códigos. Cada empresa tiene un dueño que decide quién más entra y con qué rol.</p>

  <h2>3. Prueba gratis y planes</h2>
  <ul>
    <li>Cada empresa empieza con ${TRIAL_DAYS} días gratis, sin tarjeta.</li>
    <li>Luego eliges un plan por empresa, por un mes o por un año. Los precios publicados incluyen IGV.</li>
    <li>No hay cobros automáticos: cada periodo se paga por separado y te avisamos antes de que venza.</li>
    <li>Los pagos los procesa Culqi con tarjeta o Yape. No vemos ni guardamos los datos de tu tarjeta.</li>
  </ul>

  <h2>4. Si tu plan vence</h2>
  <p>La empresa queda en solo lectura: puedes ver todo lo registrado, pero no registrar cosas nuevas hasta renovar. No borramos tu información por falta de pago.</p>

  <h2>5. Tu información</h2>
  <p>Lo que registras es tuyo. Lo usamos solo para darte el servicio, como explica la <a href="/privacidad">política de privacidad</a>.</p>

  <h2>6. Lo que Contabili hace y lo que no</h2>
  <p>Contabili arma los asientos y reportes a partir de lo que registras. Las declaraciones y pagos ante SUNAT, y la veracidad de lo registrado, son responsabilidad del contribuyente. Te recomendamos que un contador revise tus libros antes de presentarlos.</p>

  <h2>7. Cambios y contacto</h2>
  <p>Si cambiamos estos términos, te lo diremos en la app y te pediremos aceptarlos de nuevo. Escríbenos a <a href="mailto:${email}">${email}</a>.</p>
  </div>`,
  });
}

export function privacyPage(seller: Seller): WebPage {
  const email = escapeHtml(seller.supportEmail);
  return renderPage({
    title: 'Política de privacidad',
    indexable: true,
    body: `
  <div class="narrow">
  <h1>Política de privacidad</h1>
  <p class="muted">Versión ${TERMS_VERSION}. Borrador sujeto a revisión legal (Ley 29733 y su reglamento).</p>

  <h2>Responsable</h2>
  <p>${sellerLine(seller)}. Contacto: <a href="mailto:${email}">${email}</a>.</p>

  <h2>Qué datos usamos</h2>
  <ul>
    <li>Tu celular y tu nombre, para tu cuenta y para que tu equipo te reconozca.</li>
    <li>Los datos de tus empresas (RUC, razón social, régimen) y lo que registras en ellas.</li>
    <li>Los pagos de tu plan: monto, fecha y resultado. Los datos de la tarjeta los recibe Culqi, no nosotros.</li>
  </ul>

  <h2>Para qué</h2>
  <p>Para darte el servicio, cobrar tu plan, atenderte y cuidar la seguridad de tu cuenta. No vendemos tus datos ni los usamos para publicidad de terceros.</p>

  <h2>Con quién los compartimos</h2>
  <p>Solo con proveedores que nos ayudan a dar el servicio: el envío de SMS, el procesador de pagos (Culqi) y el alojamiento de nuestros servidores. Y con la autoridad, cuando la ley lo exige.</p>

  <h2>Tus derechos</h2>
  <p>Puedes pedir acceso, rectificación, cancelación u oposición sobre tus datos escribiendo a <a href="mailto:${email}">${email}</a>. Los registros contables de una empresa se conservan mientras lo exijan las normas tributarias.</p>
  </div>`,
  });
}
