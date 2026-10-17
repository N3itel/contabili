import { csvAmount, csvRow, csvText } from './csv.js';

describe('CSV para Excel', () => {
  it('escapa comas, comillas y saltos de línea', () => {
    expect(csvText('Venta simple')).toBe('Venta simple');
    expect(csvText('Venta, con coma')).toBe('"Venta, con coma"');
    expect(csvText('Dijo "hola"')).toBe('"Dijo ""hola"""');
  });

  it('no deja que una glosa se ejecute como fórmula', () => {
    expect(csvText('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvText('+51 999')).toBe("'+51 999");
    expect(csvText('-5')).toBe("'-5");
    expect(csvText('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('montos con punto decimal y filas con fin de línea de Windows', () => {
    expect(csvAmount(11800)).toBe('118.00');
    expect(csvAmount(5)).toBe('0.05');
    expect(csvAmount(-1550)).toBe('-15.50');
    expect(csvRow(['a', 'b'])).toBe('a,b\r\n');
  });
});
