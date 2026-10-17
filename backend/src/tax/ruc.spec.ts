import { isValidRuc, parseRuc, rucCheckDigit } from './ruc.js';

describe('RUC', () => {
  it('calcula el dígito verificador', () => {
    // SUNAT: 20131312955.
    expect(rucCheckDigit('2013131295')).toBe(5);
  });

  it('reconoce el tipo de contribuyente', () => {
    expect(parseRuc('20131312955')).toBe('legal');
    const natural = '1046215474';
    expect(parseRuc(natural + rucCheckDigit(natural))).toBe('natural');
  });

  it('rechaza RUC mal formados o con verificador errado', () => {
    expect(isValidRuc('20131312954')).toBe(false);
    expect(isValidRuc('2013131295')).toBe(false);
    expect(isValidRuc('2013131295a')).toBe(false);
    const badPrefix = '3013131295';
    expect(isValidRuc(badPrefix + rucCheckDigit(badPrefix))).toBe(false);
  });
});
