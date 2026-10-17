import { uniqueViolation } from './pg.js';

describe('errores de PostgreSQL', () => {
  it('reconoce la restricción única violada, directa o envuelta', () => {
    expect(uniqueViolation({ code: '23505', constraint: 'a_uq' })).toBe('a_uq');
    expect(uniqueViolation({ cause: { code: '23505', constraint: 'b_uq' } })).toBe('b_uq');
    expect(uniqueViolation({ code: '23514', constraint: 'check' })).toBeNull();
    expect(uniqueViolation(new Error('otro'))).toBeNull();
    expect(uniqueViolation(undefined)).toBeNull();
  });
});
