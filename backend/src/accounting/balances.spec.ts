import { balanceSides, natureBalance, runningBalances } from './balances.js';

describe('saldos', () => {
  it('orienta el saldo según la naturaleza', () => {
    expect(natureBalance('debit', 1000, 300)).toBe(700);
    expect(natureBalance('credit', 1000, 300)).toBe(-700);
    expect(natureBalance('credit', 300, 1000)).toBe(700);
  });

  it('pone el saldo del lado que gana', () => {
    expect(balanceSides(1000, 300)).toEqual({ debitBalance: 700, creditBalance: 0 });
    expect(balanceSides(300, 1000)).toEqual({ debitBalance: 0, creditBalance: 700 });
    expect(balanceSides(500, 500)).toEqual({ debitBalance: 0, creditBalance: 0 });
  });

  it('acumula el saldo del mayor', () => {
    const moves = [
      { debit: 11800, credit: 0 },
      { debit: 0, credit: 5000 },
      { debit: 0, credit: 6800 },
    ];
    expect(runningBalances('debit', 200, moves)).toEqual([12000, 7000, 200]);
  });
});
