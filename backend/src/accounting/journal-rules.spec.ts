import { checkJournal, reverseLines } from './journal-rules.js';

const line = (accountCode: string, debit: number, credit: number) => ({
  accountCode,
  debit,
  credit,
});

describe('partida doble', () => {
  it('acepta un asiento cuadrado', () => {
    // Venta de S/ 100 + IGV al crédito.
    expect(
      checkJournal([line('1212', 11800, 0), line('40111', 0, 1800), line('7011', 0, 10000)]),
    ).toBeNull();
  });

  it('rechaza asientos que no cuadran', () => {
    expect(checkJournal([line('1011', 100, 0), line('7011', 0, 99)])).toBe('unbalanced');
  });

  it('rechaza líneas mal armadas', () => {
    expect(checkJournal([line('1011', 100, 0)])).toBe('too_few_lines');
    expect(checkJournal([line('1011', 100, 100), line('7011', 0, 0)])).toBe('debit_and_credit');
    expect(checkJournal([line('1011', 0, 0), line('7011', 0, 0)])).toBe('zero_line');
    expect(checkJournal([line('1011', 10.5, 0), line('7011', 0, 10.5)])).toBe('invalid_amount');
    expect(checkJournal([line('1011', -5, 0), line('7011', -5, 0)])).toBe('invalid_amount');
  });
});

describe('extorno', () => {
  it('invierte el debe y el haber y sigue cuadrando', () => {
    const lines = [line('1212', 11800, 0), line('40111', 0, 1800), line('7011', 0, 10000)];
    const reversed = reverseLines(lines);
    expect(reversed).toEqual([
      line('1212', 0, 11800),
      line('40111', 1800, 0),
      line('7011', 10000, 0),
    ]);
    expect(checkJournal(reversed)).toBeNull();
  });
});
