import { isValidAccountCode, natureForCode, parentCode, PCGE_ACCOUNTS } from './pcge.js';

describe('PCGE', () => {
  it('tiene códigos válidos y sin repetir', () => {
    const codes = PCGE_ACCOUNTS.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every(isValidAccountCode)).toBe(true);
  });

  it('cada subcuenta tiene su cuenta madre en el plan', () => {
    const codes = new Set(PCGE_ACCOUNTS.map((a) => a.code));
    for (const { code } of PCGE_ACCOUNTS) {
      const parent = parentCode(code);
      if (parent) expect(codes, `madre de ${code}`).toContain(parent);
    }
  });

  it('la naturaleza sigue al elemento, salvo excepciones marcadas', () => {
    const exceptions = new Set(['39']);
    for (const a of PCGE_ACCOUNTS) {
      if (!exceptions.has(a.code)) expect(a.nature, a.code).toBe(natureForCode(a.code));
    }
  });

  it('valida códigos', () => {
    expect(isValidAccountCode('40111')).toBe(true);
    expect(isValidAccountCode('4')).toBe(false);
    expect(isValidAccountCode('0101')).toBe(false);
    expect(isValidAccountCode('10a')).toBe(false);
  });
});
