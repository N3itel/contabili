import { downloadsPage, publicPrice } from './site-pages.js';

const none = { version: null, windows: null, macos: null, linux: null, android: null, ios: null };

describe('sitio', () => {
  it('muestra precios sin céntimos de más', () => {
    expect(publicPrice(2900)).toBe('S/ 29');
    expect(publicPrice(2950)).toBe('S/ 29.50');
  });

  it('descargas: solo las publicadas, sin botones vacíos', () => {
    const empty = downloadsPage(none).html;
    expect(empty).toContain('estamos preparando');
    expect(empty).not.toContain('Descargar para');

    const some = downloadsPage({
      ...none,
      version: '1.2.0',
      windows: 'https://descargas.contabili.pe/Contabili-1.2.0.exe',
      android: 'https://play.google.com/store/apps/details?id=pe.contabili&x="<b>',
    }).html;
    expect(some).toContain('Descargar para Windows');
    expect(some).toContain('versión 1.2.0');
    expect(some).not.toContain('Descargar para Mac');
    expect(some).toContain('&quot;&lt;b&gt;');
  });
});
