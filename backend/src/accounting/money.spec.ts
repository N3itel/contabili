import { formatSoles, isValidAmount, percentOf } from './money.js';

describe('dinero', () => {
  it('acepta solo enteros sin signo', () => {
    expect(isValidAmount(0)).toBe(true);
    expect(isValidAmount(1550)).toBe(true);
    expect(isValidAmount(15.5)).toBe(false);
    expect(isValidAmount(-1)).toBe(false);
    expect(isValidAmount(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  });

  it('calcula porcentajes redondeando al céntimo', () => {
    expect(percentOf(1000, 18)).toBe(180);
    expect(percentOf(1550, 18)).toBe(279);
    // 0,5 céntimos sube.
    expect(percentOf(25, 18)).toBe(5);
  });

  it('muestra soles', () => {
    // Intl separa el símbolo con un espacio duro.
    expect(formatSoles(1550).replace(/\s/g, ' ')).toBe('S/ 15.50');
  });
});
