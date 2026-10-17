import { igvFromBase, igvFromTotal } from './igv.js';

describe('IGV', () => {
  it('suma el 18 % a la base', () => {
    expect(igvFromBase(10000)).toEqual({ base: 10000, igv: 1800, total: 11800 });
    expect(igvFromBase(1550)).toEqual({ base: 1550, igv: 279, total: 1829 });
  });

  it('separa la base de un precio con IGV sin perder céntimos', () => {
    expect(igvFromTotal(11800)).toEqual({ base: 10000, igv: 1800, total: 11800 });
    for (const total of [1, 99, 1829, 1550, 123457]) {
      const b = igvFromTotal(total);
      expect(b.base + b.igv).toBe(total);
    }
  });
});
