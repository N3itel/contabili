import { describe as describeError } from './exception.filter.js';

describe('errores en el log', () => {
  it('de un error de base de datos solo quedan tipo, código y restricción', () => {
    const error = new Error(
      'Failed query: select * from users where phone = $1\nparams: +51987654321',
    );
    error.name = 'DrizzleQueryError';
    (error as Error & { cause: unknown }).cause = {
      code: '23505',
      constraint: 'users_phone_unique',
    };
    const text = describeError(error);
    expect(text).toBe('Error de base de datos DrizzleQueryError [23505] en users_phone_unique');
    expect(text).not.toContain('987654321');
  });

  it('un error de PostgreSQL directo tampoco muestra su mensaje', () => {
    const error = Object.assign(new Error('Key (phone)=(+51987654321) already exists'), {
      code: '23505',
    });
    expect(describeError(error)).not.toContain('987654321');
  });

  it('los demás errores conservan su pila', () => {
    expect(describeError(new TypeError('x is undefined'))).toContain('TypeError: x is undefined');
    expect(describeError('texto')).toBe('Error desconocido');
  });
});
